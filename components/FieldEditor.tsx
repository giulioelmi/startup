"use client";

import { useState } from "react";
import { saveFormFields } from "@/app/actions";
import type { FormField } from "@/lib/forms";
import { PdfViewer } from "./PdfViewer";

// Shows the blanks the AI found on the form. Normally nothing to do here; if the
// AI missed one, "Adjust fields" lets you drag a box over it or click one to remove it.
export function FieldEditor({ formId, initial }: { formId: number; initial: FormField[] }) {
  const [fields, setFields] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState<{ page: number; x0: number; y0: number; x: number; y: number } | null>(null);
  const [saved, setSaved] = useState(true);
  const placed = fields.filter((f) => f.box).length;

  const pos = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function finish(scale: number) {
    if (!drag) return;
    const box = {
      page: drag.page,
      x: Math.min(drag.x0, drag.x) / scale,
      y: Math.min(drag.y0, drag.y) / scale,
      width: Math.abs(drag.x - drag.x0) / scale,
      height: Math.abs(drag.y - drag.y0) / scale,
    };
    setDrag(null);
    if (box.width < 5 || box.height < 5) return;
    const label = window.prompt("What goes in this box? (e.g. Admitting diagnosis)");
    if (!label) return;
    setFields((f) => [...f, { name: `manual_${Date.now()}`, label, type: "text", box }]);
    setSaved(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-slate-600">
          {placed > 0 ? `Highlighted: the ${placed} blanks the AI found on the scan.` : "Fillable PDF: the AI fills its built-in fields."}
          {editing && " Drag to add a missed blank; click a box to remove it."}
        </span>
        <button className="btn-light ml-auto" onClick={() => setEditing(!editing)}>
          {editing ? "Done" : "Adjust fields"}
        </button>
        {!saved && (
          <button
            className="btn"
            onClick={async () => {
              await saveFormFields(formId, fields);
              setSaved(true);
            }}
          >
            Save fields
          </button>
        )}
      </div>

      <PdfViewer
        url={`/api/forms/${formId}/pdf`}
        pageHandlers={(i, scale) =>
          editing
            ? {
                style: { cursor: "crosshair" },
                onMouseDown: (e) => setDrag({ page: i, x0: pos(e).x, y0: pos(e).y, ...pos(e) }),
                onMouseMove: (e) => {
                  if (drag?.page === i) setDrag({ ...drag, ...pos(e) });
                },
                onMouseUp: () => finish(scale),
              }
            : {}
        }
        overlay={(i, scale) => (
          <>
            {fields
              .filter((f) => f.box?.page === i)
              .map((f) => (
                <div
                  key={f.name}
                  title={f.label}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    if (!editing) return;
                    setFields((all) => all.filter((x) => x.name !== f.name));
                    setSaved(false);
                  }}
                  className={`absolute overflow-hidden rounded-sm border border-teal-500 bg-teal-300/25 px-0.5 text-[9px] leading-tight text-teal-900 ${editing ? "cursor-pointer hover:bg-red-300/40" : ""}`}
                  style={{ left: f.box!.x * scale, top: f.box!.y * scale, width: f.box!.width * scale, height: f.box!.height * scale }}
                >
                  {f.label}
                </div>
              ))}
            {drag?.page === i && (
              <div
                className="absolute border-2 border-dashed border-teal-600"
                style={{ left: Math.min(drag.x0, drag.x), top: Math.min(drag.y0, drag.y), width: Math.abs(drag.x - drag.x0), height: Math.abs(drag.y - drag.y0) }}
              />
            )}
          </>
        )}
      />
    </div>
  );
}
