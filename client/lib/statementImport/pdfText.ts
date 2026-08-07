"use client";

import type { PositionedTextItem } from "./neoBankAudiParser";

/** A real bank statement is never this long — a cap bounds how much work a huge or malicious PDF can force the browser to do before this feature gives up and reports an error instead. */
const MAX_PAGES = 50;
/** A malformed (not just unsupported) PDF can leave pdf.js's own getDocument() promise hanging indefinitely rather than rejecting — confirmed against a genuinely corrupt file. Without this, the modal's "Reading statement…" state never resolves and the underlying parse keeps running in the background forever. */
const LOAD_TIMEOUT_MS = 20_000;

export class TooManyPagesError extends Error {}
export class CancelledError extends Error {}
export class LoadTimeoutError extends Error {}

/**
 * The only module in statementImport/ that touches pdfjs-dist or the
 * browser — everything downstream (neoBankAudiParser.ts) is a pure
 * function over plain {text, x, y, page} data so it can be unit-tested
 * without a PDF worker. Runs entirely client-side: the PDF (and the real
 * banking data in it) never leaves the browser, matching the rest of the
 * app's local-first model.
 *
 * `isCancelled` is polled between pages so closing the import modal
 * mid-parse stops the work instead of letting it run to completion in the
 * background against an unmounted component.
 */
export async function extractPositionedText(file: File, isCancelled: () => boolean = () => false): Promise<PositionedTextItem[]> {
  const pdfjsLib = await import("pdfjs-dist");
  // Served as a plain static file from public/ (see public/pdf.worker.min.mjs,
  // copied from node_modules/pdfjs-dist/build/) rather than resolved via
  // `new URL(..., import.meta.url)` — that form hands the worker to
  // webpack's asset pipeline, and Next's Terser minifier chokes on the
  // worker's ESM import/export syntax when it tries to re-minify it.
  // A plain public URL bypasses webpack entirely; Next serves it as-is.
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const buf = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: buf });
  const pdf = await Promise.race([
    loadingTask.promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new LoadTimeoutError("Timed out opening this PDF.")), LOAD_TIMEOUT_MS)),
  ]).catch(async (err) => {
    await loadingTask.destroy().catch(() => {}); // best-effort — clean up whatever pdf.js was still doing
    throw err;
  });
  try {
    if (pdf.numPages > MAX_PAGES) throw new TooManyPagesError(`Statement has ${pdf.numPages} pages (max ${MAX_PAGES}).`);

    const items: PositionedTextItem[] = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      if (isCancelled()) throw new CancelledError();
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      for (const raw of content.items) {
        if (!("str" in raw) || !raw.str.trim()) continue;
        // transform: [scaleX, skewX, skewY, scaleY, translateX, translateY] — [4]/[5] are the item's x/y.
        items.push({ text: raw.str, x: raw.transform[4], y: raw.transform[5], page: pageNum });
      }
    }
    return items;
  } finally {
    await pdf.destroy();
  }
}
