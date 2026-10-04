import { db } from "./db";
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

export function getTransfer(id: number): Transfer | null {
  const row = db.prepare("SELECT * FROM transfers WHERE id = ?").get(id);
  return row ? parse(row) : null;
}

export function listTransfers(): Transfer[] {
  return db.prepare("SELECT * FROM transfers ORDER BY id DESC").all().map(parse);
}

export function createTransfer(t: Pick<Transfer, "patientId" | "patientName" | "reason" | "details" | "summary">): number {
  const r = db
    .prepare("INSERT INTO transfers (patient_id, patient_name, reason, details, summary) VALUES (?, ?, ?, ?, ?)")
    .run(t.patientId, t.patientName, t.reason, JSON.stringify(t.details), JSON.stringify(t.summary));
  return Number(r.lastInsertRowid);
}

export function updateTransfer(id: number, fields: { ranking?: Ranking; hospitalId?: string; status?: Transfer["status"]; outcomeReason?: string }) {
  if (fields.ranking) db.prepare("UPDATE transfers SET ranking = ? WHERE id = ?").run(JSON.stringify(fields.ranking), id);
  if (fields.hospitalId) db.prepare("UPDATE transfers SET hospital_id = ? WHERE id = ?").run(fields.hospitalId, id);
  if (fields.status) db.prepare("UPDATE transfers SET status = ?, outcome_reason = ? WHERE id = ?").run(fields.status, fields.outcomeReason ?? null, id);
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
