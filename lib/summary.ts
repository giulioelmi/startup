import type { FhirResource, PatientRecord } from "./epic";

// Compact, deterministic view of the chart. This is the ONLY patient data the AI
// sees, for ranking, forms and calls, so anything it says can be traced back here.
export type ClinicalSummary = {
  patient: {
    id: string;
    name: string;
    birthDate: string | null;
    age: number | null;
    sex: string | null;
    mrn: string | null;
    phone: string | null;
    address: string | null;
    language: string | null;
  };
  problems: { name: string; status: string | null; onset: string | null }[];
  diagnoses: { name: string; date: string | null }[];
  allergies: { substance: string; reaction: string | null; severity: string | null }[];
  medications: { name: string; dosage: string | null; status: string | null }[];
  vitals: { name: string; value: string; date: string | null }[];
  labs: { name: string; value: string; flag: string | null; date: string | null }[];
  encounters: { type: string; class: string | null; start: string | null; location: string | null }[];
  procedures: { name: string; date: string | null }[];
  coverage: { payer: string; memberId: string | null }[];
  notes: { title: string; date: string | null }[];
  missing: string[]; // data types Epic did not return
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const text = (cc: any): string | null => cc?.text || cc?.coding?.find((c: any) => c.display)?.display || null;
const date = (s: any): string | null => (typeof s === "string" ? s.slice(0, 10) : null);

function quantity(o: any): string | null {
  if (o.valueQuantity) return `${o.valueQuantity.value} ${o.valueQuantity.unit ?? ""}`.trim();
  if (o.valueString) return o.valueString;
  if (o.valueCodeableConcept) return text(o.valueCodeableConcept);
  if (o.component?.length) {
    // e.g. blood pressure: "120/80 mm[Hg]"
    const parts = o.component.map((c: any) => c.valueQuantity?.value).filter((v: any) => v != null);
    const unit = o.component[0]?.valueQuantity?.unit ?? "";
    return parts.length ? `${parts.join("/")} ${unit}`.trim() : null;
  }
  return null;
}

// Newest observation per name.
function latest(observations: any[]) {
  const sorted = [...observations].sort((a, b) =>
    String(b.effectiveDateTime ?? b.issued ?? "").localeCompare(String(a.effectiveDateTime ?? a.issued ?? "")),
  );
  const seen = new Map<string, any>();
  for (const o of sorted) {
    const name = text(o.code);
    if (name && !seen.has(name) && quantity(o) != null) seen.set(name, o);
  }
  return [...seen.entries()];
}

function ageOn(birthDate: string | null, today = new Date()): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  let age = today.getFullYear() - b.getFullYear();
  if (today < new Date(today.getFullYear(), b.getMonth(), b.getDate())) age--;
  return age;
}

export function summarize(record: PatientRecord, today = new Date()): ClinicalSummary {
  const p: any = record.patient;
  const r = (k: string): any[] => (record.resources[k] ?? []) as FhirResource[];
  const name = p.name?.find((n: any) => n.use === "official") ?? p.name?.[0];
  const addr = p.address?.[0];
  const mrn = p.identifier?.find((i: any) => /MRN/i.test(i.type?.text ?? "") || i.type?.coding?.some((c: any) => c.code === "MR"));

  return {
    patient: {
      id: p.id,
      name: name?.text || [name?.given?.join(" "), name?.family].filter(Boolean).join(" ") || "Unknown",
      birthDate: p.birthDate ?? null,
      age: ageOn(p.birthDate ?? null, today),
      sex: p.gender ?? null,
      mrn: mrn?.value ?? null,
      phone: p.telecom?.find((t: any) => t.system === "phone")?.value ?? null,
      address: addr ? [addr.line?.join(" "), addr.city, addr.state, addr.postalCode].filter(Boolean).join(", ") : null,
      language: text(p.communication?.[0]?.language),
    },
    problems: r("problems").map((c) => ({
      name: text(c.code) ?? "Unnamed problem",
      status: text(c.clinicalStatus),
      onset: date(c.onsetDateTime),
    })),
    diagnoses: r("diagnoses").map((c) => ({ name: text(c.code) ?? "Unnamed diagnosis", date: date(c.recordedDate) })),
    allergies: r("allergies").map((a) => ({
      substance: text(a.code) ?? "Unknown substance",
      reaction: text(a.reaction?.[0]?.manifestation?.[0]),
      severity: a.reaction?.[0]?.severity ?? a.criticality ?? null,
    })),
    medications: r("medications").map((m) => ({
      name: text(m.medicationCodeableConcept) ?? m.medicationReference?.display ?? "Unknown medication",
      dosage: m.dosageInstruction?.[0]?.text ?? null,
      status: m.status ?? null,
    })),
    vitals: latest(r("vitals")).map(([n, o]) => ({ name: n, value: quantity(o)!, date: date(o.effectiveDateTime) })),
    labs: latest(r("labs"))
      .slice(0, 40)
      .map(([n, o]) => ({ name: n, value: quantity(o)!, flag: text(o.interpretation?.[0]), date: date(o.effectiveDateTime) })),
    encounters: r("encounters")
      .sort((a, b) => String(b.period?.start ?? "").localeCompare(String(a.period?.start ?? "")))
      .slice(0, 5)
      .map((e) => ({
        type: text(e.type?.[0]) ?? "Encounter",
        class: e.class?.display ?? e.class?.code ?? null,
        start: date(e.period?.start),
        location: e.location?.[0]?.location?.display ?? null,
      })),
    procedures: r("procedures").map((x) => ({ name: text(x.code) ?? "Unnamed procedure", date: date(x.performedDateTime ?? x.performedPeriod?.start) })),
    coverage: r("coverage").map((c) => ({
      payer: c.payor?.[0]?.display ?? text(c.type) ?? "Unknown payer",
      memberId: c.subscriberId ?? null,
    })),
    notes: r("notes").map((d) => ({ title: d.description ?? text(d.type) ?? "Clinical note", date: date(d.date) })),
    missing: record.missing,
  };
}
