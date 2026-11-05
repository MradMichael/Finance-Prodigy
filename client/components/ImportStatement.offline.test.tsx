// PWA P3 (owner-approved wording, 2026-11-05). Found in the browser (production build, offline, worker not yet
// saved): a harmless PDF got "Couldn't read this PDF. Make sure it's a real statement file, not a scanned
// image." -- blaming the file for a missing connection. Now, when the reader needs the network, the import says
// so before reading anything; and a read that fails for that reason says so too. A real read failure with the
// reader available keeps its own message.
import { it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ImportStatement, { IMPORT_NEEDS_NETWORK } from "./ImportStatement";
import { ThemeProvider } from "../contexts/ThemeContext";
import { DEFAULT_DATA, type LocalFinancials } from "../lib/localData";
import { extractPositionedText, readerNeedsNetwork } from "../lib/statementImport/pdfText";

vi.mock("../lib/statementImport/pdfText", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/statementImport/pdfText")>()),
  extractPositionedText: vi.fn(),
  readerNeedsNetwork: vi.fn(),
}));
afterEach(() => { cleanup(); vi.mocked(extractPositionedText).mockReset(); vi.mocked(readerNeedsNetwork).mockReset(); });

const FILE_MESSAGE = "Couldn't read this PDF. Make sure it's a real statement file, not a scanned image.";
function choose() {
  const data = { ...DEFAULT_DATA, income: 3000 } as LocalFinancials;
  const { container } = render(<ThemeProvider><ImportStatement financials={data} onImport={vi.fn()} onClose={vi.fn()} /></ThemeProvider>);
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["%PDF"], "s.pdf", { type: "application/pdf" })] } });
}

it("the sentence, verbatim", () => {
  expect(IMPORT_NEEDS_NETWORK).toBe("Reading a statement needs an internet connection right now. Connect, then try again. Nothing was imported.");
});

it("says it needs a connection before reading, when the reader isn't available offline", async () => {
  vi.mocked(readerNeedsNetwork).mockResolvedValue(true);
  choose();
  expect(await screen.findByText(IMPORT_NEEDS_NETWORK)).toBeTruthy();
  expect(extractPositionedText).not.toHaveBeenCalled();
  expect(screen.queryByText(FILE_MESSAGE)).toBeNull();
});

it("a read that fails because the connection went says so, not that the file is wrong", async () => {
  vi.mocked(readerNeedsNetwork).mockResolvedValueOnce(false).mockResolvedValue(true);
  vi.mocked(extractPositionedText).mockRejectedValue(new Error("Setting up fake worker failed"));
  choose();
  expect(await screen.findByText(IMPORT_NEEDS_NETWORK)).toBeTruthy();
  expect(screen.queryByText(FILE_MESSAGE)).toBeNull();
});

it("a read that fails with the reader available keeps the file's own message", async () => {
  vi.mocked(readerNeedsNetwork).mockResolvedValue(false);
  vi.mocked(extractPositionedText).mockRejectedValue(new Error("Invalid PDF structure"));
  choose();
  expect(await screen.findByText(FILE_MESSAGE)).toBeTruthy();
  expect(screen.queryByText(IMPORT_NEEDS_NETWORK)).toBeNull();
});
