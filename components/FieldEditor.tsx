"use client";

import { useEffect, useRef, useState } from "react";
import { saveFormFields } from "@/app/actions";
import type { FormField } from "@/lib/forms";

const SCALE = 1.5; // screen pixels per PDF point

// For scanned/faxed forms with no fillable fields: drag a box where each answer
// goes and name it ("Admitting diagnosis", "Allergies", ...). The AI fills by name.
export function FieldEditor({ formId, initial }: { formId: number; initial: FormField[] }) {
  const [fields, setFields] = useState(initial);
  const [pages, setPages] = useState<{ width: number; height: number }[]>([]);
  const [type, setType] = useState<"text" | "checkbox">("text");
  const [drag, setDrag] = useState<{ page: number; x0: number; y0: number; x: number; y: number } | null>(null);
  const [saved, setSaved] = useState(true);
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);

  // Render the PDF pages with pdf.js.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"); // legacy build = works in older browsers
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const doc = await pdfjs.getDocument({ url: `/api/forms/${formId}/pdf` }).promise;
      const sizes = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const vp = (await doc.getPage(i)).getViewport({ scale: SCALE });
        sizes.push({ width: vp.width, height: vp.height });
      }
      if (cancelled) return;
      setPages(sizes);
      requestAnimationFrame(async () => {
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const canvas = canvases.current[i - 1];
          if (canvas) await page.render({ canvas, viewport: page.getViewport({ scale: SCALE }) }).promise;
        }
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [formId]);

  const pos = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function finish() {
    if (!drag) return;
    const box = {
      page: drag.page,
      x: Math.min(drag.x0, drag.x) / SCALE,
      y: Math.min(drag.y0, drag.y) / SCALE,
      width: Math.abs(drag.x - drag.x0) / SCALE,
      height: Math.abs(drag.y - drag.y0) / SCALE,
    };
    setDrag(null);
    if (box.width < 5 || box.height < 5) return;
    const label = window.prompt("What goes in this box? (e.g. Patient name, Admitting diagnosis)");
    if (!label) return;
    setFields((f) => [...f, { name: `field_${Date.now()}`, label, type, box }]);
    setSaved(false);
  }

  function remove(name: string) {
    setFields((f) => f.filter((x) => x.name !== name));
    setSaved(false);
  }

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 flex items-center gap-3 rounded-md border bg-white p-2 text-sm shadow-sm">
        <span>Drag on the page to add a</span>
        <select value={type} onChange={(e) => setType(e.target.value as "text" | "checkbox")} className="input w-auto">
          <option value="text">text field</option>
          <option value="checkbox">checkbox</option>
        </select>
        <span className="text-gray-500">· click a box to remove it</span>
        <button
          className="btn ml-auto"
          disabled={saved}
          onClick={async () => {
            await saveFormFields(formId, fields);
            setSaved(true);
          }}
        >
          {saved ? "Saved" : "Save fields"}
        </button>
      </div>

      {pages.map((size, i) => (
        <div
          key={i}
          className="relative mx-auto cursor-crosshair border shadow"
          style={size}
          onMouseDown={(e) => setDrag({ page: i, x0: pos(e).x, y0: pos(e).y, ...pos(e) })}
          onMouseMove={(e) => drag?.page === i && setDrag({ ...drag, ...pos(e) })}
          onMouseUp={finish}
        >
          <canvas ref={(el) => { canvases.current[i] = el; }} width={size.width} height={size.height} />
          {fields
            .filter((f) => f.box?.page === i)
            .map((f) => (
              <div
                key={f.name}
                title="Click to remove"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => remove(f.name)}
                className="absolute cursor-pointer overflow-hidden border-2 border-blue-600 bg-blue-200/40 text-[10px] leading-tight text-blue-900"
                style={{ left: f.box!.x * SCALE, top: f.box!.y * SCALE, width: f.box!.width * SCALE, height: f.box!.height * SCALE }}
              >
                {f.label}
              </div>
            ))}
          {drag?.page === i && (
            <div
              className="absolute border-2 border-dashed border-blue-600"
              style={{ left: Math.min(drag.x0, drag.x), top: Math.min(drag.y0, drag.y), width: Math.abs(drag.x - drag.x0), height: Math.abs(drag.y - drag.y0) }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
