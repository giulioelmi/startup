"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { audit, one, run } from "@/lib/db";
import { ehrName, getPatientRecord } from "@/lib/ehr";
import { summarize } from "@/lib/summary";
import { createTransfer, deleteTransfer, getTransfer, moveTransfer, setRankingStatus, updateTransfer, type Transfer, type TransferDetails } from "@/lib/transfers";
import { rankHospitals } from "@/lib/ranking";
import { CAPABILITIES, deleteHospital, getHospital, saveHospital, type Capability, type Hospital } from "@/lib/hospitals";
import { STEP_TYPES, type WorkflowStep } from "@/lib/workflow";
import { saveForm, type FieldValue, type FormField } from "@/lib/forms";
import { approve, getFilled, getFilledPdf, listFilled, saveValues } from "@/lib/filled";
import { applyTo, downloadForms, fillOpenTransfersFor, nextChoice, processForm, queueFill, recordOutcome, runFills } from "@/lib/agent";
import { buildPacket, sendFax, whyNotFax } from "@/lib/fax";
import { startCall } from "@/lib/voice";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// ---------- Transfers ----------

export async function startTransfer(f: FormData) {
  const missing = [["reason", "Reason for transfer"], ["referringPhysician", "Referring physician"], ["callbackPhone", "Physician callback"], ["levelOfCare", "Level of care"], ["sendingHospital", "Sending hospital"]]
    .filter(([k]) => !str(f, k))
    .map(([, label]) => label);
  if (missing.length) return `Please fill in: ${missing.join(", ")}.`;
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
  await audit("user", "transfer.create", id, `chart snapshot from ${ehrName(patientId)}`);
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
    const ranking = await rankHospitals(t.summary, t.reason);
    await updateTransfer(transferId, { ranking });
    await setRankingStatus(transferId, null);
    await audit("ai", ranking.ai ? "transfer.rank" : "transfer.rank.fallback", transferId);
  } catch (e) {
    console.error(e);
    await setRankingStatus(transferId, "failed", String((e as Error).message ?? e).slice(0, 500)); // the page shows it and offers a retry
  }
}

export async function runRanking(transferId: number) {
  await startRanking(transferId);
  redirect("/");
}

// The nurse's hospitals, in the order to apply to them. The transfer applies to the first one that hasn't
// declined; when one declines, it moves on to the next. Re-ordering keeps the hospital being applied to now.
export async function chooseHospitals(transferId: number, f: FormData) {
  const choices = f.getAll("hospital").map(String);
  if (!choices.length) return "Pick at least one hospital.";
  const t = (await getTransfer(transferId))!;
  await updateTransfer(transferId, { choices });
  await audit("user", "transfer.choose", transferId, choices.join(", "));
  if (t.hospitalId && choices.includes(t.hospitalId) && !t.declines.some((d) => d.hospitalId === t.hospitalId)) {
    revalidatePath(`/transfers/${transferId}`);
    return;
  }
  const next = await nextChoice(t, choices);
  if (!next) return "Every hospital on the list has declined. Add another one.";
  await updateTransfer(transferId, { status: "open" });
  after(await applyTo(transferId, next));
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
  if (str(f, "status") === "declined" && !str(f, "reason")) return "Add the reason they declined.";
  await audit("user", "transfer.outcome", transferId, str(f, "status"));
  const next = await recordOutcome(transferId, str(f, "status") as Transfer["status"], str(f, "reason"), "user");
  if (next) {
    after(next);
    redirect(`/transfers/${transferId}?step=w0`); // on to the next hospital's workflow
  }
  revalidatePath(`/transfers/${transferId}`);
}

export async function moveInWorklist(transferId: number, direction: -1 | 1) {
  await moveTransfer(transferId, direction);
  revalidatePath("/");
}

export async function removeTransfer(transferId: number) {
  await deleteTransfer(transferId);
  await audit("user", "transfer.delete", transferId);
  revalidatePath("/");
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
  await saveValues(filledId, values); // also how staff fill a form by hand when the AI couldn't
  if (str(f, "approver")) await approve(filledId, str(f, "approver"));
  await audit("user", str(f, "approver") ? "form.approve" : "form.edit", filled.transferId, `filled ${filledId}`);
  revalidatePath(`/transfers/${filled.transferId}`);
}

// ---------- Fax ----------

export async function faxPacket(transferId: number, f: FormData) {
  const t = (await getTransfer(transferId))!;
  const hospital = (await getHospital(t.hospitalId))!;
  const all = await listFilled(transferId);
  const blocked = whyNotFax(t, all);
  if (blocked) return blocked;
  if (!str(f, "to")) return "Enter the fax number.";
  const filled = all.filter((x) => x.approvedAt);
  const pdfs = await Promise.all(filled.map(async (x) => (await getFilledPdf(x.id))!.pdf));
  const packet = await buildPacket(t, hospital, pdfs);
  await sendFax(transferId, str(f, "to"), packet);
  await audit("user", "fax.send", transferId, `${filled.length} form(s) to ${hospital.id}`);
  redirect(`/transfers/${transferId}?step=${str(f, "step")}`);
}

// ---------- Calls ----------

export async function callTransferCenter(transferId: number, f: FormData) {
  if (!str(f, "to")) return "Enter the number to call.";
  try {
    await startCall(transferId, str(f, "to"));
  } catch (e) {
    return `Could not place the call: ${(e as Error).message}`;
  }
  await audit("user", "call.start", transferId);
  redirect(`/transfers/${transferId}?step=${str(f, "step")}`);
}

// ---------- Form library ----------

export async function uploadForm(f: FormData) {
  const file = f.get("file") as File | null;
  if (!file?.size) return "Choose a file to upload.";
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
  if (await one("SELECT 1 FROM filled_forms WHERE form_id = $1", [formId])) return "This form was used in a transfer, so it can't be deleted.";
  await run("DELETE FROM forms WHERE id = $1", [formId]);
  redirect("/forms");
}

// ---------- Facilities ----------

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// `id` is null for a new facility.
export async function saveFacility(id: string | null, f: FormData) {
  if (!str(f, "name") || !str(f, "transferPhone")) return "Name and transfer center phone are required.";
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
    edited: true,
  };
  if (!id && (await getHospital(h.id))) return `A facility called "${h.name}" already exists.`;
  await saveHospital(h);
  await audit("user", id ? "facility.edit" : "facility.create", null, h.id);
  redirect(`/facilities/${h.id}`);
}

export async function removeFacility(id: string) {
  if (await one("SELECT 1 FROM transfers WHERE hospital_id = $1 OR choices LIKE $2", [id, `%${JSON.stringify(id)}%`]))
    return "This facility is on a transfer's hospital list, so it can't be deleted.";
  await deleteHospital(id);
  await audit("user", "facility.delete", null, id);
  redirect("/facilities");
}

export async function downloadFacilityForms(id: string) {
  const ids = await downloadForms(id);
  after(() => Promise.all(ids.map(processForm)));
  revalidatePath(`/facilities/${id}`);
  const failed = [];
  for (const url of (await getHospital(id))?.formUrls ?? []) if (!(await one("SELECT 1 FROM forms WHERE sender = $1", [url]))) failed.push(url);
  if (failed.length) return `Couldn't download ${failed.length} form(s) from the hospital website. Check the links, or upload the forms by hand.`;
}
