import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// One SQLite file. For a pilot, move to Postgres (same tables).
const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
fs.mkdirSync(dir, { recursive: true });

export const db = new Database(path.join(dir, "app.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS forms (
  id INTEGER PRIMARY KEY,
  hospital_id TEXT,              -- null until someone assigns it
  name TEXT NOT NULL,
  pdf BLOB NOT NULL,
  fields TEXT NOT NULL DEFAULT '[]',  -- JSON FormField[]
  status TEXT NOT NULL DEFAULT 'reading',  -- reading | ready | failed (AI finding the fields)
  error TEXT,
  source TEXT NOT NULL,          -- upload | email | fax
  sender TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY,
  patient_id TEXT NOT NULL,
  patient_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',  -- JSON TransferDetails (who is sending, level of care)
  summary TEXT NOT NULL,         -- JSON ClinicalSummary snapshot
  ranking TEXT,                  -- JSON Ranking
  hospital_id TEXT,              -- chosen receiving hospital
  status TEXT NOT NULL DEFAULT 'open',  -- open | accepted | declined | cancelled
  outcome_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS filled_forms (
  id INTEGER PRIMARY KEY,
  transfer_id INTEGER NOT NULL,
  form_id INTEGER NOT NULL,
  values_json TEXT NOT NULL DEFAULT '[]',  -- JSON FieldValue[]
  status TEXT NOT NULL DEFAULT 'filling',  -- filling | ready | failed
  error TEXT,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY,
  transfer_id INTEGER,
  call_sid TEXT UNIQUE,
  direction TEXT NOT NULL,       -- outbound | inbound
  number TEXT,
  status TEXT,
  transcript TEXT NOT NULL DEFAULT '[]',  -- JSON {who, text, at}[]
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS faxes (
  id INTEGER PRIMARY KEY,
  transfer_id INTEGER NOT NULL,
  to_number TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_id TEXT,
  status TEXT NOT NULL,
  pdf BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  transfer_id INTEGER,
  detail TEXT
);
`);

// Append-only log of every read/send of patient data. Keep PHI out of `detail`.
export function audit(actor: string, action: string, transferId?: number | null, detail?: string) {
  db.prepare("INSERT INTO audit (actor, action, transfer_id, detail) VALUES (?, ?, ?, ?)").run(
    actor,
    action,
    transferId ?? null,
    detail ?? null,
  );
}
