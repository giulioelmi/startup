import { expect, test } from "vitest";
import { distanceMiles, rank } from "@/lib/ranking";
import { HOSPITALS } from "@/lib/hospitals";

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
