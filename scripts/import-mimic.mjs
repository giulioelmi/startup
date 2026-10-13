// Builds lib/mimic-demo.json: fake demo patients from the MIMIC-IV Clinical Database Demo
// (100 de-identified ICU patients, open access, ODbL): https://physionet.org/content/mimic-iv-demo/2.2/
//
//   wget -r -N -c -np https://physionet.org/files/mimic-iv-demo/2.2/
//   npm run mimic:import -- physionet.org/files/mimic-iv-demo/2.2
//
// Each patient becomes a chart in the same FHIR shape lib/epic.ts returns, taken at the
// end of their latest hospital stay (as if they were being transferred out right now).
// MIMIC has no names or addresses, so those are made up; dates are shifted so the stay ends today.
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
const VITALS = { 220045: "Heart Rate", 220210: "Respiratory Rate", 220277: "SpO2", 223761: "Temperature", 226512: "Weight" };
const BP = { sys: "220179", dia: "220180" };

const FEMALE = ["Maria", "Linda", "Patricia", "Susan", "Grace", "Rosa", "Helen", "Aisha", "Mei", "Carmen", "Joan", "Nadia", "Ruth", "Elena", "Diane"];
const MALE = ["James", "Robert", "Miguel", "David", "Wei", "Thomas", "Luis", "Samuel", "Omar", "George", "Raj", "Frank", "Daniel", "Hector", "Paul"];
const FAMILY = ["Garcia", "Nguyen", "Smith", "Johnson", "Martinez", "Kim", "Brown", "Lopez", "Patel", "Davis", "Hernandez", "Chen", "Wilson", "Ramirez", "Clark", "Lewis", "Torres", "Young", "Walker", "Flores", "Hall", "Rivera"];
const STREETS = ["Garey Ave", "Holt Ave", "Mission Blvd", "Towne Ave", "Kingsley St", "Orange Grove Ave", "Pearl St", "Philadelphia St"];

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
export function buildRecords(t, now = new Date()) {
  const icd = new Map(t.d_icd_diagnoses.map((d) => [`${d.icd_version}/${d.icd_code}`, d.long_title]));
  const icdProc = new Map(t.d_icd_procedures.map((d) => [`${d.icd_version}/${d.icd_code}`, d.long_title]));
  const labItems = new Map(t.d_labitems.map((d) => [d.itemid, d]));
  const by = Object.fromEntries(
    ["admissions", "diagnoses_icd", "procedures_icd", "labevents", "prescriptions", "chartevents", "omr"].map((k) => [k, group(t[k], "subject_id")]),
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

    const diagnoses = by.diagnoses_icd(p.subject_id);
    const title = (d) => icd.get(`${d.icd_version}/${d.icd_code}`) ?? `ICD-${d.icd_version} ${d.icd_code}`;
    const current = diagnoses.filter((d) => d.hadm_id === stay.hadm_id).sort((a, b) => a.seq_num - b.seq_num);
    const earlierStays = new Map(stays.filter((a) => time(a.admittime) < from).map((a) => [a.hadm_id, a.admittime]));
    const history = latestBy(diagnoses.filter((d) => earlierStays.has(d.hadm_id)), title, (d) => -time(earlierStays.get(d.hadm_id)));

    const vitalRows = by.chartevents(p.subject_id).filter((c) => during(c.charttime) && c.valuenum !== "");
    const sys = vitalRows.filter((c) => c.itemid === BP.sys);
    const dia = new Map(vitalRows.filter((c) => c.itemid === BP.dia).map((c) => [c.charttime, c]));
    const bp = latestBy(sys.filter((s) => dia.has(s.charttime)), () => "bp", (c) => time(c.charttime));
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
          .map((a) => ({ resourceType: "Encounter", type: [{ text: titleCase(a.admission_type) }], class: { display: "inpatient" }, period: { start: at(a.admittime), end: a === stay ? undefined : at(a.dischtime) } })),
        procedures: by.procedures_icd(p.subject_id)
          .filter((x) => x.hadm_id === stay.hadm_id)
          .map((x) => ({ resourceType: "Procedure", code: { text: icdProc.get(`${x.icd_version}/${x.icd_code}`) ?? `ICD-${x.icd_version} ${x.icd_code}` }, performedDateTime: at(x.chartdate) })),
        coverage: stay.insurance ? [{ resourceType: "Coverage", payor: [{ display: stay.insurance }] }] : [],
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
  const vitalIds = new Set([...Object.keys(VITALS), BP.sys, BP.dia]);
  const t = {};
  for (const name of ["patients", "admissions", "diagnoses_icd", "d_icd_diagnoses", "procedures_icd", "d_icd_procedures", "labevents", "d_labitems", "prescriptions", "omr"])
    t[name] = readTable(join(dir, "hosp"), name);
  t.chartevents = readTable(join(dir, "icu"), "chartevents", (r) => vitalIds.has(r.itemid));
  const records = buildRecords(t);
  const out = join(import.meta.dirname, "../lib/mimic-demo.json");
  writeFileSync(out, `[\n${records.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`);
  console.log(`Wrote ${records.length} patients to ${out}`);
}
