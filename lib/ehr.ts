import { getPatientRecord as getEpicRecord } from "./epic";
import { getMimicRecord, isMimic } from "./mimic";

// Where a patient's chart comes from: MIMIC demo patients are local, everyone else is read from Epic.
export const ehrName = (patientId: string) => (isMimic(patientId) ? "MIMIC demo" : "Epic");

export async function getPatientRecord(patientId: string) {
  return isMimic(patientId) ? getMimicRecord(patientId) : getEpicRecord(patientId);
}
