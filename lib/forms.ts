import { z } from "zod";
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  rgb,
  type PDFField,
} from "pdf-lib";
import { db } from "./db";
import { askForObject } from "./llm";
import type { Hospital } from "./hospitals";
import type { Transfer } from "./transfers";

// A fillable PDF field (from the PDF itself), or a box someone placed on a
// scanned/faxed page in the field editor (`box` set, PDF points, top-left origin).
export type FormField = {
  name: string;
  label: string;
  type: "text" | "checkbox" | "choice";
  options?: string[];
  box?: { page: number; x: number; y: number; width: number; height: number };
};

// `source` says where in the chart the value came from, or "not in record".
export type FieldValue = { name: string; value: string; source: string };

export type FormRow = {
  id: number;
  hospital_id: string | null;
  name: string;
  pdf: Buffer;
  fields: string;
  source: string;
  sender: string | null;
  received_at: string;
};

export const getForm = (id: number) => db.prepare("SELECT * FROM forms WHERE id = ?").get(id) as FormRow | undefined;

export function listForms(hospitalId?: string) {
  const sql = "SELECT id, hospital_id, name, fields, source, sender, received_at FROM forms";
  const rows = hospitalId
    ? db.prepare(`${sql} WHERE hospital_id = ? ORDER BY id DESC`).all(hospitalId)
    : db.prepare(`${sql} ORDER BY id DESC`).all();
  return rows as Omit<FormRow, "pdf">[];
}

// Store an incoming form (upload, email attachment or received fax).
export async function saveForm(input: { name: string; bytes: Uint8Array; mime: string; hospitalId: string | null; source: string; sender?: string }) {
  const pdf = await toPdf(input.bytes, input.mime);
  const fields = await detectFields(pdf);
  const r = db
    .prepare("INSERT INTO forms (hospital_id, name, pdf, fields, source, sender) VALUES (?, ?, ?, ?, ?, ?)")
    .run(input.hospitalId, input.name, Buffer.from(pdf), JSON.stringify(fields), input.source, input.sender ?? null);
  return Number(r.lastInsertRowid);
}

// Photos/scans of a form become a one-page PDF so everything downstream is PDF.
export async function toPdf(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  if (mime === "application/pdf") return bytes;
  const doc = await PDFDocument.create();
  const img = mime === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const scale = Math.min(612 / img.width, 792 / img.height); // fit US Letter
  const page = doc.addPage([612, 792]);
  page.drawImage(img, { x: 0, y: 792 - img.height * scale, width: img.width * scale, height: img.height * scale });
  return doc.save();
}

function fieldType(f: PDFField): FormField | null {
  // The tooltip (/TU) is usually the human-readable label.
  const tooltip = f.acroField.dict.get(PDFName.of("TU"))?.toString().replace(/^\(|\)$/g, "");
  const base = { name: f.getName(), label: tooltip || f.getName() };
  if (f instanceof PDFTextField) return { ...base, type: "text" };
  if (f instanceof PDFCheckBox) return { ...base, type: "checkbox" };
  if (f instanceof PDFDropdown || f instanceof PDFOptionList || f instanceof PDFRadioGroup)
    return { ...base, type: "choice", options: f.getOptions() };
  return null; // buttons, signatures
}

export async function detectFields(pdf: Uint8Array): Promise<FormField[]> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  return doc.getForm().getFields().map(fieldType).filter((f): f is FormField => f !== null);
}

// Ask the AI to fill every field from the chart. It must not invent anything.
export async function fillValues(fields: FormField[], transfer: Transfer, hospital: Hospital | undefined): Promise<FieldValue[]> {
  if (!fields.length) return [];
  const { values } = await askForObject(
    z.object({ values: z.array(z.object({ name: z.string(), value: z.string(), source: z.string() })) }),
    `You fill hospital transfer request forms for a referring hospital.
Rules:
- Use ONLY the data provided. Never guess or invent clinical facts.
- If the data is not available, value = "" and source = "not in record".
- source = where the value came from, e.g. "chart: labs.Potassium", "transfer: referringPhysician", "today's date".
- checkbox fields: value "true" or "false". choice fields: value must be one of the options or "".
- Dates as MM/DD/YYYY. Keep text short enough to fit on a form.
- Return one entry per field, using the exact field name.`,
    JSON.stringify({
      today: new Date().toLocaleDateString("en-US"),
      receivingHospital: hospital?.name ?? null,
      reasonForTransfer: transfer.reason,
      transfer: transfer.details,
      chart: transfer.summary,
      fields: fields.map((f) => ({ name: f.name, label: f.label, type: f.type, options: f.options })),
    }),
  );
  // Keep exactly one value per field, in form order.
  return fields.map((f) => values.find((v) => v.name === f.name) ?? { name: f.name, value: "", source: "not in record" });
}

// Standard PDF fonts only cover basic Latin; replace anything else.
const safe = (s: string) => s.replace(/[^\x20-\x7E\n]/g, "?");

export async function renderFilled(pdf: Uint8Array, fields: FormField[], values: FieldValue[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();

  for (const f of fields) {
    const value = safe(values.find((v) => v.name === f.name)?.value ?? "");
    if (f.box) {
      drawInBox(doc.getPage(f.box.page), f, value, font);
      continue;
    }
    const field = form.getField(f.name);
    if (field instanceof PDFTextField) field.setText(value);
    else if (field instanceof PDFCheckBox) {
      if (value === "true") field.check();
      else field.uncheck();
    }
    else if (value && (field instanceof PDFDropdown || field instanceof PDFOptionList || field instanceof PDFRadioGroup)) field.select(value);
  }
  form.updateFieldAppearances(font);
  form.flatten();
  return doc.save();
}

type Page = ReturnType<PDFDocument["getPage"]>;
type Font = Awaited<ReturnType<PDFDocument["embedFont"]>>;

function drawInBox(page: Page, f: FormField, value: string, font: Font) {
  const { x, y, width, height } = f.box!;
  const top = page.getHeight() - y; // convert top-left origin to PDF bottom-left
  if (f.type === "checkbox") {
    if (value === "true") page.drawText("X", { x: x + 1, y: top - height + 1, size: Math.min(height, 12), font });
    return;
  }
  // Wrap to the box width, shrinking the font until it fits the box height.
  for (let size = Math.min(10, height - 2); size >= 5; size--) {
    const lines = wrap(value, font, size, width);
    if (lines.length * size * 1.15 <= height || size === 5) {
      lines.forEach((line, i) =>
        page.drawText(line, { x: x + 1, y: top - size - i * size * 1.15, size, font, color: rgb(0, 0, 0.6) }),
      );
      return;
    }
  }
}

function wrap(text: string, font: Font, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width - 2 && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}
