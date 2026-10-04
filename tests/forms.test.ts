import { expect, test, vi } from "vitest";
import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { detectFields, fillValues, readForm, renderFilled, toPdf, type FormField } from "@/lib/forms";
import { buildPacket } from "@/lib/fax";
import { HOSPITALS } from "@/lib/hospitals";
import { summarize } from "@/lib/summary";
import type { Transfer } from "@/lib/transfers";
import { record } from "./fixture";

// The AI call is replaced by a canned answer; everything else is real.
const askForObject = vi.hoisted(() => vi.fn());
vi.mock("@/lib/llm", () => ({ askForObject }));

async function pdfText(bytes: Uint8Array) {
  const doc = await getDocument({ data: bytes.slice() }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    text += content.items.map((x) => ("str" in x ? x.str : "")).join(" ") + "\n";
  }
  return text;
}

async function fillablePdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  const name = form.createTextField("pt_name");
  name.acroField.dict.set(PDFName.of("TU"), PDFString.of("Patient name"));
  name.addToPage(page, { x: 50, y: 700, width: 300, height: 20 });
  form.createTextField("allergies").addToPage(page, { x: 50, y: 650, width: 300, height: 20 });
  form.createTextField("code_status").addToPage(page, { x: 50, y: 600, width: 300, height: 20 });
  form.createCheckBox("icu").addToPage(page, { x: 50, y: 550, width: 12, height: 12 });
  return doc.save();
}

const transfer: Transfer = {
  id: 7,
  patientId: "eTest123",
  patientName: "Camila Maria Lopez",
  reason: "NSTEMI, needs cardiac cath",
  details: {
    sendingHospital: "Pomona Community Hospital",
    sendingPhone: "909-555-0100",
    sendingFax: "909-555-0101",
    referringPhysician: "Dr. Ada Park",
    callbackPhone: "909-555-0102",
    caseManager: "",
    levelOfCare: "ICU",
    emergent: false,
  },
  summary: summarize(record),
  ranking: null,
  hospitalId: "keck",
  status: "open",
  outcomeReason: null,
  createdAt: "2026-10-04",
};

test("detects fillable fields and uses the tooltip as the label", async () => {
  const fields = await detectFields(await fillablePdf());
  expect(fields).toEqual([
    { name: "pt_name", label: "Patient name", type: "text" },
    { name: "allergies", label: "allergies", type: "text" },
    { name: "code_status", label: "code_status", type: "text" },
    { name: "icu", label: "icu", type: "checkbox" },
  ]);
});

test("cryptic field names get the printed label next to them", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();
  page.drawText("Admitting diagnosis:", { x: 50, y: 706, size: 10, font }); // left of the field
  form.createTextField("Text1").addToPage(page, { x: 160, y: 700, width: 300, height: 20 });
  page.drawText("Accepting physician", { x: 50, y: 662, size: 9, font }); // just above the field
  form.createTextField("Text2").addToPage(page, { x: 50, y: 635, width: 300, height: 20 });
  const fields = await detectFields(await doc.save());
  expect(fields.map((f) => f.label)).toEqual(["Admitting diagnosis", "Accepting physician"]);
});

test("a scanned form is read by the AI from page images", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).drawText("Cedars-Sinai transfer request    Diagnosis: ________", { x: 50, y: 700, size: 12 });
  askForObject.mockResolvedValueOnce({
    title: "Non-EMTALA Request for Transfer",
    hospital: "cedars",
    fields: [{ label: "Diagnosis", type: "text", page: 0, box: [100, 500, 125, 900] }],
  });
  const result = await readForm(await doc.save());
  expect(askForObject.mock.lastCall![3][0].subarray(1, 4).toString()).toBe("PNG"); // the model got the page image
  expect(result).toMatchObject({ title: "Non-EMTALA Request for Transfer", hospitalId: "cedars" });
  // 0-1000 box -> PDF points, top-left origin
  expect(result.fields[0]).toEqual({ name: "ai_1", label: "Diagnosis", type: "text", box: { page: 0, x: 306, y: 79.2, width: 244.8, height: 19.8 } });
});

test("fills a fillable PDF from AI values, one value per field", async () => {
  const pdf = await fillablePdf();
  const fields = await detectFields(pdf);
  askForObject.mockResolvedValueOnce({
    values: [
      { name: "allergies", value: "Penicillin (hives)", source: "chart: allergies" },
      { name: "pt_name", value: "Camila Maria Lopez", source: "chart: patient.name" },
      { name: "icu", value: "true", source: "transfer: levelOfCare" },
    ],
  });
  const values = await fillValues(fields, transfer, HOSPITALS[1]);
  expect(values.map((v) => v.name)).toEqual(["pt_name", "allergies", "code_status", "icu"]);
  expect(values[2]).toEqual({ name: "code_status", value: "", source: "not in record" });

  const out = await renderFilled(pdf, fields, values);
  const text = await pdfText(out);
  expect(text).toContain("Camila Maria Lopez");
  expect(text).toContain("Penicillin (hives)");
  expect((await PDFDocument.load(out)).getForm().getFields()).toHaveLength(0); // flattened
});

test("writes into boxes placed on a scanned form", async () => {
  const blank = await PDFDocument.create();
  blank.addPage([612, 792]);
  const pdf = await blank.save();
  const fields: FormField[] = [
    { name: "f1", label: "Diagnosis", type: "text", box: { page: 0, x: 72, y: 100, width: 200, height: 30 } },
    { name: "f2", label: "ICU", type: "checkbox", box: { page: 0, x: 72, y: 200, width: 12, height: 12 } },
  ];
  const out = await renderFilled(pdf, fields, [
    { name: "f1", value: "Acute non-ST elevation myocardial infarction with ongoing chest pain", source: "transfer" },
    { name: "f2", value: "true", source: "transfer" },
  ]);
  const text = await pdfText(out);
  expect(text).toContain("Acute non-ST elevation");
  expect(text).toContain("X");
});

test("turns a photo of a form into a PDF", async () => {
  // 1x1 PNG
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const pdf = await toPdf(png, "image/png");
  expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
});

test("fax packet = cover sheet + forms + record summary", async () => {
  const form = await renderFilled(await fillablePdf(), [], []);
  const packet = await buildPacket(transfer, HOSPITALS[1], [form]);
  const text = await pdfText(packet);
  expect((await PDFDocument.load(packet)).getPageCount()).toBe(3);
  expect(text).toContain("Keck Hospital of USC");
  expect(text).toContain("Pages (including cover): 3");
  expect(text).toContain("Transfer reference #: 7");
  expect(text).toContain("Penicillin: Hives");
  expect(text).toContain("Not available from EHR: procedures");
});
