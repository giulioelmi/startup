import { all, audit, one, run } from "./db";
import { fillValues, getForm, readForm, saveForm, type FormField } from "./forms";
import { getHospital } from "./hospitals";
import { getTransfer, listTransfers } from "./transfers";

// The forms agent. Nobody fills forms by hand:
//   form arrives (upload / email / fax) -> AI reads it and finds every blank
//   -> AI fills it for every open transfer to that hospital -> a nurse reviews and approves.

export async function processForm(formId: number) {
  const form = await getForm(formId);
  if (!form) return;
  await run("UPDATE forms SET status = 'reading', error = NULL WHERE id = $1", [formId]);
  try {
    const { fields, title, hospitalId } = await readForm(form.pdf);
    await run("UPDATE forms SET fields = $1, status = 'ready', hospital_id = COALESCE(hospital_id, $2), name = $3 WHERE id = $4", [
      JSON.stringify(fields),
      hospitalId,
      title ?? form.name, // the title printed on the form, when the AI read one
      formId,
    ]);
    await audit("ai", "form.read", null, `form ${formId}: ${fields.length} fields`);
  } catch (e) {
    await run("UPDATE forms SET status = 'failed', error = $1 WHERE id = $2", [(e as Error).message, formId]);
    await audit("ai", "form.read.failed", null, `form ${formId}`);
    return;
  }
  await fillOpenTransfersFor(formId);
}

// A newly ready form: fill it for every open transfer going to its hospital.
export async function fillOpenTransfersFor(formId: number) {
  const form = await getForm(formId);
  if (!form?.hospital_id || form.status !== "ready") return;
  const ids: number[] = [];
  for (const t of await listTransfers()) {
    if (t.status === "open" && t.hospitalId === form.hospital_id && !(await alreadyFilled(t.id, formId))) ids.push(await queueFill(t.id, formId));
  }
  await runFills(ids);
}

// A hospital was just chosen: queue every form we have on file for it.
// Await this before responding, so the page shows "AI filling…" right away; then call runFills.
export async function queueFormsForTransfer(transferId: number): Promise<number[]> {
  const t = await getTransfer(transferId);
  if (!t?.hospitalId) return [];
  const forms = await all<{ id: number }>("SELECT id FROM forms WHERE hospital_id = $1 AND status = 'ready'", [t.hospitalId]);
  const ids: number[] = [];
  for (const f of forms) if (!(await alreadyFilled(transferId, f.id))) ids.push(await queueFill(transferId, f.id));
  return ids;
}

const alreadyFilled = async (transferId: number, formId: number) =>
  !!(await one("SELECT 1 FROM filled_forms WHERE transfer_id = $1 AND form_id = $2", [transferId, formId]));

// Creates the (empty) filled form in "filling" state. Re-filling replaces the previous one.
export async function queueFill(transferId: number, formId: number): Promise<number> {
  await run("DELETE FROM filled_forms WHERE transfer_id = $1 AND form_id = $2", [transferId, formId]);
  return (await run("INSERT INTO filled_forms (transfer_id, form_id) VALUES ($1, $2) RETURNING id", [transferId, formId])).id;
}

export const runFills = (ids: number[]) => Promise.all(ids.map(runFill));

// The AI fills one queued form from the chart.
async function runFill(id: number) {
  const { transfer_id: transferId, form_id: formId } = (await one<{ transfer_id: number; form_id: number }>(
    "SELECT transfer_id, form_id FROM filled_forms WHERE id = $1",
    [id],
  ))!;
  try {
    const t = (await getTransfer(transferId))!;
    const fields = JSON.parse((await getForm(formId))!.fields) as FormField[];
    const values = await fillValues(fields, t, await getHospital(t.hospitalId));
    await run("UPDATE filled_forms SET values_json = $1, status = 'ready' WHERE id = $2", [JSON.stringify(values), id]);
    const missing = values.filter((v) => v.source === "not in record").length;
    await audit("ai", "form.fill", transferId, `form ${formId}: ${values.length - missing} of ${values.length} fields filled`);
  } catch (e) {
    await run("UPDATE filled_forms SET status = 'failed', error = $1 WHERE id = $2", [(e as Error).message, id]);
    await audit("ai", "form.fill.failed", transferId, `form ${formId}`);
  }
}

// Download a facility's public forms (its `formUrls`) into the forms inbox, once each.
// Returns the new form ids; pass them to processForm to read and fill them.
export async function downloadForms(hospitalId: string): Promise<number[]> {
  const h = await getHospital(hospitalId);
  const ids: number[] = [];
  for (const url of h?.formUrls ?? []) {
    if (await one("SELECT 1 FROM forms WHERE sender = $1", [url])) continue;
    try {
      const res = await fetch(url);
      const mime = res.headers.get("content-type")?.split(";")[0] ?? "";
      if (!res.ok || !["application/pdf", "image/png", "image/jpeg"].includes(mime)) throw new Error(`${res.status} ${mime}`);
      const name = decodeURIComponent(url.split("/").pop()!.replace(/\.[a-z]+$/i, "")).replace(/[-_]+/g, " ");
      ids.push(await saveForm({ name, bytes: new Uint8Array(await res.arrayBuffer()), mime, hospitalId, source: "web", sender: url }));
      await audit("ai", "form.download", null, `form ${ids.at(-1)} for ${hospitalId}`);
    } catch (e) {
      console.error(`Could not download form ${url}: ${(e as Error).message}`);
    }
  }
  return ids;
}
