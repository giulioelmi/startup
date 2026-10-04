"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db, audit } from "@/lib/db";
import { getPatientRecord } from "@/lib/epic";
import { summarize } from "@/lib/summary";
import { createTransfer, getTransfer, updateTransfer, type Transfer, type TransferDetails } from "@/lib/transfers";
import { rankHospitals } from "@/lib/ranking";
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
  const id = createTransfer({ patientId, patientName: summary.patient.name, reason: str(f, "reason"), details, summary });
  audit("user", "transfer.create", id, "chart snapshot from Epic");
  await rank(id).catch(() => {}); // on failure the page offers a retry
  redirect(`/transfers/${id}?step=hospital`);
}

async function rank(transferId: number) {
  const t = getTransfer(transferId)!;
  updateTransfer(transferId, { ranking: await rankHospitals(t.summary, t.reason) });
  audit("ai", "transfer.rank", transferId);
}

export async function runRanking(transferId: number) {
  await rank(transferId);
  revalidatePath(`/transfers/${transferId}`);
}

export async function chooseHospital(transferId: number, hospitalId: string) {
  updateTransfer(transferId, { hospitalId });
  audit("user", "transfer.choose", transferId, hospitalId);
  const queued = queueFormsForTransfer(transferId); // forms agent fills everything on file for this hospital
  after(() => runFills(queued));
  redirect(`/transfers/${transferId}?step=forms`);
}

export async function setOutcome(transferId: number, f: FormData) {
  updateTransfer(transferId, { status: str(f, "status") as Transfer["status"], outcomeReason: str(f, "reason") });
  audit("user", "transfer.outcome", transferId, str(f, "status"));
  revalidatePath(`/transfers/${transferId}`);
}

// ---------- Filled forms (the agent fills; people review) ----------

export async function refillForm(transferId: number, formId: number) {
  const queued = queueFill(transferId, formId);
  after(() => runFills([queued]));
  revalidatePath(`/transfers/${transferId}`);
}

export async function saveFilled(filledId: number, f: FormData) {
  const filled = getFilled(filledId)!;
  const values: FieldValue[] = filled.fields.map((field) => {
    const old = filled.values.find((v) => v.name === field.name);
    const value = field.type === "checkbox" ? String(f.get(`v:${field.name}`) === "on") : str(f, `v:${field.name}`);
    return { name: field.name, value, source: old && old.value === value ? old.source : "edited by user" };
  });
  saveValues(filledId, values);
  if (str(f, "approver")) approve(filledId, str(f, "approver"));
  audit("user", str(f, "approver") ? "form.approve" : "form.edit", filled.transferId, `filled ${filledId}`);
  revalidatePath(`/transfers/${filled.transferId}`);
}

// ---------- Fax ----------

export async function faxPacket(transferId: number, f: FormData) {
  const t = getTransfer(transferId)!;
  const hospital = getHospital(t.hospitalId)!;
  const filled = listFilled(transferId).filter((x) => x.status === "ready");
  if (!filled.length || filled.some((x) => !x.approvedAt)) throw new Error("Every filled form must be approved before faxing.");
  const pdfs = await Promise.all(filled.map(async (x) => (await getFilledPdf(x.id))!.pdf));
  const packet = await buildPacket(t, hospital, pdfs);
  await sendFax(transferId, str(f, "to"), packet);
  audit("user", "fax.send", transferId, `${filled.length} form(s) to ${hospital.id}`);
  redirect(`/transfers/${transferId}?step=fax`);
}

// ---------- Calls ----------

export async function callTransferCenter(transferId: number, f: FormData) {
  await startCall(transferId, str(f, "to"));
  audit("user", "call.start", transferId);
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
  audit("user", "form.upload", null, `form ${id}`);
  after(() => processForm(id));
  redirect(`/forms/${id}`);
}

export async function updateForm(formId: number, f: FormData) {
  db.prepare("UPDATE forms SET name = ?, hospital_id = ? WHERE id = ?").run(str(f, "name"), str(f, "hospitalId") || null, formId);
  after(() => fillOpenTransfersFor(formId));
  revalidatePath(`/forms/${formId}`);
}

export async function rereadForm(formId: number) {
  db.prepare("UPDATE forms SET status = 'reading' WHERE id = ?").run(formId);
  after(() => processForm(formId));
  revalidatePath(`/forms/${formId}`);
}

// Manual correction of the fields the AI found (rarely needed).
export async function saveFormFields(formId: number, fields: FormField[]) {
  db.prepare("UPDATE forms SET fields = ? WHERE id = ?").run(JSON.stringify(fields), formId);
  revalidatePath(`/forms/${formId}`);
}

export async function deleteForm(formId: number) {
  if (db.prepare("SELECT 1 FROM filled_forms WHERE form_id = ?").get(formId)) throw new Error("This form was used in a transfer; it can't be deleted.");
  db.prepare("DELETE FROM forms WHERE id = ?").run(formId);
  redirect("/forms");
}
