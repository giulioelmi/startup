import { PDFDocument, StandardFonts } from "pdf-lib";
import { run } from "./db";
import type { Hospital } from "./hospitals";
import type { Transfer } from "./transfers";

// ---------- Packet: cover sheet + filled forms + medical record summary ----------

export async function buildPacket(transfer: Transfer, hospital: Hospital, filledForms: Uint8Array[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const d = transfer.details;
  const s = transfer.summary;

  const record = recordLines(transfer);
  const formPages = (await Promise.all(filledForms.map((b) => PDFDocument.load(b)))).reduce((n, f) => n + f.getPageCount(), 0);
  const recordPages = Math.ceil(record.length / 60);

  writePages(doc, font, bold, [
    "# FAX - PATIENT TRANSFER REQUEST",
    "",
    `To: ${hospital.name} - Transfer Center`,
    `Fax: ${hospital.transferFax ?? ""}`,
    `From: ${d.sendingHospital}`,
    `Referring physician: ${d.referringPhysician}   Callback: ${d.callbackPhone}`,
    `Return fax: ${d.sendingFax}`,
    `Date: ${new Date().toLocaleString("en-US")}`,
    `Pages (including cover): ${1 + formPages + recordPages}`,
    `Transfer reference #: ${transfer.id}  (say or key this number when calling us back)`,
    "",
    `Patient: ${s.patient.name}   DOB: ${s.patient.birthDate ?? ""}   MRN: ${s.patient.mrn ?? ""}`,
    `Reason for transfer: ${transfer.reason}`,
    `Requested level of care: ${d.levelOfCare}${d.emergent ? "  (EMERGENT)" : ""}`,
    "",
    "CONFIDENTIAL: This fax contains protected health information. If you received it in error,",
    "notify the sender at the number above and destroy all copies.",
  ]);

  for (const bytes of filledForms) {
    const src = await PDFDocument.load(bytes);
    (await doc.copyPages(src, src.getPageIndices())).forEach((p) => doc.addPage(p));
  }
  writePages(doc, font, bold, record);
  return doc.save();
}

function recordLines(t: Transfer): string[] {
  const s = t.summary;
  const section = (title: string, rows: string[]) => ["", `# ${title}`, ...(rows.length ? rows : ["None on record"])];
  return [
    "# MEDICAL RECORD SUMMARY",
    `${s.patient.name}  |  DOB ${s.patient.birthDate ?? "?"}  |  ${s.patient.sex ?? ""}  |  MRN ${s.patient.mrn ?? "?"}`,
    `Address: ${s.patient.address ?? ""}   Phone: ${s.patient.phone ?? ""}   Language: ${s.patient.language ?? ""}`,
    `Reason for transfer: ${t.reason}`,
    ...section("Problems", s.problems.map((p) => `- ${p.name}${p.status ? ` (${p.status})` : ""}${p.onset ? `, onset ${p.onset}` : ""}`)),
    ...section("Diagnoses", s.diagnoses.map((p) => `- ${p.name}${p.date ? `, ${p.date}` : ""}`)),
    ...section("Allergies", s.allergies.map((a) => `- ${a.substance}${a.reaction ? `: ${a.reaction}` : ""}${a.severity ? ` (${a.severity})` : ""}`)),
    ...section("Medications", s.medications.map((m) => `- ${m.name}${m.dosage ? `: ${m.dosage}` : ""}${m.status ? ` [${m.status}]` : ""}`)),
    ...section("Latest vital signs", s.vitals.map((v) => `- ${v.name}: ${v.value}${v.date ? ` (${v.date})` : ""}`)),
    ...section("Latest labs", s.labs.map((l) => `- ${l.name}: ${l.value}${l.flag ? ` ${l.flag}` : ""}${l.date ? ` (${l.date})` : ""}`)),
    ...section("Procedures", s.procedures.map((p) => `- ${p.name}${p.date ? `, ${p.date}` : ""}`)),
    ...section("Recent encounters", s.encounters.map((e) => `- ${e.start ?? ""} ${e.type}${e.location ? ` at ${e.location}` : ""}`)),
    ...section("Insurance", s.coverage.map((c) => `- ${c.payer}${c.memberId ? `, member ID ${c.memberId}` : ""}`)),
    ...(s.missing.length ? ["", `Not available from EHR: ${s.missing.join(", ")}`] : []),
  ];
}

// Simple text pages. Lines starting with "# " are bold headings.
function writePages(doc: PDFDocument, font: Awaited<ReturnType<PDFDocument["embedFont"]>>, bold: typeof font, lines: string[]) {
  const perPage = 60;
  for (let i = 0; i < lines.length; i += perPage) {
    const page = doc.addPage([612, 792]);
    lines.slice(i, i + perPage).forEach((line, j) => {
      const heading = line.startsWith("# ");
      const text = (heading ? line.slice(2) : line).replace(/[^\x20-\x7E]/g, "?").slice(0, 110);
      page.drawText(text, { x: 40, y: 750 - j * 12, size: heading ? 11 : 9, font: heading ? bold : font });
    });
  }
}

// ---------- Sending: FAX_PROVIDER=mock (default) | sinch ----------

export async function sendFax(transferId: number, to: string, pdf: Uint8Array) {
  const provider = process.env.FAX_PROVIDER || "mock";
  let providerId: string | null = null;
  let status = "sent (mock - not transmitted)";

  if (provider === "sinch") {
    const form = new FormData();
    form.append("to", to);
    form.append("file", new Blob([Buffer.from(pdf)], { type: "application/pdf" }), `transfer-${transferId}.pdf`);
    form.append("callbackUrl", `${process.env.PUBLIC_URL}/api/fax/webhook?token=${process.env.WEBHOOK_TOKEN}`);
    form.append("callbackUrlContentType", "application/json");
    const res = await fetch(`https://fax.api.sinch.com/v3/projects/${process.env.SINCH_PROJECT_ID}/faxes`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${process.env.SINCH_KEY_ID}:${process.env.SINCH_KEY_SECRET}`).toString("base64") },
      body: form,
    });
    if (!res.ok) throw new Error(`Sinch fax failed (${res.status}): ${await res.text()}`);
    const json = await res.json();
    providerId = json.id;
    status = (json.status ?? "queued").toLowerCase();
  }

  await run("INSERT INTO faxes (transfer_id, to_number, provider, provider_id, status, pdf) VALUES ($1, $2, $3, $4, $5, $6)", [
    transferId,
    to,
    provider,
    providerId,
    status,
    Buffer.from(pdf),
  ]);
}

export async function setFaxStatus(providerId: string, status: string) {
  await run("UPDATE faxes SET status = $1 WHERE provider_id = $2", [status.toLowerCase(), providerId]);
}
