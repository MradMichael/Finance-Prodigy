"use client";

import type { PositionedTextItem } from "./neoBankAudiParser";

/**
 * The only module in statementImport/ that touches pdfjs-dist or the
 * browser — everything downstream (neoBankAudiParser.ts) is a pure
 * function over plain {text, x, y, page} data so it can be unit-tested
 * without a PDF worker. Runs entirely client-side: the PDF (and the real
 * banking data in it) never leaves the browser, matching the rest of the
 * app's local-first model.
 */
export async function extractPositionedText(file: File): Promise<PositionedTextItem[]> {
  const pdfjsLib = await import("pdfjs-dist");
  // Served as a plain static file from public/ (see public/pdf.worker.min.mjs,
  // copied from node_modules/pdfjs-dist/build/) rather than resolved via
  // `new URL(..., import.meta.url)` — that form hands the worker to
  // webpack's asset pipeline, and Next's Terser minifier chokes on the
  // worker's ESM import/export syntax when it tries to re-minify it.
  // A plain public URL bypasses webpack entirely; Next serves it as-is.
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  const items: PositionedTextItem[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    for (const raw of content.items) {
      if (!("str" in raw) || !raw.str.trim()) continue;
      // transform: [scaleX, skewX, skewY, scaleY, translateX, translateY] — [4]/[5] are the item's x/y.
      items.push({ text: raw.str, x: raw.transform[4], y: raw.transform[5], page: pageNum });
    }
  }
  return items;
}
