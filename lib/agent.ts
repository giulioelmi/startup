import { db, audit } from "./db";
import { fillValues, getForm, readForm, type FormField } from "./forms";
import { getHospital } from "./hospitals";
import { getTransfer, listTransfers } from "./transfers";

// The forms agent. Nobody fills forms by hand:
//   form arrives (upload / email / fax) -> AI reads it and finds every blank
//   -> AI fills it for every open transfer to that hospital -> a nurse reviews and approves.

export async function processForm(formId: number) {
  const form = getForm(formId);
  if (!form) return;
  db.prepare("UPDATE forms SET status = 'reading', error = NULL WHERE id = ?").run(formId);
  try {
    const { fields, title, hospitalId } = await readForm(form.pdf);
    db.prepare("UPDATE forms SET fields = ?, status = 'ready', hospital_id = COALESCE(hospital_id, ?), name = ? WHERE id = ?").run(
      JSON.stringify(fields),
      hospitalId,
      title ?? form.name, // the title printed on the form, when the AI read one
      formId,
    );
    audit("ai", "form.read", null, `form ${formId}: ${fields.length} fields`);
  } catch (e) {
    db.prepare("UPDATE forms SET status = 'failed', error = ? WHERE id = ?").run((e as Error).message, formId);
    audit("ai", "form.read.failed", null, `form ${formId}`);
    return;
  }
  await fillOpenTransfersFor(formId);
}

// A newly ready form: fill it for every open transfer going to its hospital.
export async function fillOpenTransfersFor(formId: number) {
  const form = getForm(formId);
  if (!form?.hospital_id || form.status !== "ready") return;
  const transfers = listTransfers().filter((t) => t.status === "open" && t.hospitalId === form.hospital_id && !alreadyFilled(t.id, formId));
  await runFills(transfers.map((t) => queueFill(t.id, formId)));
}

// A hospital was just chosen: queue every form we have on file for it.
// Synchronous, so the page shows "AI filling…" right away; then call runFills.
export function queueFormsForTransfer(transferId: number): number[] {
  const t = getTransfer(transferId);
  if (!t?.hospitalId) return [];
  const forms = db.prepare("SELECT id FROM forms WHERE hospital_id = ? AND status = 'ready'").all(t.hospitalId) as { id: number }[];
  return forms.filter((f) => !alreadyFilled(transferId, f.id)).map((f) => queueFill(transferId, f.id));
}

const alreadyFilled = (transferId: number, formId: number) =>
  !!db.prepare("SELECT 1 FROM filled_forms WHERE transfer_id = ? AND form_id = ?").get(transferId, formId);

// Creates the (empty) filled form in "filling" state. Re-filling replaces the previous one.
export function queueFill(transferId: number, formId: number): number {
  db.prepare("DELETE FROM filled_forms WHERE transfer_id = ? AND form_id = ?").run(transferId, formId);
  return Number(db.prepare("INSERT INTO filled_forms (transfer_id, form_id) VALUES (?, ?)").run(transferId, formId).lastInsertRowid);
}

export const runFills = (ids: number[]) => Promise.all(ids.map(runFill));

// The AI fills one queued form from the chart.
async function runFill(id: number) {
  const { transfer_id: transferId, form_id: formId } = db.prepare("SELECT transfer_id, form_id FROM filled_forms WHERE id = ?").get(id) as {
    transfer_id: number;
    form_id: number;
  };
  try {
    const t = getTransfer(transferId)!;
    const fields = JSON.parse(getForm(formId)!.fields) as FormField[];
    const values = await fillValues(fields, t, getHospital(t.hospitalId));
    db.prepare("UPDATE filled_forms SET values_json = ?, status = 'ready' WHERE id = ?").run(JSON.stringify(values), id);
    const missing = values.filter((v) => v.source === "not in record").length;
    audit("ai", "form.fill", transferId, `form ${formId}: ${values.length - missing} of ${values.length} fields filled`);
  } catch (e) {
    db.prepare("UPDATE filled_forms SET status = 'failed', error = ? WHERE id = ?").run((e as Error).message, id);
    audit("ai", "form.fill.failed", transferId, `form ${formId}`);
  }
}
