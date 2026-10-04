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
} from "pdf-lib";
import { db } from "./db";
import { askForObject } from "./llm";
import { HOSPITALS, type Hospital } from "./hospitals";
import { pageImages, pageText, type TextItem } from "./pdf-pages";
import type { Transfer } from "./transfers";

// A fillable PDF field (from the PDF itself), or a box on a scanned/faxed page
// found by the AI (`box` set, PDF points, top-left origin).
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
  status: "reading" | "ready" | "failed";
  error: string | null;
  source: string;
  sender: string | null;
  received_at: string;
};

export const getForm = (id: number) => db.prepare("SELECT * FROM forms WHERE id = ?").get(id) as FormRow | undefined;

export function listForms(hospitalId?: string) {
  const sql = "SELECT id, hospital_id, name, fields, status, error, source, sender, received_at FROM forms";
  const rows = hospitalId
    ? db.prepare(`${sql} WHERE hospital_id = ? ORDER BY id DESC`).all(hospitalId)
    : db.prepare(`${sql} ORDER BY id DESC`).all();
  return rows as Omit<FormRow, "pdf">[];
}

// Store an incoming form (upload, email attachment or received fax).
// The forms agent (lib/agent.ts) then reads and fills it.
export async function saveForm(input: { name: string; bytes: Uint8Array; mime: string; hospitalId: string | null; source: string; sender?: string }) {
  const pdf = await toPdf(input.bytes, input.mime);
  const r = db
    .prepare("INSERT INTO forms (hospital_id, name, pdf, source, sender) VALUES (?, ?, ?, ?, ?)")
    .run(input.hospitalId, input.name, Buffer.from(pdf), input.source, input.sender ?? null);
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

// ---------- Reading a form: which blanks does it have? ----------

export async function readForm(pdf: Uint8Array): Promise<{ fields: FormField[]; title: string | null; hospitalId: string | null }> {
  const fillable = await detectFields(pdf);
  if (fillable.length) return { fields: fillable, title: null, hospitalId: null };
  return readFormWithAI(pdf); // scanned / faxed / flat PDF
}

// Fillable PDFs: take the fields from the PDF. Field names are often cryptic
// ("Text12"), so the label is the tooltip or the printed text next to the field.
export async function detectFields(pdf: Uint8Array): Promise<FormField[]> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const fields = doc.getForm().getFields();
  if (!fields.length) return [];
  const text = await pageText(pdf);
  const pageRefs = doc.getPages().map((p) => p.ref);

  return fields
    .map((f): FormField | null => {
      const tooltip = f.acroField.dict.get(PDFName.of("TU"))?.toString().replace(/^\(|\)$/g, "");
      const widget = f.acroField.getWidgets()[0];
      // The widget's page: its /P entry, or the page whose annotations list it.
      const ref = widget && doc.context.getObjectRef(widget.dict);
      const page = widget
        ? pageRefs.findIndex((p, i) => p === widget.P() || doc.getPage(i).node.Annots()?.asArray().includes(ref!))
        : -1;
      const label = tooltip || (widget && page >= 0 ? nearbyText(text, page, widget.getRectangle()) : null) || f.getName();
      const base = { name: f.getName(), label };
      if (f instanceof PDFTextField) return { ...base, type: "text" };
      if (f instanceof PDFCheckBox) return { ...base, type: "checkbox" };
      if (f instanceof PDFDropdown || f instanceof PDFOptionList || f instanceof PDFRadioGroup)
        return { ...base, type: "choice", options: f.getOptions() };
      return null; // buttons, signatures
    })
    .filter((f): f is FormField => f !== null);
}

// Closest printed text to the left of, or just above, a field.
function nearbyText(text: TextItem[], page: number, r: { x: number; y: number; width: number; height: number }) {
  let best: { text: string; d: number } | null = null;
  for (const t of text) {
    if (t.page !== page || !/[a-z]{2}/i.test(t.text)) continue;
    const left = t.x + t.width <= r.x + 4 && Math.abs(t.y - r.y) <= r.height + 4;
    const above = t.y >= r.y + r.height - 2 && t.y <= r.y + r.height + 24 && t.x < r.x + r.width && t.x + t.width > r.x - 4;
    if (!left && !above) continue;
    const d = left ? r.x - (t.x + t.width) : (t.y - (r.y + r.height)) * 2;
    if (!best || d < best.d) best = { text: t.text.replace(/[:_]+$/, "").trim(), d };
  }
  return best?.text ?? null;
}

const hospitalIds = HOSPITALS.map((h) => h.id) as [string, ...string[]];

// Scanned or flat forms: a vision model looks at the pages and finds every blank.
export async function readFormWithAI(pdf: Uint8Array) {
  const images = await pageImages(pdf);
  const sizes = (await PDFDocument.load(pdf, { ignoreEncryption: true })).getPages().map((p) => p.getSize());
  const result = await askForObject(
    z.object({
      title: z.string(),
      hospital: z.enum([...hospitalIds, "unknown"]),
      fields: z.array(
        z.object({
          label: z.string(),
          type: z.enum(["text", "checkbox"]),
          page: z.number().int(),
          box: z.array(z.number()).length(4).describe("[ymin, xmin, ymax, xmax], 0-1000 relative to the page image"),
        }),
      ),
    }),
    `You read hospital patient-transfer request forms (scans or faxes).
List EVERY blank the referring hospital must fill in: lines, boxes, checkboxes, table cells.
- label: the printed label for that blank, as written (add the section name if the label alone is ambiguous).
- page: 0-based page index (images are given in order).
- box: the EMPTY area where the answer is written (not the label), as [ymin, xmin, ymax, xmax] scaled 0-1000.
- Skip signature lines and fields for the receiving hospital's own use.
- title: the form's title. hospital: which hospital issued it, from letterhead/logo (${HOSPITALS.map((h) => `${h.id} = ${h.name}`).join("; ")}), else "unknown".`,
    `This form has ${images.length} page(s).`,
    images,
  );

  const fields: FormField[] = result.fields
    .filter((f) => sizes[f.page])
    .map((f, i) => {
      const { width: W, height: H } = sizes[f.page];
      const [ymin, xmin, ymax, xmax] = f.box;
      return {
        name: `ai_${i + 1}`,
        label: f.label,
        type: f.type,
        box: { page: f.page, x: (xmin / 1000) * W, y: (ymin / 1000) * H, width: ((xmax - xmin) / 1000) * W, height: ((ymax - ymin) / 1000) * H },
      };
    });
  return { fields, title: result.title || null, hospitalId: result.hospital === "unknown" ? null : result.hospital };
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
  // Wrap to the box width, shrinking the font until it fits; text sits on the bottom of the box (the form's line).
  for (let size = Math.min(10, height - 2); size >= 5; size--) {
    const lines = wrap(value, font, size, width);
    const lineHeight = size * 1.15;
    if (lines.length * lineHeight <= height || size === 5) {
      const firstBaseline = top - height + 3 + (lines.length - 1) * lineHeight;
      lines.forEach((line, i) => page.drawText(line, { x: x + 2, y: firstBaseline - i * lineHeight, size, font, color: rgb(0, 0, 0.6) }));
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
