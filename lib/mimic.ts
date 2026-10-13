import type { PatientRecord } from "./epic";
import data from "./mimic-demo.json";

// Fake demo patients built from the MIMIC-IV Clinical Database Demo by scripts/import-mimic.mjs.
// Real (de-identified) ICU stays, made-up names and addresses. Their ids start with "mimic-".
/* eslint-disable @typescript-eslint/no-explicit-any */
const DAY = 86_400_000;

// The file stores every stay as ending on 2000-01-01; move all dates so it ended yesterday.
const days = Math.floor((Date.now() - Date.UTC(2000, 0, 1)) / DAY) - 1;
const shift = (d: string) => new Date(Date.parse(d) + days * DAY).toISOString().slice(0, 10);
const records: PatientRecord[] = JSON.parse(JSON.stringify(data).replace(/"(\d{4}-\d{2}-\d{2})/g, (_, d) => `"${shift(d)}`));
const patients = records.map((r) => r.patient as any);

export const isMimic = (id: string) => id.startsWith("mimic-");

export const MIMIC_PATIENTS = records.map((r, i) => ({
  id: patients[i].id as string,
  name: patients[i].name[0].text as string,
  diagnosis: (r.resources.diagnoses[0] as any)?.code.text as string | undefined,
}));

export function getMimicRecord(id: string): PatientRecord {
  const r = records.find((x) => x.patient.id === id);
  if (!r) throw new Error(`No MIMIC demo patient ${id} (run npm run mimic:import, see README)`);
  return structuredClone(r);
}
