import type { FhirResource, PatientRecord } from "./epic";
import data from "./mimic-demo.json";

// Fake demo patients built from the MIMIC-IV Clinical Database Demo by scripts/import-mimic.mjs.
// Real (de-identified) ICU stays, made-up names and addresses. Their ids start with "mimic-".
/* eslint-disable @typescript-eslint/no-explicit-any */
const records = data as unknown as PatientRecord[];
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

export function searchMimic(q: { family?: string; given?: string; birthdate?: string }): FhirResource[] {
  const starts = (v: string, s?: string) => !s || v.toLowerCase().startsWith(s.toLowerCase());
  return patients.filter((p) => starts(p.name[0].family, q.family) && starts(p.name[0].given[0], q.given) && (!q.birthdate || p.birthDate === q.birthdate));
}
