"use client";

import { useEffect, useRef, useState } from "react";

type Size = { width: number; height: number }; // PDF points

// Shows every page of a PDF, scaled to the container width. `overlay` draws on
// top of a page (coordinates: PDF points × scale, top-left origin).
export function PdfViewer({
  url,
  overlay,
  pageHandlers,
}: {
  url: string;
  overlay?: (page: number, scale: number) => React.ReactNode;
  pageHandlers?: (page: number, scale: number) => React.HTMLAttributes<HTMLDivElement>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const [pages, setPages] = useState<Size[]>([]);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"); // legacy build = works in older browsers
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const doc = await pdfjs.getDocument({ url }).promise;
        const sizes: Size[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
          sizes.push({ width: vp.width, height: vp.height });
        }
        const s = (box.current?.clientWidth ?? 800) / sizes[0].width;
        if (cancelled) return;
        setScale(s);
        setPages(sizes);
        requestAnimationFrame(async () => {
          for (let i = 1; i <= doc.numPages; i++) {
            const canvas = canvases.current[i - 1];
            const page = await doc.getPage(i);
            // Render at 2x for sharp text, display at 1x.
            if (canvas) await page.render({ canvas, viewport: page.getViewport({ scale: s * 2 }) }).promise;
          }
        });
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <div ref={box} className="space-y-4">
      {error && <p className="text-sm text-red-700">Could not open PDF: {error}</p>}
      {!error && !pages.length && <div className="h-96 animate-pulse rounded-lg bg-slate-100" />}
      {pages.map((p, i) => {
        const handlers = pageHandlers?.(i, scale) ?? {};
        return (
        <div key={i} {...handlers} className="relative bg-white shadow-md ring-1 ring-slate-200" style={{ ...handlers.style, width: p.width * scale, height: p.height * scale }}>
          <canvas
            ref={(el) => {
              canvases.current[i] = el;
            }}
            width={p.width * scale * 2}
            height={p.height * scale * 2}
            style={{ width: p.width * scale, height: p.height * scale }}
          />
          {overlay?.(i, scale)}
        </div>
        );
      })}
    </div>
  );
}
