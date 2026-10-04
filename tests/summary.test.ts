import { expect, test } from "vitest";
import { summarize } from "@/lib/summary";
import { record } from "./fixture";

test("summarizes an Epic record", () => {
  const s = summarize(record, new Date("2026-10-04"));
  expect(s.patient).toMatchObject({ name: "Camila Maria Lopez", age: 39, sex: "female", mrn: "203713", language: "English" });
  expect(s.patient.address).toBe("3268 West Johnson St. Apt 117, Garland, TX, 75043");
  expect(s.problems[0]).toEqual({ name: "Type 2 diabetes mellitus", status: "Active", onset: "2019-01-01" });
  expect(s.allergies[0]).toEqual({ substance: "Penicillin", reaction: "Hives", severity: "moderate" });
  expect(s.medications[0].name).toBe("metFORMIN 500 MG tablet");
  expect(s.coverage[0]).toEqual({ payer: "Blue Cross PPO", memberId: "XYZ123" });
  expect(s.missing).toEqual(["procedures"]);
});

test("keeps only the newest vital per name and formats blood pressure", () => {
  const s = summarize(record);
  expect(s.vitals).toContainEqual({ name: "Blood Pressure", value: "150/95 mm[Hg]", date: "2024-03-01" });
  expect(s.vitals.filter((v) => v.name === "Blood Pressure")).toHaveLength(1);
  expect(s.labs).toContainEqual({ name: "Troponin I", value: "2.4 ng/mL", flag: "High", date: "2024-03-01" });
});
