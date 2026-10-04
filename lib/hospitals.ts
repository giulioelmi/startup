// What we know about each receiving hospital. Contact details come from each
// hospital's public transfer-center pages; anything marked `verified: false`
// must be confirmed by phone before a pilot.
// Forms are NOT here: they live in the database (uploaded, emailed or faxed in).

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
    intakeNotes: "Call the UCLA Transfer Center; a physician-to-physician conversation is arranged. Fax number to be confirmed.",
    capabilities: [...ALL_ADULT, "trauma_adult", "trauma_peds", "picu", "nicu", "high_risk_ob"],
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
    intakeNotes: "24/7 transfer center. Fax or email medical records with the listed information. Adult hospital only (no pediatrics, no obstetrics, not a trauma center).",
    capabilities: ALL_ADULT,
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
    intakeNotes: "24/7 transfer center staffed by ICU nurses. Emergent/EMTALA: call. Non-emergent: fax the request form, face sheet and insurance card; the transfer center calls back.",
    capabilities: [...ALL_ADULT, "trauma_adult", "trauma_peds", "picu", "nicu", "high_risk_ob"],
  },
];

export const getHospital = (id: string | null | undefined) => HOSPITALS.find((h) => h.id === id);

export function matchHospitalByEmail(email: string) {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return HOSPITALS.find((h) => h.emailDomains.some((d) => domain === d || domain.endsWith(`.${d}`)));
}

export function matchHospitalByPhone(number: string) {
  const digits = (n: string | null) => (n ?? "").replace(/\D/g, "").slice(-10);
  const d = digits(number);
  return HOSPITALS.find((h) => digits(h.transferPhone) === d || digits(h.transferFax) === d);
}
