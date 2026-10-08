"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { audit, one, run } from "@/lib/db";
import { getPatientRecord } from "@/lib/epic";
import { summarize } from "@/lib/summary";
import { createTransfer, getTransfer, updateTransfer, type Transfer, type TransferDetails } from "@/lib/transfers";
import { rankHospitals, unranked } from "@/lib/ranking";
import { getHospital } from "@/lib/hospitals";
import { saveForm, type FieldValue, type FormField } from "@/lib/forms";
import { approve, getFilled, getFilledPdf, listFilled, saveValues } from "@/lib/filled";
import { fillOpenTransfersFor, processForm, queueFill, queueFormsForTransfer, runFills } from "@/lib/agent";
import { buildPacket, sendFax } from "@/lib/fax";
import { startCall } from "@/lib/voice";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// ---------- Transfers ----------

export async function startTransfer(f: FormData) {
  const patientId = str(f, "patientId");
  const record = await getPatientRecord(patientId);
  const summary = summarize(record);
  const details: TransferDetails = {
    sendingHospital: str(f, "sendingHospital"),
    sendingPhone: str(f, "sendingPhone"),
    sendingFax: str(f, "sendingFax"),
    referringPhysician: str(f, "referringPhysician"),
    callbackPhone: str(f, "callbackPhone"),
    caseManager: str(f, "caseManager"),
    levelOfCare: str(f, "levelOfCare"),
    emergent: f.get("emergent") === "on",
  };
  const id = await createTransfer({ patientId, patientName: summary.patient.name, reason: str(f, "reason"), details, summary });
  await audit("user", "transfer.create", id, "chart snapshot from Epic");
  await rank(id);
  redirect(`/transfers/${id}?step=hospital`);
}

async function rank(transferId: number) {
  const t = (await getTransfer(transferId))!;
  try {
    await updateTransfer(transferId, { ranking: await rankHospitals(t.summary, t.reason) });
    await audit("ai", "transfer.rank", transferId);
  } catch (e) {
    // AI down (out of credits, overloaded, bad key...): list the hospitals anyway so staff can choose.
    await updateTransfer(transferId, { ranking: unranked((e as Error).message) });
  }
}

export async function runRanking(transferId: number) {
  await rank(transferId);
  revalidatePath(`/transfers/${transferId}`);
}

export async function chooseHospital(transferId: number, hospitalId: string) {
  await updateTransfer(transferId, { hospitalId });
  await audit("user", "transfer.choose", transferId, hospitalId);
  const queued = await queueFormsForTransfer(transferId); // forms agent fills everything on file for this hospital
  after(() => runFills(queued));
  redirect(`/transfers/${transferId}?step=forms`);
}

export async function setOutcome(transferId: number, f: FormData) {
  await updateTransfer(transferId, { status: str(f, "status") as Transfer["status"], outcomeReason: str(f, "reason") });
  await audit("user", "transfer.outcome", transferId, str(f, "status"));
  revalidatePath(`/transfers/${transferId}`);
}

// ---------- Filled forms (the agent fills; people review) ----------

export async function refillForm(transferId: number, formId: number) {
  const queued = await queueFill(transferId, formId);
  after(() => runFills([queued]));
  revalidatePath(`/transfers/${transferId}`);
}

export async function saveFilled(filledId: number, f: FormData) {
  const filled = (await getFilled(filledId))!;
  const values: FieldValue[] = filled.fields.map((field) => {
    const old = filled.values.find((v) => v.name === field.name);
    const value = field.type === "checkbox" ? String(f.get(`v:${field.name}`) === "on") : str(f, `v:${field.name}`);
    return { name: field.name, value, source: old && old.value === value ? old.source : "edited by user" };
  });
  await saveValues(filledId, values);
  if (str(f, "approver")) await approve(filledId, str(f, "approver"));
  await audit("user", str(f, "approver") ? "form.approve" : "form.edit", filled.transferId, `filled ${filledId}`);
  revalidatePath(`/transfers/${filled.transferId}`);
}

// ---------- Fax ----------

export async function faxPacket(transferId: number, f: FormData) {
  const t = (await getTransfer(transferId))!;
  const hospital = getHospital(t.hospitalId)!;
  const filled = (await listFilled(transferId)).filter((x) => x.status === "ready");
  if (!filled.length || filled.some((x) => !x.approvedAt)) throw new Error("Every filled form must be approved before faxing.");
  const pdfs = await Promise.all(filled.map(async (x) => (await getFilledPdf(x.id))!.pdf));
  const packet = await buildPacket(t, hospital, pdfs);
  await sendFax(transferId, str(f, "to"), packet);
  await audit("user", "fax.send", transferId, `${filled.length} form(s) to ${hospital.id}`);
  redirect(`/transfers/${transferId}?step=fax`);
}

// ---------- Calls ----------

export async function callTransferCenter(transferId: number, f: FormData) {
  await startCall(transferId, str(f, "to"));
  await audit("user", "call.start", transferId);
  redirect(`/transfers/${transferId}?step=call`);
}

// ---------- Form library ----------

export async function uploadForm(f: FormData) {
  const file = f.get("file") as File;
  const id = await saveForm({
    name: str(f, "name") || file.name.replace(/\.[a-z]+$/i, ""),
    bytes: new Uint8Array(await file.arrayBuffer()),
    mime: file.type,
    hospitalId: str(f, "hospitalId") || null,
    source: "upload",
  });
  await audit("user", "form.upload", null, `form ${id}`);
  after(() => processForm(id));
  redirect(`/forms/${id}`);
}

export async function updateForm(formId: number, f: FormData) {
  await run("UPDATE forms SET name = $1, hospital_id = $2 WHERE id = $3", [str(f, "name"), str(f, "hospitalId") || null, formId]);
  after(() => fillOpenTransfersFor(formId));
  revalidatePath(`/forms/${formId}`);
}

export async function rereadForm(formId: number) {
  await run("UPDATE forms SET status = 'reading' WHERE id = $1", [formId]);
  after(() => processForm(formId));
  revalidatePath(`/forms/${formId}`);
}

// Manual correction of the fields the AI found (rarely needed).
export async function saveFormFields(formId: number, fields: FormField[]) {
  await run("UPDATE forms SET fields = $1 WHERE id = $2", [JSON.stringify(fields), formId]);
  revalidatePath(`/forms/${formId}`);
}

export async function deleteForm(formId: number) {
  if (await one("SELECT 1 FROM filled_forms WHERE form_id = $1", [formId])) throw new Error("This form was used in a transfer; it can't be deleted.");
  await run("DELETE FROM forms WHERE id = $1", [formId]);
  redirect("/forms");
}
