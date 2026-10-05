import { all, one, run } from "./db";
import type { ClinicalSummary } from "./summary";
import type { Ranking } from "./ranking";

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
  hospitalId: string | null;
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
    hospitalId: row.hospital_id,
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
  return (await all("SELECT * FROM transfers ORDER BY id DESC")).map(parse);
}

export async function createTransfer(t: Pick<Transfer, "patientId" | "patientName" | "reason" | "details" | "summary">): Promise<number> {
  const { id } = await run(
    "INSERT INTO transfers (patient_id, patient_name, reason, details, summary) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [t.patientId, t.patientName, t.reason, JSON.stringify(t.details), JSON.stringify(t.summary)],
  );
  return id;
}

export async function updateTransfer(id: number, fields: { ranking?: Ranking; hospitalId?: string; status?: Transfer["status"]; outcomeReason?: string }) {
  if (fields.ranking) await run("UPDATE transfers SET ranking = $1 WHERE id = $2", [JSON.stringify(fields.ranking), id]);
  if (fields.hospitalId) await run("UPDATE transfers SET hospital_id = $1 WHERE id = $2", [fields.hospitalId, id]);
  if (fields.status) await run("UPDATE transfers SET status = $1, outcome_reason = $2 WHERE id = $3", [fields.status, fields.outcomeReason ?? null, id]);
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
