import type { PatientRecord } from "@/lib/epic";

// Hand-written record in the shape Epic's R4 sandbox returns (no real patient).
export const record: PatientRecord = {
  patient: {
    resourceType: "Patient",
    id: "eTest123",
    identifier: [{ type: { text: "EPI" }, value: "E111" }, { type: { text: "MRN" }, value: "203713" }],
    name: [{ use: "official", text: "Camila Maria Lopez", family: "Lopez", given: ["Camila", "Maria"] }],
    gender: "female",
    birthDate: "1987-09-12",
    telecom: [{ system: "phone", value: "469-555-5555" }],
    address: [{ line: ["3268 West Johnson St.", "Apt 117"], city: "Garland", state: "TX", postalCode: "75043" }],
    communication: [{ language: { coding: [{ display: "English" }] } }],
  },
  resources: {
    problems: [{ resourceType: "Condition", code: { text: "Type 2 diabetes mellitus" }, clinicalStatus: { coding: [{ display: "Active" }] }, onsetDateTime: "2019-01-01" }],
    diagnoses: [],
    vitals: [
      { resourceType: "Observation", code: { text: "Blood Pressure" }, effectiveDateTime: "2024-01-01T10:00:00Z", component: [{ valueQuantity: { value: 120, unit: "mm[Hg]" } }, { valueQuantity: { value: 80, unit: "mm[Hg]" } }] },
      { resourceType: "Observation", code: { text: "Blood Pressure" }, effectiveDateTime: "2024-03-01T10:00:00Z", component: [{ valueQuantity: { value: 150, unit: "mm[Hg]" } }, { valueQuantity: { value: 95, unit: "mm[Hg]" } }] },
      { resourceType: "Observation", code: { text: "Pulse" }, effectiveDateTime: "2024-03-01T10:00:00Z", valueQuantity: { value: 104, unit: "/min" } },
    ],
    labs: [
      { resourceType: "Observation", code: { text: "Potassium" }, effectiveDateTime: "2024-03-01T09:00:00Z", valueQuantity: { value: 3.9, unit: "mmol/L" } },
      { resourceType: "Observation", code: { text: "Troponin I" }, effectiveDateTime: "2024-03-01T09:00:00Z", valueQuantity: { value: 2.4, unit: "ng/mL" }, interpretation: [{ text: "High" }] },
    ],
    medications: [{ resourceType: "MedicationRequest", status: "active", medicationReference: { display: "metFORMIN 500 MG tablet" }, dosageInstruction: [{ text: "500 mg twice daily" }] }],
    allergies: [{ resourceType: "AllergyIntolerance", code: { text: "Penicillin" }, reaction: [{ manifestation: [{ text: "Hives" }], severity: "moderate" }] }],
    encounters: [],
    procedures: [],
    coverage: [{ resourceType: "Coverage", payor: [{ display: "Blue Cross PPO" }], subscriberId: "XYZ123" }],
    notes: [],
  },
  missing: ["procedures"],
};
