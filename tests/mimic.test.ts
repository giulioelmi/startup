import { expect, test } from "vitest";
import { buildRecords, parseCsv } from "@/scripts/import-mimic.mjs";
import { summarize } from "@/lib/summary";

test("reads MIMIC CSVs with quoted commas, quotes and newlines", () => {
  expect(parseCsv('a,b\n1,"x, ""y""\nz"\r\n2,\n')).toEqual([{ a: "1", b: 'x, "y"\nz' }, { a: "2", b: "" }]);
});

// Rows shaped like the MIMIC-IV demo 2.2 CSVs (made-up values).
const tables = {
  patients: [{ subject_id: "10000032", gender: "F", anchor_age: "52", anchor_year: "2180" }],
  admissions: [
    { subject_id: "10000032", hadm_id: "1", admittime: "2180-05-06 22:23:00", dischtime: "2180-05-07 17:15:00", admission_type: "URGENT", insurance: "Other", language: "ENGLISH", hospital_expire_flag: "0" },
    { subject_id: "10000032", hadm_id: "2", admittime: "2180-07-23 12:35:00", dischtime: "2180-07-25 17:55:00", admission_type: "EW EMER.", insurance: "Medicaid", language: "ENGLISH", hospital_expire_flag: "0" },
  ],
  diagnoses_icd: [
    { subject_id: "10000032", hadm_id: "1", seq_num: "1", icd_code: "5715", icd_version: "9" },
    { subject_id: "10000032", hadm_id: "2", seq_num: "2", icd_code: "07070", icd_version: "9" },
    { subject_id: "10000032", hadm_id: "2", seq_num: "1", icd_code: "5723", icd_version: "9" },
  ],
  d_icd_diagnoses: [
    { icd_code: "5715", icd_version: "9", long_title: "Cirrhosis of liver without mention of alcohol" },
    { icd_code: "5723", icd_version: "9", long_title: "Portal hypertension" },
  ],
  procedures_icd: [{ subject_id: "10000032", hadm_id: "2", chartdate: "2180-07-24", icd_code: "5491", icd_version: "9" }],
  d_icd_procedures: [{ icd_code: "5491", icd_version: "9", long_title: "Percutaneous abdominal drainage" }],
  d_labitems: [{ itemid: "50971", label: "Potassium", fluid: "Blood" }, { itemid: "51491", label: "pH", fluid: "Urine" }],
  labevents: [
    { subject_id: "10000032", itemid: "50971", charttime: "2180-07-23 14:00:00", value: "5.1", valuenum: "5.1", valueuom: "mEq/L", flag: "abnormal" },
    { subject_id: "10000032", itemid: "50971", charttime: "2180-07-25 06:00:00", value: "4.2", valuenum: "4.2", valueuom: "mEq/L", flag: "" },
    { subject_id: "10000032", itemid: "51491", charttime: "2180-07-24 06:00:00", value: "6.0", valuenum: "6", valueuom: "units", flag: "" },
    { subject_id: "10000032", itemid: "50971", charttime: "2180-08-01 06:00:00", value: "3.0", valuenum: "3", valueuom: "mEq/L", flag: "" }, // after the stay
  ],
  prescriptions: [
    { subject_id: "10000032", hadm_id: "2", starttime: "2180-07-23 15:00:00", stoptime: "2180-07-25 17:00:00", drug: "Furosemide", dose_val_rx: "40", dose_unit_rx: "mg", route: "PO" },
    { subject_id: "10000032", hadm_id: "2", starttime: "2180-07-23 15:00:00", stoptime: "2180-07-23 20:00:00", drug: "Albumin 25%", dose_val_rx: "25", dose_unit_rx: "g", route: "IV" },
  ],
  chartevents: [
    { subject_id: "10000032", itemid: "220045", charttime: "2180-07-25 08:00:00", valuenum: "91", valueuom: "bpm" },
    { subject_id: "10000032", itemid: "220179", charttime: "2180-07-25 08:00:00", valuenum: "102", valueuom: "mmHg" },
    { subject_id: "10000032", itemid: "220180", charttime: "2180-07-25 08:00:00", valuenum: "61", valueuom: "mmHg" },
  ],
  omr: [{ subject_id: "10000032", chartdate: "2180-06-01", result_name: "Weight (Lbs)", result_value: "94" }],
};

test("turns a MIMIC stay into a chart the app can use, ending today", () => {
  const today = new Date("2026-10-13T12:00:00Z");
  const [record] = buildRecords(tables, today);
  const s = summarize(record, today);
  expect(s.patient).toMatchObject({ id: "mimic-10000032", sex: "female", age: 52, mrn: "10000032", language: "English" });
  expect(s.diagnoses.map((d) => d.name)).toEqual(["Portal hypertension", "ICD-9 07070"]);
  expect(s.diagnoses[0].date).toBe("2026-10-11");
  expect(s.problems).toEqual([{ name: "Cirrhosis of liver without mention of alcohol", status: null, onset: "2026-07-25" }]);
  expect(s.labs).toContainEqual({ name: "Potassium", value: "4.2 mEq/L", flag: null, date: "2026-10-13" });
  expect(s.labs).toContainEqual({ name: "pH (Urine)", value: "6 units", flag: null, date: "2026-10-12" });
  expect(s.vitals).toContainEqual({ name: "Blood Pressure", value: "102/61 mmHg", date: "2026-10-13" });
  expect(s.vitals).toContainEqual({ name: "Weight (Lbs)", value: "94", date: "2026-08-20" });
  expect(s.medications).toEqual([{ name: "Furosemide", dosage: "40 mg PO", status: "active" }]); // albumin stopped earlier
  expect(s.procedures).toEqual([{ name: "Percutaneous abdominal drainage", date: "2026-10-12" }]);
  expect(s.coverage).toEqual([{ payer: "Medicaid", memberId: null }]);
  expect(s.allergies).toEqual([]);
  expect(s.missing).toContain("allergies (not in MIMIC)");
});

test("demo patients load with their stay ending yesterday", async () => {
  const { MIMIC_PATIENTS, getMimicRecord } = await import("@/lib/mimic");
  expect(MIMIC_PATIENTS).toHaveLength(100);
  const s = summarize(getMimicRecord(MIMIC_PATIENTS[0].id));
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const newest = s.labs.map((l) => l.date!).sort().at(-1)!;
  expect(newest <= yesterday && newest >= "2026-01-01").toBe(true);
});
