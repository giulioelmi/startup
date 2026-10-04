import { SignJWT, importPKCS8 } from "jose";
import { randomUUID } from "node:crypto";

// Epic "Backend Services" (SMART system-to-system) client for the FHIR R4 sandbox.
// Same calls work for Oracle Health (Cerner) and other FHIR R4 EHRs: change the URLs.
const FHIR_BASE = process.env.EPIC_FHIR_BASE || "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4";
const TOKEN_URL = process.env.EPIC_TOKEN_URL || "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token";

export type FhirResource = { resourceType: string; id?: string; [key: string]: unknown };

let cached: { token: string; expires: number } | null = null;

async function getToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 30_000) return cached.token;

  const clientId = process.env.EPIC_CLIENT_ID;
  const pem = process.env.EPIC_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!clientId || !pem) throw new Error("Epic is not configured: set EPIC_CLIENT_ID and EPIC_PRIVATE_KEY (see README).");

  const key = await importPKCS8(pem, "RS384");
  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: "RS384", typ: "JWT", kid: process.env.EPIC_KEY_ID || "transfer-ai-1" })
    .setIssuer(clientId)
    .setSubject(clientId)
    .setAudience(TOKEN_URL)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime("4m") // Epic allows at most 5 minutes
    .sign(key);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion,
    }),
  });
  if (!res.ok) throw new Error(`Epic token request failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  cached = { token: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return cached.token;
}

async function fhirGet(pathAndQuery: string): Promise<FhirResource> {
  const res = await fetch(`${FHIR_BASE}/${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${await getToken()}`, Accept: "application/fhir+json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Epic ${pathAndQuery.split("?")[0]} failed (${res.status})`);
  return res.json();
}

// Returns the resources in a search Bundle, following "next" links. Epic adds
// OperationOutcome entries for warnings; those are dropped.
async function search(pathAndQuery: string): Promise<FhirResource[]> {
  const out: FhirResource[] = [];
  let bundle = await fhirGet(pathAndQuery);
  for (let page = 0; page < 10; page++) {
    const entries = (bundle.entry as { resource: FhirResource }[] | undefined) ?? [];
    out.push(...entries.map((e) => e.resource).filter((r) => r.resourceType !== "OperationOutcome"));
    const next = (bundle.link as { relation: string; url: string }[] | undefined)?.find((l) => l.relation === "next");
    if (!next) break;
    bundle = await fhirGet(next.url.replace(`${FHIR_BASE}/`, ""));
  }
  return out;
}

export async function searchPatients(params: { family?: string; given?: string; birthdate?: string }) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
  return search(`Patient?${q}`);
}

// Everything we need for a transfer, in one object. A resource type the app
// isn't authorized for (or that errors) comes back empty and is listed in `missing`.
export type PatientRecord = { patient: FhirResource; resources: Record<string, FhirResource[]>; missing: string[] };

const QUERIES: Record<string, string> = {
  problems: "Condition?category=problem-list-item",
  diagnoses: "Condition?category=encounter-diagnosis",
  vitals: "Observation?category=vital-signs",
  labs: "Observation?category=laboratory",
  medications: "MedicationRequest?",
  allergies: "AllergyIntolerance?",
  encounters: "Encounter?",
  procedures: "Procedure?",
  coverage: "Coverage?",
  notes: "DocumentReference?category=clinical-note",
};

export async function getPatientRecord(patientId: string): Promise<PatientRecord> {
  const patient = await fhirGet(`Patient/${encodeURIComponent(patientId)}`);
  const resources: Record<string, FhirResource[]> = {};
  const missing: string[] = [];
  await Promise.all(
    Object.entries(QUERIES).map(async ([key, q]) => {
      const sep = q.endsWith("?") ? "" : "&";
      try {
        resources[key] = await search(`${q}${sep}patient=${encodeURIComponent(patientId)}`);
      } catch {
        resources[key] = [];
        missing.push(key);
      }
    }),
  );
  return { patient, resources, missing };
}
