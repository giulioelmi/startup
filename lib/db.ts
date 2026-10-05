import fs from "node:fs";
import path from "node:path";

// Postgres everywhere, two backends:
//  - DATABASE_URL set (Vercel + Neon): Neon's serverless HTTP driver.
//  - not set (laptop, tests): PGlite, an embedded Postgres stored in DATA_DIR (or in memory for tests).
// Same SQL for both. Use the helpers below; parameters are $1, $2, ...

type Row = Record<string, unknown>;
type Query = (sql: string, params: unknown[]) => Promise<Row[]>;

// Timestamps are stored as UTC text ("2026-10-05 14:03:00") so they display as-is.
export const NOW = "to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS forms (
    id SERIAL PRIMARY KEY,
    hospital_id TEXT,                     -- null until the AI or a person assigns it
    name TEXT NOT NULL,
    pdf BYTEA NOT NULL,
    fields TEXT NOT NULL DEFAULT '[]',    -- JSON FormField[]
    status TEXT NOT NULL DEFAULT 'reading',  -- reading | ready | failed (AI finding the fields)
    error TEXT,
    source TEXT NOT NULL,                 -- upload | email | fax | web (downloaded from the hospital site)
    sender TEXT,
    received_at TEXT NOT NULL DEFAULT ${NOW}
  )`,
  `CREATE TABLE IF NOT EXISTS transfers (
    id SERIAL PRIMARY KEY,
    patient_id TEXT NOT NULL,
    patient_name TEXT NOT NULL,
    reason TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '{}',   -- JSON TransferDetails (who is sending, level of care)
    summary TEXT NOT NULL,                -- JSON ClinicalSummary snapshot
    ranking TEXT,                         -- JSON Ranking
    hospital_id TEXT,                     -- chosen receiving hospital
    status TEXT NOT NULL DEFAULT 'open',  -- open | accepted | declined | cancelled
    outcome_reason TEXT,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  )`,
  `CREATE TABLE IF NOT EXISTS filled_forms (
    id SERIAL PRIMARY KEY,
    transfer_id INTEGER NOT NULL,
    form_id INTEGER NOT NULL,
    values_json TEXT NOT NULL DEFAULT '[]',  -- JSON FieldValue[]
    status TEXT NOT NULL DEFAULT 'filling',  -- filling | ready | failed
    error TEXT,
    approved_by TEXT,
    approved_at TEXT,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  )`,
  `CREATE TABLE IF NOT EXISTS calls (
    id SERIAL PRIMARY KEY,
    transfer_id INTEGER,
    call_sid TEXT UNIQUE,
    direction TEXT NOT NULL,              -- outbound | inbound
    number TEXT,
    status TEXT,
    transcript TEXT NOT NULL DEFAULT '[]',  -- JSON {who, text, at}[]
    created_at TEXT NOT NULL DEFAULT ${NOW}
  )`,
  `CREATE TABLE IF NOT EXISTS faxes (
    id SERIAL PRIMARY KEY,
    transfer_id INTEGER NOT NULL,
    to_number TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_id TEXT,
    status TEXT NOT NULL,
    pdf BYTEA NOT NULL,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  )`,
  `CREATE TABLE IF NOT EXISTS facilities (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL                    -- JSON Hospital (contact details, services, workflow)
  )`,
  // The chosen facility's workflow, copied when the hospital is chosen (later edits don't change a running transfer),
  // and the workflow steps staff marked as done or skipped.
  `ALTER TABLE transfers ADD COLUMN IF NOT EXISTS workflow TEXT`,
  `ALTER TABLE transfers ADD COLUMN IF NOT EXISTS skipped TEXT NOT NULL DEFAULT '[]'`,
  `CREATE TABLE IF NOT EXISTS audit (
    id SERIAL PRIMARY KEY,
    at TEXT NOT NULL DEFAULT ${NOW},
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    transfer_id INTEGER,
    detail TEXT
  )`,
];

async function connect(): Promise<Query> {
  if (process.env.DATABASE_URL) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(process.env.DATABASE_URL);
    return (text, params) => sql.query(text, params) as Promise<Row[]>;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.DATA_DIR === "memory" ? undefined : path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "pg");
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const pg = new PGlite(dir);
  return async (text, params) => (await pg.query<Row>(text, params)).rows;
}

// Connect and create tables once per process. Kept on globalThis because Next.js may load
// this module more than once (pages and API routes are bundled separately), and two
// embedded databases on the same folder would not see each other's writes.
const g = globalThis as { transferAiDb?: Promise<Query> };
function db(): Promise<Query> {
  g.transferAiDb ??= connect().then(async (query) => {
    for (const statement of SCHEMA) await query(statement, []);
    return query;
  });
  return g.transferAiDb;
}

export async function all<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await (await db())(sql, params)) as T[];
}

export async function one<T = Row>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await all<T>(sql, params))[0];
}

// For INSERT/UPDATE/DELETE. Add "RETURNING id" to an INSERT to get the new id.
export async function run(sql: string, params: unknown[] = []): Promise<{ id: number }> {
  const row = await one<{ id: number }>(sql, params);
  return { id: Number(row?.id) };
}

// BYTEA comes back as Buffer (Neon) or Uint8Array (PGlite).
export const bytes = (v: unknown) => Buffer.from(v as Uint8Array);

// Append-only log of every read/send of patient data. Keep PHI out of `detail`.
export async function audit(actor: string, action: string, transferId?: number | null, detail?: string) {
  await run("INSERT INTO audit (actor, action, transfer_id, detail) VALUES ($1, $2, $3, $4)", [actor, action, transferId ?? null, detail ?? null]);
}
