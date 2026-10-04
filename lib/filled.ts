import { db } from "./db";
import { getForm, renderFilled, type FieldValue, type FormField } from "./forms";

export type Filled = {
  id: number;
  transferId: number;
  formId: number;
  formName: string;
  fields: FormField[];
  values: FieldValue[];
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
  approvedBy: r.approved_by,
  approvedAt: r.approved_at,
});

const SELECT = "SELECT ff.*, f.name, f.fields FROM filled_forms ff JOIN forms f ON f.id = ff.form_id";

export function listFilled(transferId: number): Filled[] {
  return db.prepare(`${SELECT} WHERE ff.transfer_id = ? ORDER BY ff.id`).all(transferId).map(parse);
}

export function getFilled(id: number): Filled | null {
  const r = db.prepare(`${SELECT} WHERE ff.id = ?`).get(id);
  return r ? parse(r) : null;
}

export function createFilled(transferId: number, formId: number, values: FieldValue[]) {
  db.prepare("INSERT INTO filled_forms (transfer_id, form_id, values_json) VALUES (?, ?, ?)").run(transferId, formId, JSON.stringify(values));
}

// Editing un-approves: a person must re-check after any change.
export function saveValues(id: number, values: FieldValue[]) {
  db.prepare("UPDATE filled_forms SET values_json = ?, approved_by = NULL, approved_at = NULL WHERE id = ?").run(JSON.stringify(values), id);
}

export function approve(id: number, by: string) {
  db.prepare("UPDATE filled_forms SET approved_by = ?, approved_at = datetime('now') WHERE id = ?").run(by, id);
}

export async function getFilledPdf(id: number) {
  const f = getFilled(id);
  const form = f && getForm(f.formId);
  if (!f || !form) return null;
  return { transferId: f.transferId, approved: !!f.approvedAt, pdf: await renderFilled(form.pdf, f.fields, f.values) };
}
