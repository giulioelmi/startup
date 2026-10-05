import { NOW, all, one, run } from "./db";
import { getForm, renderFilled, type FieldValue, type FormField } from "./forms";

export type Filled = {
  id: number;
  transferId: number;
  formId: number;
  formName: string;
  fields: FormField[];
  values: FieldValue[];
  status: "filling" | "ready" | "failed";
  error: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const parse = (r: any): Filled => ({
  id: r.id,
  transferId: r.transfer_id,
  formId: r.form_id,
  formName: r.name,
  fields: JSON.parse(r.fields),
  values: JSON.parse(r.values_json),
  status: r.status,
  error: r.error,
  approvedBy: r.approved_by,
  approvedAt: r.approved_at,
});

const SELECT = "SELECT ff.*, f.name, f.fields FROM filled_forms ff JOIN forms f ON f.id = ff.form_id";

export async function listFilled(transferId: number): Promise<Filled[]> {
  return (await all(`${SELECT} WHERE ff.transfer_id = $1 ORDER BY ff.id`, [transferId])).map(parse);
}

export async function getFilled(id: number): Promise<Filled | null> {
  const r = await one(`${SELECT} WHERE ff.id = $1`, [id]);
  return r ? parse(r) : null;
}

// Editing un-approves: a person must re-check after any change.
export async function saveValues(id: number, values: FieldValue[]) {
  await run("UPDATE filled_forms SET values_json = $1, approved_by = NULL, approved_at = NULL WHERE id = $2", [JSON.stringify(values), id]);
}

export async function approve(id: number, by: string) {
  await run(`UPDATE filled_forms SET approved_by = $1, approved_at = ${NOW} WHERE id = $2`, [by, id]);
}

export async function getFilledPdf(id: number) {
  const f = await getFilled(id);
  const form = f && (await getForm(f.formId));
  if (!f || !form) return null;
  return { transferId: f.transferId, approved: !!f.approvedAt, pdf: await renderFilled(form.pdf, f.fields, f.values) };
}
