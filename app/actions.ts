"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { audit, one, run } from "@/lib/db";
import { getPatientRecord } from "@/lib/epic";
import { summarize } from "@/lib/summary";
import { createTransfer, getTransfer, setRankingStatus, updateTransfer, type Transfer, type TransferDetails } from "@/lib/transfers";
import { rankHospitals } from "@/lib/ranking";
import { CAPABILITIES, deleteHospital, getHospital, saveHospital, type Capability, type Hospital } from "@/lib/hospitals";
import { STEP_TYPES, type WorkflowStep } from "@/lib/workflow";
import { saveForm, type FieldValue, type FormField } from "@/lib/forms";
import { approve, getFilled, getFilledPdf, listFilled, saveValues } from "@/lib/filled";
import { downloadForms, fillOpenTransfersFor, processForm, queueFill, queueFormsForTransfer, runFills } from "@/lib/agent";
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
  await startRanking(id);
  redirect("/");
}

// Ranking runs in the background; the nurse goes back to the list, which shows a loader on this case.
async function startRanking(transferId: number) {
  await setRankingStatus(transferId, "running");
  after(() => rank(transferId));
}

async function rank(transferId: number) {
  try {
    const t = (await getTransfer(transferId))!;
    await updateTransfer(transferId, { ranking: await rankHospitals(t.summary, t.reason) });
    await setRankingStatus(transferId, null);
    await audit("ai", "transfer.rank", transferId);
  } catch (e) {
    console.error(e);
    await setRankingStatus(transferId, "failed", String((e as Error).message ?? e).slice(0, 500)); // the page shows it and offers a retry
  }
}

export async function runRanking(transferId: number) {
  await startRanking(transferId);
  redirect("/");
}

export async function chooseHospital(transferId: number, hospitalId: string) {
  const hospital = (await getHospital(hospitalId))!;
  await updateTransfer(transferId, { hospitalId, workflow: hospital.workflow }); // the transfer now follows this facility's workflow
  await audit("user", "transfer.choose", transferId, hospitalId);
  const queued = await queueFormsForTransfer(transferId); // forms agent fills everything on file for this hospital
  after(async () => {
    await runFills(queued);
    await Promise.all((await downloadForms(hospitalId)).map(processForm)); // its public forms not on file yet
  });
  redirect(`/transfers/${transferId}?step=w0`);
}

// Staff mark a workflow step as done (or not needed); clicking again un-marks it.
export async function toggleStep(transferId: number, index: number) {
  const t = (await getTransfer(transferId))!;
  const skipped = t.skipped.includes(index) ? t.skipped.filter((i) => i !== index) : [...t.skipped, index];
  await updateTransfer(transferId, { skipped });
  if (skipped.length > t.skipped.length) await audit("user", "step.skip", transferId, `step ${index + 1}`);
  revalidatePath(`/transfers/${transferId}`);
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
  const hospital = (await getHospital(t.hospitalId))!;
  const filled = (await listFilled(transferId)).filter((x) => x.status === "ready");
  if (filled.some((x) => !x.approvedAt)) throw new Error("Every filled form must be approved before faxing.");
  const pdfs = await Promise.all(filled.map(async (x) => (await getFilledPdf(x.id))!.pdf));
  const packet = await buildPacket(t, hospital, pdfs);
  await sendFax(transferId, str(f, "to"), packet);
  await audit("user", "fax.send", transferId, `${filled.length} form(s) to ${hospital.id}`);
  redirect(`/transfers/${transferId}?step=${str(f, "step")}`);
}

// ---------- Calls ----------

export async function callTransferCenter(transferId: number, f: FormData) {
  await startCall(transferId, str(f, "to"));
  await audit("user", "call.start", transferId);
  redirect(`/transfers/${transferId}?step=${str(f, "step")}`);
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

// ---------- Facilities ----------

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// `id` is null for a new facility.
export async function saveFacility(id: string | null, f: FormData) {
  const workflow = (JSON.parse(str(f, "workflow") || "[]") as WorkflowStep[]).filter((s) => s.type in STEP_TYPES);
  const h: Hospital = {
    id: id ?? (slug(str(f, "name")) || `facility-${Date.now()}`),
    name: str(f, "name"),
    address: str(f, "address"),
    lat: Number(str(f, "lat")) || 0,
    lng: Number(str(f, "lng")) || 0,
    transferPhone: str(f, "transferPhone"),
    transferFax: str(f, "transferFax") || null,
    transferEmail: str(f, "transferEmail") || null,
    emailDomains: lines(str(f, "emailDomains").replace(/,/g, "\n")),
    verified: f.get("verified") === "on",
    requiredInfo: lines(str(f, "requiredInfo")),
    intakeNotes: str(f, "intakeNotes"),
    capabilities: f.getAll("capabilities").map(String).filter((c): c is Capability => c in CAPABILITIES),
    workflow,
    formUrls: lines(str(f, "formUrls")),
  };
  if (!id && (await getHospital(h.id))) throw new Error(`A facility called "${h.name}" already exists.`);
  await saveHospital(h);
  await audit("user", id ? "facility.edit" : "facility.create", null, h.id);
  redirect(`/facilities/${h.id}`);
}

export async function removeFacility(id: string) {
  if (await one("SELECT 1 FROM transfers WHERE hospital_id = $1", [id])) throw new Error("This facility has transfers; it can't be deleted.");
  await deleteHospital(id);
  await audit("user", "facility.delete", null, id);
  redirect("/facilities");
}

export async function downloadFacilityForms(id: string) {
  const ids = await downloadForms(id);
  after(() => Promise.all(ids.map(processForm)));
  revalidatePath(`/facilities/${id}`);
}
