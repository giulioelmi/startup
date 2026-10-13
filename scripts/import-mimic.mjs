// Builds lib/mimic-demo.json: fake demo patients from the MIMIC-IV Clinical Database Demo
// (100 de-identified ICU patients, open access, ODbL): https://physionet.org/content/mimic-iv-demo/2.2/
//
//   wget -r -N -c -np https://physionet.org/files/mimic-iv-demo/2.2/
//   npm run mimic:import -- physionet.org/files/mimic-iv-demo/2.2
//
// Each patient becomes a chart in the same FHIR shape lib/epic.ts returns, taken at the
// end of their latest hospital stay (as if they were being transferred out right now).
// MIMIC has no names, addresses, contacts, member IDs or PCPs, so those are made up. Dates are stored
// as if every stay ended on 2000-01-01; lib/mimic.ts moves them so it ended yesterday.
// MIMIC has no allergies or notes: they are listed as missing, never as "none".
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function parseCsv(text, keep = () => true) {
  const out = [];
  let head = null, row = [], field = "", quoted = false;
  const endRow = () => {
    row.push(field);
    if (!head) head = row;
    else if (row.length > 1 || row[0]) {
      const r = Object.fromEntries(head.map((h, i) => [h, row[i] ?? ""]));
      if (keep(r)) out.push(r);
    }
    row = [];
    field = "";
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') field += text[++i];
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    }
    else if (c === "\n") endRow();
    else if (c !== "\r") field += c;
  }
  if (field || row.length) endRow();
  return out;
}

function readTable(dir, name, keep) {
  const file = join(dir, `${name}.csv.gz`);
  if (!existsSync(file)) throw new Error(`Missing ${file}: is this the mimic-iv-demo/2.2 folder?`);
  return parseCsv(gunzipSync(readFileSync(file)).toString("utf8"), keep);
}

// ICU charted vitals (icu/chartevents item ids).
const VITALS = {
  220045: "Heart Rate", 220210: "Respiratory Rate", 220277: "SpO2", 223761: "Temperature", 226512: "Weight",
  226730: "Height", 223835: "FiO2", 223834: "O2 Flow",
};
const BP = { sys: "220179", dia: "220180" };
const GCS = ["220739", "223900", "223901"]; // eye, verbal, motor
// ICU nursing assessments charted as text (icu/chartevents item ids).
const ASSESSMENTS = {
  223758: "Code Status", 223759: "Isolation Precautions", 226732: "O2 Delivery Device", 223849: "Ventilator Mode",
  226104: "Level of Consciousness", 223898: "Orientation", 224001: "Diet", 224084: "Activity",
};
// Lines, airway, dialysis and catheters (icu/procedureevents, by d_items category).
const DEVICE_CATEGORIES = ["Access Lines - Peripheral", "Access Lines - Invasive", "2-Ventilation", "Dialysis", "GI/GU"];

const FEMALE = ["Maria", "Linda", "Patricia", "Susan", "Grace", "Rosa", "Helen", "Aisha", "Mei", "Carmen", "Joan", "Nadia", "Ruth", "Elena", "Diane"];
const MALE = ["James", "Robert", "Miguel", "David", "Wei", "Thomas", "Luis", "Samuel", "Omar", "George", "Raj", "Frank", "Daniel", "Hector", "Paul"];
const FAMILY = ["Garcia", "Nguyen", "Smith", "Johnson", "Martinez", "Kim", "Brown", "Lopez", "Patel", "Davis", "Hernandez", "Chen", "Wilson", "Ramirez", "Clark", "Lewis", "Torres", "Young", "Walker", "Flores", "Hall", "Rivera"];
const RELATIVES = { F: ["Daughter", "Sister"], M: ["Son", "Brother"] };
const DOCTORS = ["Anita Shah", "Mark Feldman", "Rosa Delgado", "Kevin Tran", "Laura Bennett", "Samuel Okafor"];
const STREETS = ["Garey Ave", "Holt Ave", "Mission Blvd", "Towne Ave", "Kingsley St", "Orange Grove Ave", "Pearl St", "Philadelphia St"];

const US_CORE_RACE = "http://hl7.org/fhir/us/core/StructureDefinition/us-core-race";
const time = (s) => Date.parse(s.length === 10 ? `${s}T00:00:00Z` : `${s.replace(" ", "T")}Z`);
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// Newest row per key.
function latestBy(rows, key, at) {
  const m = new Map();
  for (const r of rows) if (!m.has(key(r)) || at(r) > at(m.get(key(r)))) m.set(key(r), r);
  return [...m.values()];
}

const group = (rows, key) => {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r[key])) m.set(r[key], []);
    m.get(r[key]).push(r);
  }
  return (k) => m.get(k) ?? [];
};

// t: MIMIC tables as arrays of row objects (column names as in the CSVs).
export function buildRecords(t, now = new Date("2000-01-01T12:00:00Z")) {
  const icd = new Map(t.d_icd_diagnoses.map((d) => [`${d.icd_version}/${d.icd_code}`, d.long_title]));
  const icdProc = new Map(t.d_icd_procedures.map((d) => [`${d.icd_version}/${d.icd_code}`, d.long_title]));
  const labItems = new Map(t.d_labitems.map((d) => [d.itemid, d]));
  const icuItems = new Map(t.d_items.map((d) => [d.itemid, d]));
  const by = Object.fromEntries(
    ["admissions", "diagnoses_icd", "procedures_icd", "labevents", "prescriptions", "chartevents", "omr", "procedureevents", "microbiologyevents", "transfers"].map((k) => [k, group(t[k], "subject_id")]),
  );

  const records = [];
  for (const p of t.patients) {
    const n = Number(p.subject_id);
    const stays = by.admissions(p.subject_id).sort((a, b) => time(a.admittime) - time(b.admittime));
    const stay = stays.findLast((a) => a.hospital_expire_flag !== "1") ?? stays.at(-1);
    if (!stay) continue;
    const from = time(stay.admittime), to = time(stay.dischtime);
    const during = (s) => s && time(s) >= from && time(s) <= to;
    const shift = Math.round((now.getTime() - to) / 86_400_000) * 86_400_000; // whole days: keeps the time of day
    const at = (s) => (s ? new Date(time(s) + shift).toISOString() : undefined);

    const female = p.gender === "F";
    const age = Number(p.anchor_age) + new Date(from).getUTCFullYear() - Number(p.anchor_year);
    const admitYear = new Date(from + shift).getUTCFullYear();
    const birthDate = `${admitYear - age}-${String((n % 12) + 1).padStart(2, "0")}-${String((n % 28) + 1).padStart(2, "0")}`;
    const given = (female ? FEMALE : MALE)[n % 15];
    const family = FAMILY[Math.floor(n / 7) % FAMILY.length];
    const language = stay.language && stay.language !== "?" ? titleCase(stay.language) : null;
    const married = stay.marital_status === "MARRIED";
    const contactSex = married ? (female ? "M" : "F") : n % 2 ? "F" : "M";
    const contactName = `${(contactSex === "F" ? FEMALE : MALE)[(n + 5) % 15]} ${family}`;
    const relationship = married ? "Spouse" : RELATIVES[contactSex][n % 2];

    const diagnoses = by.diagnoses_icd(p.subject_id);
    const title = (d) => icd.get(`${d.icd_version}/${d.icd_code}`) ?? `ICD-${d.icd_version} ${d.icd_code}`;
    const current = diagnoses.filter((d) => d.hadm_id === stay.hadm_id).sort((a, b) => a.seq_num - b.seq_num);
    const earlierStays = new Map(stays.filter((a) => time(a.admittime) < from).map((a) => [a.hadm_id, a.admittime]));
    // Problem list: diagnoses from earlier stays, newest 30.
    const history = latestBy(diagnoses.filter((d) => earlierStays.has(d.hadm_id)), title, (d) => -time(earlierStays.get(d.hadm_id)))
      .sort((a, b) => time(earlierStays.get(b.hadm_id)) - time(earlierStays.get(a.hadm_id)))
      .slice(0, 30);

    const vitalRows = by.chartevents(p.subject_id).filter((c) => during(c.charttime) && c.valuenum !== "");
    const sys = vitalRows.filter((c) => c.itemid === BP.sys);
    const dia = new Map(vitalRows.filter((c) => c.itemid === BP.dia).map((c) => [c.charttime, c]));
    const bp = latestBy(sys.filter((s) => dia.has(s.charttime)), () => "bp", (c) => time(c.charttime));
    // Glasgow Coma Scale: eye + verbal + motor charted at the same time.
    const gcsParts = GCS.map((id) => new Map(vitalRows.filter((c) => c.itemid === id).map((c) => [c.charttime, c])));
    const gcs = latestBy([...gcsParts[0].values()].filter((c) => gcsParts.every((m) => m.has(c.charttime))), () => "gcs", (c) => time(c.charttime));
    const assessments = latestBy(
      by.chartevents(p.subject_id).filter((c) => ASSESSMENTS[c.itemid] && during(c.charttime) && c.value.trim()),
      (c) => c.itemid,
      (c) => time(c.charttime),
    ).map((c) => ({ resourceType: "Observation", code: { text: ASSESSMENTS[c.itemid] }, effectiveDateTime: at(c.charttime), valueString: c.value.trim() }));
    const vitals = [
      ...latestBy(vitalRows.filter((c) => VITALS[c.itemid]), (c) => c.itemid, (c) => time(c.charttime)).map((c) => ({
        resourceType: "Observation",
        code: { text: VITALS[c.itemid] },
        effectiveDateTime: at(c.charttime),
        valueQuantity: { value: Number(c.valuenum), unit: c.valueuom },
      })),
      ...bp.map((s) => ({
        resourceType: "Observation",
        code: { text: "Blood Pressure" },
        effectiveDateTime: at(s.charttime),
        component: [s, dia.get(s.charttime)].map((c) => ({ valueQuantity: { value: Number(c.valuenum), unit: c.valueuom } })),
      })),
      ...gcs.map((c) => ({
        resourceType: "Observation",
        code: { text: "GCS Total" },
        effectiveDateTime: at(c.charttime),
        valueQuantity: { value: gcsParts.reduce((sum, m) => sum + Number(m.get(c.charttime).valuenum), 0), unit: "points" },
      })),
      // Outpatient measurements (BP, weight, BMI) for patients without ICU vitals.
      ...latestBy(by.omr(p.subject_id).filter((o) => time(o.chartdate) <= to), (o) => o.result_name, (o) => time(o.chartdate)).map((o) => ({
        resourceType: "Observation",
        code: { text: o.result_name },
        effectiveDateTime: at(o.chartdate),
        valueString: o.result_value,
      })),
    ];

    const labs = latestBy(by.labevents(p.subject_id).filter((l) => during(l.charttime) && labItems.has(l.itemid) && (l.valuenum || l.value)), (l) => l.itemid, (l) => time(l.charttime)).map((l) => {
      const item = labItems.get(l.itemid);
      return {
        resourceType: "Observation",
        code: { text: item.fluid && item.fluid !== "Blood" ? `${item.label} (${item.fluid})` : item.label },
        effectiveDateTime: at(l.charttime),
        ...(l.valuenum !== "" ? { valueQuantity: { value: Number(l.valuenum), unit: l.valueuom } } : { valueString: l.value }),
        ...(l.flag ? { interpretation: [{ text: titleCase(l.flag) }] } : {}),
      };
    });

    // Organisms grown in cultures taken during the stay, one result per specimen type.
    const cultures = new Map();
    for (const m of by.microbiologyevents(p.subject_id).filter((m) => m.hadm_id === stay.hadm_id && m.org_name)) {
      const c = cultures.get(m.spec_type_desc) ?? { orgs: new Set(), date: m.chartdate };
      c.orgs.add(m.org_name);
      if (time(m.chartdate) > time(c.date)) c.date = m.chartdate;
      cultures.set(m.spec_type_desc, c);
    }
    labs.push(...[...cultures].map(([spec, c]) => ({
      resourceType: "Observation",
      code: { text: `${titleCase(spec)} culture` },
      effectiveDateTime: at(c.date),
      valueString: [...c.orgs].join("; "),
      interpretation: [{ text: "Positive" }],
    })));

    const devices = by.procedureevents(p.subject_id)
      .filter((x) => x.hadm_id === stay.hadm_id && DEVICE_CATEGORIES.includes(icuItems.get(x.itemid)?.category))
      .map((x) => {
        const inPlace = time(x.endtime) >= to - 86_400_000;
        const name = [icuItems.get(x.itemid).label, x.location].filter(Boolean).join(", ");
        return { resourceType: "Procedure", code: { text: `${name} (${inPlace ? "in place" : "removed"})` }, performedPeriod: { start: at(x.starttime), end: at(x.endtime) } };
      });
    const unit = by.transfers(p.subject_id)
      .filter((x) => x.hadm_id === stay.hadm_id && x.careunit && x.careunit !== "Discharge Lounge")
      .sort((a, b) => time(a.intime) - time(b.intime))
      .at(-1)?.careunit;

    // Medications still running at the end of the stay.
    const meds = latestBy(
      by.prescriptions(p.subject_id).filter((m) => m.hadm_id === stay.hadm_id && (!m.stoptime || time(m.stoptime) >= to - 86_400_000)),
      (m) => m.drug,
      (m) => time(m.starttime || stay.admittime),
    ).map((m) => ({
      resourceType: "MedicationRequest",
      status: "active",
      medicationCodeableConcept: { text: m.drug },
      dosageInstruction: [{ text: [m.dose_val_rx, m.dose_unit_rx, m.route].filter(Boolean).join(" ") }],
      authoredOn: at(m.starttime),
    }));

    records.push({
      patient: {
        resourceType: "Patient",
        id: `mimic-${p.subject_id}`,
        identifier: [{ type: { text: "MRN" }, value: p.subject_id }],
        name: [{ use: "official", text: `${given} ${family}`, family, given: [given] }],
        gender: female ? "female" : "male",
        birthDate,
        telecom: [{ system: "phone", value: `909-555-${String(n % 10000).padStart(4, "0")}` }],
        address: [{ line: [`${100 + (n % 900)} ${STREETS[n % STREETS.length]}`], city: "Pomona", state: "CA", postalCode: "91766" }],
        ...(language ? { communication: [{ language: { text: language } }] } : {}),
        ...(stay.marital_status ? { maritalStatus: { text: titleCase(stay.marital_status) } } : {}),
        ...(stay.race && !/UNKNOWN|DECLINED|UNABLE/.test(stay.race) ? { extension: [{ url: US_CORE_RACE, extension: [{ url: "text", valueString: titleCase(stay.race) }] }] } : {}),
        contact: [{
          relationship: [{ text: relationship }],
          name: { text: contactName },
          telecom: [{ system: "phone", value: `909-555-${String((n * 7) % 10000).padStart(4, "0")}` }],
        }],
        generalPractitioner: [{ display: `Dr. ${DOCTORS[n % DOCTORS.length]}, Pomona Family Medicine, 909-555-0100` }],
      },
      resources: {
        problems: history.map((d) => ({ resourceType: "Condition", code: { text: title(d) }, onsetDateTime: at(earlierStays.get(d.hadm_id)) })),
        diagnoses: current.map((d) => ({ resourceType: "Condition", code: { text: title(d) }, recordedDate: at(stay.admittime) })),
        vitals,
        labs,
        medications: meds,
        allergies: [],
        encounters: stays
          .filter((a) => time(a.admittime) <= from)
          .map((a) => ({
            resourceType: "Encounter",
            type: [{ text: titleCase(a.admission_type) }],
            class: { display: "inpatient" },
            period: { start: at(a.admittime), end: a === stay ? undefined : at(a.dischtime) },
            ...(a.admission_location ? { hospitalization: { admitSource: { text: titleCase(a.admission_location) } } } : {}),
            ...(a === stay && unit ? { location: [{ location: { display: unit } }] } : {}),
          })),
        procedures: by.procedures_icd(p.subject_id)
          .filter((x) => x.hadm_id === stay.hadm_id)
          .map((x) => ({ resourceType: "Procedure", code: { text: icdProc.get(`${x.icd_version}/${x.icd_code}`) ?? `ICD-${x.icd_version} ${x.icd_code}` }, performedDateTime: at(x.chartdate) }))
          .concat(devices),
        assessments,
        coverage: stay.insurance
          ? [{ resourceType: "Coverage", payor: [{ display: stay.insurance }], subscriberId: `${stay.insurance.slice(0, 3).toUpperCase()}${String(n * 37).slice(-8)}`, relationship: { text: "Self" } }]
          : [],
        notes: [],
      },
      missing: ["allergies (not in MIMIC)", "notes (not in MIMIC)"],
    });
  }
  return records;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) throw new Error("Usage: npm run mimic:import -- <path to mimic-iv-demo/2.2>");
  const vitalIds = new Set([...Object.keys(VITALS), BP.sys, BP.dia, ...GCS, ...Object.keys(ASSESSMENTS)]);
  const t = {};
  for (const name of ["patients", "admissions", "diagnoses_icd", "d_icd_diagnoses", "procedures_icd", "d_icd_procedures", "labevents", "d_labitems", "prescriptions", "omr", "microbiologyevents", "transfers"])
    t[name] = readTable(join(dir, "hosp"), name);
  t.chartevents = readTable(join(dir, "icu"), "chartevents", (r) => vitalIds.has(r.itemid));
  t.d_items = readTable(join(dir, "icu"), "d_items");
  t.procedureevents = readTable(join(dir, "icu"), "procedureevents");
  const records = buildRecords(t);
  const out = join(import.meta.dirname, "../lib/mimic-demo.json");
  writeFileSync(out, `[\n${records.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`);
  console.log(`Wrote ${records.length} patients to ${out}`);
}
