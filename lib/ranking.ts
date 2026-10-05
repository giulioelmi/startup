import { z } from "zod";
import { askForObject } from "./llm";
import { CAPABILITIES, HOSPITALS, type Capability, type Hospital } from "./hospitals";
import type { ClinicalSummary } from "./summary";

export type RankedHospital = {
  hospitalId: string;
  eligible: boolean;
  missing: Capability[];
  distanceMiles: number | null;
  rationale: string;
};
// `ai: false` means the AI was unavailable: hospitals are ordered by distance only.
export type Ranking = { ai?: boolean; needs: Capability[]; needsExplanation: string; hospitals: RankedHospital[] };

export function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
}

// Deterministic part: hospitals that offer every needed capability come first, then closest first.
export function rank(needs: Capability[], hospitals: Hospital[], from: { lat: number; lng: number } | null) {
  return hospitals
    .map((h) => {
      const missing = needs.filter((n) => !h.capabilities.includes(n));
      return {
        hospitalId: h.id,
        eligible: missing.length === 0,
        missing,
        distanceMiles: from ? Math.round(distanceMiles(from.lat, from.lng, h.lat, h.lng) * 10) / 10 : null,
      };
    })
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.missing.length - b.missing.length || (a.distanceMiles ?? 0) - (b.distanceMiles ?? 0));
}

function sendingLocation() {
  const lat = Number(process.env.SENDING_HOSPITAL_LAT);
  const lng = Number(process.env.SENDING_HOSPITAL_LNG);
  return lat && lng ? { lat, lng } : null;
}

const capabilityIds = Object.keys(CAPABILITIES) as [Capability, ...Capability[]];

// Always returns a ranking: if the AI is down, hospitals are ordered by distance and the page offers a re-run.
export async function rankHospitals(summary: ClinicalSummary, reason: string): Promise<Ranking> {
  try {
    return { ai: true, ...(await rankWithAI(summary, reason)) };
  } catch (e) {
    console.error("AI ranking failed:", (e as Error).message);
    const hospitals = rank([], HOSPITALS, sendingLocation()).map((r) => ({ ...r, rationale: "" }));
    return { ai: false, needs: [], needsExplanation: "The AI is unavailable right now, so hospitals are ordered by distance only. Check the services the patient needs, or re-run the AI.", hospitals };
  }
}

// AI part: decide which capabilities the patient needs, and explain each option.
// It only sees the chart summary and our hospital profiles; it is told not to use outside facts.
async function rankWithAI(summary: ClinicalSummary, reason: string): Promise<Ranking> {
  const { needs, needsExplanation } = await askForObject(
    z.object({
      needs: z.array(z.enum(capabilityIds)),
      needsExplanation: z.string().describe("One or two sentences."),
    }),
    "You are a transfer-center nurse. Choose the specialized capabilities the receiving hospital MUST have for this patient. Pick only what the reason for transfer and chart clearly require; an empty list is fine.",
    `Capabilities:\n${JSON.stringify(CAPABILITIES, null, 1)}\n\nReason for transfer: ${reason}\n\nChart summary:\n${JSON.stringify(summary)}`,
  );

  const ranked = rank(needs, HOSPITALS, sendingLocation());

  const { rationales } = await askForObject(
    z.object({ rationales: z.array(z.object({ hospitalId: z.string(), rationale: z.string() })) }),
    "Explain each hospital option to a referring physician in 1-2 sentences. Use ONLY the facts given (capabilities, missing capabilities, distance, intake notes). Never claim bed availability or anything not given.",
    `Patient needs: ${needs.join(", ") || "none specific"} (${needsExplanation})\n\nOptions in ranked order:\n${JSON.stringify(
      ranked.map((r) => ({ ...r, ...pick(HOSPITALS.find((h) => h.id === r.hospitalId)!) })),
    )}`,
  );

  return {
    needs,
    needsExplanation,
    hospitals: ranked.map((r) => ({ ...r, rationale: rationales.find((x) => x.hospitalId === r.hospitalId)?.rationale ?? "" })),
  };
}

const pick = (h: Hospital) => ({ name: h.name, intakeNotes: h.intakeNotes });
