import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Server-side PDF reading with pdf.js: page images for the AI, and text positions.
const fonts = path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/");
// Copy into a plain Uint8Array: pdf.js takes ownership of the data and rejects Buffers.
const open = (pdf: Uint8Array) => getDocument({ data: new Uint8Array(pdf), standardFontDataUrl: fonts }).promise;

// PNG of each page (first `max` pages).
export async function pageImages(pdf: Uint8Array, max = 6): Promise<Buffer[]> {
  const doc = await open(pdf);
  const out: Buffer[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, max); i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(viewport.width, viewport.height);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.render({ canvas: canvas as any, viewport }).promise;
    out.push(canvas.toBuffer("image/png"));
  }
  return out;
}

// Every piece of printed text with its position (PDF points, bottom-left origin).
export type TextItem = { page: number; text: string; x: number; y: number; width: number };

export async function pageText(pdf: Uint8Array): Promise<TextItem[]> {
  const doc = await open(pdf);
  const items: TextItem[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    for (const it of content.items) {
      if ("str" in it && it.str.trim()) items.push({ page: i - 1, text: it.str.trim(), x: it.transform[4], y: it.transform[5], width: it.width });
    }
  }
  return items;
}
