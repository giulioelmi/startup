import { all, NOW, one, run } from "./db";
import type { ClinicalSummary } from "./summary";
import type { Ranking } from "./ranking";
import type { WorkflowStep } from "./workflow";

export type TransferDetails = {
  sendingHospital: string;
  sendingPhone: string;
  sendingFax: string;
  referringPhysician: string;
  callbackPhone: string;
  caseManager: string;
  levelOfCare: string; // ICU, step-down, med-surg, ...
  emergent: boolean;
};

export type Transfer = {
  id: number;
  patientId: string;
  patientName: string;
  reason: string;
  details: TransferDetails;
  summary: ClinicalSummary;
  ranking: Ranking | null;
  rankingStatus: "running" | "failed" | null; // the AI ranks hospitals in the background
  rankingError: string | null;
  hospitalId: string | null; // the hospital being applied to now
  hospitalSince: string | null; // calls and faxes before this belong to earlier hospitals
  choices: string[]; // the nurse's hospitals, in the order to apply to them
  workflow: WorkflowStep[] | null; // the chosen facility's workflow, copied when it was chosen
  skipped: number[]; // workflow steps staff marked as done/skipped
  status: "open" | "accepted" | "declined" | "cancelled";
  outcomeReason: string | null;
  createdAt: string;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function parse(row: any): Transfer {
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    reason: row.reason,
    details: JSON.parse(row.details),
    summary: JSON.parse(row.summary),
    ranking: row.ranking ? JSON.parse(row.ranking) : null,
    rankingStatus: row.ranking_status,
    rankingError: row.ranking_error,
    hospitalId: row.hospital_id,
    hospitalSince: row.hospital_since,
    choices: JSON.parse(row.choices ?? "[]"),
    workflow: row.workflow ? JSON.parse(row.workflow) : null,
    skipped: JSON.parse(row.skipped ?? "[]"),
    status: row.status,
    outcomeReason: row.outcome_reason,
    createdAt: row.created_at,
  };
}

export async function getTransfer(id: number): Promise<Transfer | null> {
  const row = await one("SELECT * FROM transfers WHERE id = $1", [id]);
  return row ? parse(row) : null;
}

export async function listTransfers(): Promise<Transfer[]> {
  return (await all("SELECT * FROM transfers ORDER BY COALESCE(sort_order, id) DESC")).map(parse);
}

// Swap a transfer with its neighbor in the worklist (direction -1 = up, 1 = down).
export async function moveTransfer(id: number, direction: -1 | 1) {
  const rows = await all<{ id: number; pos: number }>("SELECT id, COALESCE(sort_order, id) AS pos FROM transfers ORDER BY pos DESC");
  const i = rows.findIndex((r) => r.id === id);
  const other = rows[i + direction];
  if (i < 0 || !other) return;
  await run("UPDATE transfers SET sort_order = $1 WHERE id = $2", [other.pos, id]);
  await run("UPDATE transfers SET sort_order = $1 WHERE id = $2", [rows[i].pos, other.id]);
}

export async function deleteTransfer(id: number) {
  for (const table of ["filled_forms", "calls", "faxes"]) await run(`DELETE FROM ${table} WHERE transfer_id = $1`, [id]);
  await run("DELETE FROM transfers WHERE id = $1", [id]);
}

export async function createTransfer(t: Pick<Transfer, "patientId" | "patientName" | "reason" | "details" | "summary">): Promise<number> {
  const { id } = await run(
    "INSERT INTO transfers (patient_id, patient_name, reason, details, summary) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [t.patientId, t.patientName, t.reason, JSON.stringify(t.details), JSON.stringify(t.summary)],
  );
  return id;
}

export async function updateTransfer(
  id: number,
  fields: { ranking?: Ranking; hospitalId?: string; choices?: string[]; workflow?: WorkflowStep[]; skipped?: number[]; status?: Transfer["status"]; outcomeReason?: string },
) {
  if (fields.ranking) await run("UPDATE transfers SET ranking = $1 WHERE id = $2", [JSON.stringify(fields.ranking), id]);
  if (fields.hospitalId) await run(`UPDATE transfers SET hospital_id = $1, hospital_since = ${NOW} WHERE id = $2`, [fields.hospitalId, id]);
  if (fields.choices) await run("UPDATE transfers SET choices = $1 WHERE id = $2", [JSON.stringify(fields.choices), id]);
  if (fields.workflow) await run("UPDATE transfers SET workflow = $1, skipped = '[]' WHERE id = $2", [JSON.stringify(fields.workflow), id]);
  if (fields.skipped) await run("UPDATE transfers SET skipped = $1 WHERE id = $2", [JSON.stringify(fields.skipped), id]);
  if (fields.status) await run("UPDATE transfers SET status = $1, outcome_reason = $2 WHERE id = $3", [fields.status, fields.outcomeReason ?? null, id]);
}

export async function setRankingStatus(id: number, status: Transfer["rankingStatus"], error: string | null = null) {
  await run("UPDATE transfers SET ranking_status = $1, ranking_error = $2 WHERE id = $3", [status, error, id]);
}

// Default "sending side" details come from env so staff don't retype them.
export function defaultDetails(): TransferDetails {
  return {
    sendingHospital: process.env.SENDING_HOSPITAL_NAME || "",
    sendingPhone: process.env.SENDING_HOSPITAL_PHONE || "",
    sendingFax: process.env.SENDING_HOSPITAL_FAX || "",
    referringPhysician: "",
    callbackPhone: process.env.SENDING_HOSPITAL_PHONE || "",
    caseManager: "",
    levelOfCare: "ICU",
    emergent: false,
  };
}
