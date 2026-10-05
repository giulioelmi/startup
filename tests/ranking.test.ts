import { expect, test, vi } from "vitest";
import { distanceMiles, rank, rankHospitals } from "@/lib/ranking";
import { HOSPITALS } from "@/lib/hospitals";
import type { ClinicalSummary } from "@/lib/summary";

vi.mock("@/lib/llm", () => ({ askForObject: vi.fn().mockRejectedValue(new Error("This model is currently experiencing high demand")) }));

const pomona = { lat: 34.0551, lng: -117.7523 }; // a community hospital east of LA

test("hospitals missing a needed service rank last", () => {
  const r = rank(["trauma_peds"], HOSPITALS, pomona);
  expect(r.at(-1)).toMatchObject({ hospitalId: "keck", eligible: false, missing: ["trauma_peds"] });
});

test("among eligible hospitals, the closest comes first", () => {
  const r = rank(["comprehensive_stroke"], HOSPITALS, pomona);
  expect(r.map((x) => x.hospitalId)).toEqual(["keck", "cedars", "ucla"]);
  expect(r.every((x) => x.eligible)).toBe(true);
});

test("distance is roughly right", () => {
  const keck = HOSPITALS.find((h) => h.id === "keck")!;
  const ucla = HOSPITALS.find((h) => h.id === "ucla")!;
  expect(distanceMiles(keck.lat, keck.lng, ucla.lat, ucla.lng)).toBeGreaterThan(12);
  expect(distanceMiles(keck.lat, keck.lng, ucla.lat, ucla.lng)).toBeLessThan(15);
});

test("when the AI is down, hospitals are still ranked (by distance) instead of failing", async () => {
  const r = await rankHospitals({} as ClinicalSummary, "NSTEMI");
  expect(r.ai).toBe(false);
  expect(r.hospitals).toHaveLength(HOSPITALS.length);
});
