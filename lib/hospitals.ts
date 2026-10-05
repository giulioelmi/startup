import { all, run } from "./db";
import type { WorkflowStep } from "./workflow";

// Receiving hospitals ("facilities"). They live in the database so staff can add and edit them;
// the ones below are built in and added on first use. Contact details come from each hospital's
// public transfer-center pages; anything marked `verified: false` must be confirmed by phone.
// Forms live in the forms table (uploaded, emailed, faxed in, or downloaded from `formUrls`).

export const CAPABILITIES = {
  comprehensive_stroke: "Comprehensive stroke center (thrombectomy)",
  trauma_adult: "Level I adult trauma",
  trauma_peds: "Level I pediatric trauma",
  interventional_cardiology: "Interventional cardiology / cath lab 24/7",
  cardiac_surgery: "Cardiac surgery",
  ecmo: "ECMO",
  lvad: "LVAD / mechanical circulatory support",
  heart_transplant: "Heart transplant",
  lung_transplant: "Lung transplant",
  liver_transplant: "Liver transplant",
  kidney_transplant: "Kidney transplant",
  neurosurgery: "Neurosurgery",
  neuro_icu: "Neuro ICU",
  cancer_center: "Comprehensive cancer center",
  picu: "Pediatric ICU",
  nicu: "Level III+ NICU",
  high_risk_ob: "High-risk obstetrics / labor & delivery",
  burn: "Burn center",
} as const;

export type Capability = keyof typeof CAPABILITIES;

export type Hospital = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  transferPhone: string;
  transferFax: string | null;
  transferEmail: string | null;
  emailDomains: string[]; // to match inbound emailed forms
  verified: boolean; // contact details confirmed with the transfer center
  requiredInfo: string[];
  intakeNotes: string;
  capabilities: Capability[];
  workflow: WorkflowStep[];
  formUrls: string[]; // the hospital's public forms; downloaded into the forms inbox
};

const ALL_ADULT: Capability[] = [
  "comprehensive_stroke",
  "interventional_cardiology",
  "cardiac_surgery",
  "ecmo",
  "lvad",
  "heart_transplant",
  "lung_transplant",
  "liver_transplant",
  "kidney_transplant",
  "neurosurgery",
  "neuro_icu",
  "cancer_center",
];

export const HOSPITALS: Hospital[] = [
  {
    id: "ucla",
    name: "Ronald Reagan UCLA Medical Center (UCLA Health)",
    address: "757 Westwood Plaza, Los Angeles, CA 90095",
    lat: 34.0663,
    lng: -118.4458,
    transferPhone: "+13108250909",
    transferFax: null,
    transferEmail: null,
    emailDomains: ["mednet.ucla.edu", "uclahealth.org"],
    verified: false,
    requiredInfo: [
      "Patient name and date of birth",
      "Diagnosis and reason for transfer",
      "Requested service and level of care",
      "Referring physician name and callback number",
      "Insurance",
    ],
    intakeNotes:
      "Call the UCLA Patient Transfer Center first; they arrange a physician-to-physician conversation. Have the information from UCLA's transfer packet ready and fax it when asked.",
    capabilities: [...ALL_ADULT, "trauma_adult", "trauma_peds", "picu", "nicu", "high_risk_ob"],
    workflow: [
      { type: "call", note: "Request the transfer. They arrange a physician-to-physician call and say where to fax records." },
      { type: "receive_forms", note: "UCLA's transfer packet: upload it to the Forms inbox, or ask them to fax/email it." },
      { type: "fill_forms", note: "" },
      { type: "send_fax", note: "Use the fax number they gave on the call." },
      { type: "wait_for_call", note: "Accept/decline comes back by phone." },
    ],
    formUrls: [],
  },
  {
    id: "keck",
    name: "Keck Hospital of USC (Keck Medicine of USC)",
    address: "1500 San Pablo St, Los Angeles, CA 90033",
    lat: 34.0617,
    lng: -118.205,
    transferPhone: "+18558722337", // (855) USC-BEDS
    transferFax: "+13234425240",
    transferEmail: "transfercenter@med.usc.edu",
    emailDomains: ["med.usc.edu", "keckmedicine.org"],
    verified: false,
    requiredInfo: [
      "Patient name",
      "Date of birth",
      "Current status",
      "Requested specialty",
      "Reason for transfer",
      "Level of care",
      "Referring hospital name",
      "Case manager name and contact number",
      "Referring physician name and contact number",
    ],
    intakeNotes:
      "24/7 transfer center, \"One Step Referral\": fax or email the medical records with the listed information; they confirm receipt within 30 minutes. Urgent: call (855) USC-BEDS. Adult hospital only (no pediatrics, no obstetrics, not a trauma center).",
    capabilities: ALL_ADULT,
    workflow: [
      { type: "send_fax", note: "One Step Referral: cover sheet with the required information + medical records. No Keck form needed." },
      { type: "wait_for_call", note: "They confirm receipt within 30 minutes." },
      { type: "call", note: "Only if they haven't called back within 30 minutes, or the transfer is urgent." },
    ],
    formUrls: [],
  },
  {
    id: "cedars",
    name: "Cedars-Sinai Medical Center",
    address: "8700 Beverly Blvd, Los Angeles, CA 90048",
    lat: 34.0753,
    lng: -118.3804,
    transferPhone: "+13104233277",
    transferFax: "+13104233305", // non-EMTALA requests
    transferEmail: null,
    emailDomains: ["cshs.org", "cedars-sinai.org"],
    verified: false,
    requiredInfo: [
      "Face sheet",
      "Front and back of insurance card",
      "Authorization to transfer (if applicable)",
      "Non-EMTALA Request for Transfer form",
    ],
    intakeNotes:
      "24/7 transfer center staffed by ICU nurses. Emergent/EMTALA: call (310) 423-3277 instead. Non-emergent: fax the Non-EMTALA Request for Transfer form with face sheet and insurance card to (310) 423-3305, then call (310) 423-2400; the transfer center calls back.",
    capabilities: [...ALL_ADULT, "trauma_adult", "trauma_peds", "picu", "nicu", "high_risk_ob"],
    workflow: [
      { type: "fill_forms", note: "Non-EMTALA Request for Transfer." },
      { type: "send_fax", note: "Add the face sheet, front and back of the insurance card, and authorization to transfer if applicable." },
      { type: "call", note: "Tell them the request was faxed.", number: "+13104232400" },
      { type: "wait_for_call", note: "The transfer center calls back with next steps." },
    ],
    formUrls: ["https://www.cedars-sinai.org/content/dam/cedars-sinai/programs-and-services/med-pros/Non-EMTALA-Request-for-Transfer-to-Cedars-Sinai-Inpatient.pdf"],
  },
];

// ---------- Database ----------

export async function listHospitals(): Promise<Hospital[]> {
  let rows = await all<{ data: string }>("SELECT data FROM facilities");
  if (!rows.length) {
    for (const h of HOSPITALS) await saveHospital(h); // first run: add the built-in ones
    rows = await all<{ data: string }>("SELECT data FROM facilities");
  }
  return rows.map((r) => JSON.parse(r.data) as Hospital).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getHospital(id: string | null | undefined) {
  return (await listHospitals()).find((h) => h.id === id);
}

export async function saveHospital(h: Hospital) {
  await run("INSERT INTO facilities (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2", [h.id, JSON.stringify(h)]);
}

export async function deleteHospital(id: string) {
  await run("DELETE FROM facilities WHERE id = $1", [id]);
}

export async function matchHospitalByEmail(email: string) {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return (await listHospitals()).find((h) => h.emailDomains.some((d) => domain === d || domain.endsWith(`.${d}`)));
}

export async function matchHospitalByPhone(number: string) {
  const d = digits(number);
  if (!d) return undefined;
  return (await listHospitals()).find((h) => [h.transferPhone, h.transferFax, ...h.workflow.map((s) => s.number)].some((n) => digits(n) === d));
}

const digits = (n: string | null | undefined) => (n ?? "").replace(/\D/g, "").slice(-10);
