// FB-1c (SEC-03): pdf.js probes whether eval works, with `new Function("")`
// in a try/catch. Under the content policy (no 'unsafe-eval') that probe is a
// violation: reported in phase 1, silently refused once enforced. Text
// extraction, the only thing this app asks of pdf.js, never needs eval, so
// the probe is switched off.
import { describe, it, expect, vi } from "vitest";

const getDocument = vi.fn();
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: (...a: unknown[]) => getDocument(...a) }));

import { extractPositionedText } from "./pdfText";

describe("opening a statement PDF", () => {
  it("tells pdf.js not to try eval, and loads its worker from ESSA's own site", async () => {
    const pdf = { numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [{ str: "Balance", transform: [1, 0, 0, 1, 10, 20] }] }) }), destroy: async () => {} };
    getDocument.mockReturnValue({ promise: Promise.resolve(pdf), destroy: async () => {} });
    const pdfjs = await import("pdfjs-dist");

    const file = new File([new Uint8Array([37, 80, 68, 70])], "s.pdf", { type: "application/pdf" });
    const items = await extractPositionedText(file);

    expect(getDocument).toHaveBeenCalledTimes(1);
    expect(getDocument.mock.calls[0][0]).toMatchObject({ isEvalSupported: false });
    expect((pdfjs.GlobalWorkerOptions as { workerSrc?: string }).workerSrc).toBe("/pdf.worker.min.mjs");
    expect(items).toEqual([{ text: "Balance", x: 10, y: 20, page: 1 }]);
  });
});
