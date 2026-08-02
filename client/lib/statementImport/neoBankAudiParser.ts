/**
 * Parser for Neo by Bank Audi PDF statements. Pure — takes positioned text
 * items already extracted from the PDF (see pdfText.ts, the only module
 * that actually touches pdfjs-dist/the browser worker) and returns
 * structured rows, then applies this statement format's specific business
 * rules to turn those rows into transactions ready for review/import.
 *
 * Column classification is x-position-based (calibrated from the header
 * row's own x-positions), not a fixed pixel table — column reflow between
 * statement exports is more likely than the header row's own text moving
 * relative to its column.
 *
 * Row grouping assumes the PDF's text items are emitted in row-major
 * reading order (date cell, then description cell(s), then the
 * MONEY OUT/MONEY IN/BALANCE cells, then the next row's date) — true for
 * this statement's exporter (confirmed against a real sample), worth
 * revisiting if a differently-generated Neo statement breaks the
 * assumption.
 */

export interface PositionedTextItem {
  text: string;
  x: number;
  y: number;
  page: number;
}

export type Bucket = "NEEDS" | "WANTS" | "SAVINGS";

export interface StatementRow {
  date: string | null;       // YYYY-MM-DD, or null for a continuation-only row (shouldn't occur in output)
  description: string;
  moneyOut: number | null;
  moneyIn: number | null;
  balance: number | null;
}

export interface ParsedTransaction {
  date: string;         // YYYY-MM-DD
  description: string;
  amount: number;       // always positive
  nettedRefund?: boolean; // true when this row absorbed a matching REV reversal
}

export interface UnmatchedRefund {
  date: string;
  description: string;
  amount: number;
}

export interface ParseResult {
  transactions: ParsedTransaction[];
  skippedTransferCount: number;
  unmatchedRefunds: UnmatchedRefund[];
  openingBalance: number | null;
  closingBalance: number | null;
}

const HEADER_LABELS = ["DATE", "TRANSACTIONS", "MONEY OUT", "MONEY IN", "BALANCE"] as const;
type Column = "DATE" | "TRANSACTIONS" | "MONEY OUT" | "MONEY IN" | "BALANCE";

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const NUMBER_RE = /^-?[\d,]+\.\d{2}$/;

function toISODate(ddmmyyyy: string): string | null {
  const m = DATE_RE.exec(ddmmyyyy);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function parseAmount(text: string): number | null {
  const t = text.trim();
  if (t === "-" || t === "") return null;
  if (!NUMBER_RE.test(t)) return null;
  return parseFloat(t.replace(/,/g, ""));
}

/** Scans the raw extracted text for an IBAN (LBxx...) to suggest a card's last 4 digits — purely a UI prefill, always editable. */
export function guessAccountLast4(items: PositionedTextItem[]): string | null {
  for (const item of items) {
    const m = /LB\d{20,}/.exec(item.text.replace(/\s+/g, ""));
    if (m) return m[0].slice(-4);
  }
  return null;
}

/** Normalizes a merchant description for matching (refund-netting, duplicate detection, categorization) — not for display. */
export function normalizeDescription(desc: string): string {
  return desc
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/**
 * Classifies items into the 5 known columns by x-position, calibrated from
 * wherever the header row's own labels land on this particular PDF export.
 */
function calibrateColumns(
  items: PositionedTextItem[],
): { boundaries: { x: number; column: Column }[]; headerItems: Set<PositionedTextItem> } | null {
  const boundaries: { x: number; column: Column }[] = [];
  const headerItems = new Set<PositionedTextItem>();
  for (const label of HEADER_LABELS) {
    // "MONEY OUT"/"MONEY IN" can render as one combined item ("MONEY OUT")
    // or split across two ("MONEY" + "OUT") depending on the PDF's text
    // runs — match either shape. Matched items are tracked by identity (not
    // re-matched by text later) so real transaction text that happens to
    // contain a header word ("Balance" in a description, say) is never
    // mistaken for the header row itself.
    const parts = label.split(" ");
    const matches = items.filter((it) => {
      const t = it.text.trim().toUpperCase();
      return t === label || t === parts[0] || (parts.length > 1 && t === parts[1]);
    });
    if (matches.length === 0) return null;
    for (const m of matches) headerItems.add(m);
    boundaries.push({ x: matches[0].x, column: label as Column });
  }
  return { boundaries: boundaries.sort((a, b) => a.x - b.x), headerItems };
}

function classifyColumn(x: number, boundaries: { x: number; column: Column }[]): Column {
  // Midpoint-between-headers boundary; last column extends to +infinity.
  let col: Column = boundaries[0].column;
  for (let i = 0; i < boundaries.length; i++) {
    const nextBoundary = i + 1 < boundaries.length ? (boundaries[i].x + boundaries[i + 1].x) / 2 : Infinity;
    if (x < nextBoundary) { col = boundaries[i].column; break; }
    col = boundaries[i].column;
  }
  return col;
}

export function parseStatementRows(items: PositionedTextItem[]): StatementRow[] {
  const calibrated = calibrateColumns(items);
  if (!calibrated) return [];
  const { boundaries, headerItems } = calibrated;

  // Reading order: by page, then by visual position (y descending — PDF y
  // increases upward, so higher y is higher on the page — then x ascending
  // within the same y). NOT simple extraction-stream order: a real sample
  // statement showed a row whose description text item was emitted BEFORE
  // its date item at the identical y, and a page's footer/QR-code
  // boilerplate emitted before that page's actual table rows despite being
  // visually below them — extraction order isn't reliably visual order,
  // but (page, y, x) is.
  const ordered = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);

  const rows: StatementRow[] = [];
  let current: StatementRow | null = null;

  for (const item of ordered) {
    const text = item.text.trim();
    if (!text) continue;
    if (headerItems.has(item)) continue; // skip the header row itself (matched by identity, not re-matched by text)
    if (isBoilerplate(text)) continue; // this statement's static footer (QR/verification/address block)

    const column = classifyColumn(item.x, boundaries);

    if (column === "DATE") {
      const iso = toISODate(text);
      if (iso) {
        if (current) rows.push(current);
        current = { date: iso, description: "", moneyOut: null, moneyIn: null, balance: null };
        continue;
      }
      // A DATE-column item that isn't actually a date (rare) falls through as description text below.
    }

    if (!current) continue; // stray text before the first real row (shouldn't happen post-header)

    if (column === "TRANSACTIONS") {
      current.description = current.description ? `${current.description} ${text}` : text;
    } else if (column === "MONEY OUT") {
      const n = parseAmount(text);
      if (n !== null) current.moneyOut = n;
    } else if (column === "MONEY IN") {
      const n = parseAmount(text);
      if (n !== null) current.moneyIn = n;
    } else if (column === "BALANCE") {
      const n = parseAmount(text);
      if (n !== null) current.balance = n;
    }
  }
  if (current) rows.push(current);

  return rows;
}

// This statement's static footer/signature block (verification notice, QR
// code caption, branch address, copyright line) — confirmed against a real
// sample to sit in the same x-range as the TRANSACTIONS column and to be
// emitted, on the final page, BEFORE that page's actual table rows despite
// rendering visually below them. Filtered by exact known phrases (this
// parser targets one specific bank's export, not arbitrary PDFs) rather
// than a positional heuristic, which would risk swallowing a real
// multi-line description that happens to wrap onto a new page.
const BOILERPLATE_PHRASES = [
  "for verifications",
  "scan the qr code",
  "this tamperproof is digitally signed.",
  "both printed and electronic copies can instantly be verified by scanning the qr code.",
];
function isBoilerplate(text: string): boolean {
  const t = text.trim().toLowerCase();
  return BOILERPLATE_PHRASES.some((p) => t === p) || /^©.*bank audi/i.test(text.trim()) || /^bank audi plaza,/i.test(text.trim());
}

const isOpeningOrClosing = (desc: string) => /^(opening|closing) balance$/i.test(desc.trim());
const isRefund = (desc: string) => /^rev\b/i.test(desc.trim());
const isTransfer = (desc: string) => /^transfer from own account/i.test(desc.trim());

export function parseNeoStatement(items: PositionedTextItem[]): ParseResult {
  const rows = parseStatementRows(items);

  let openingBalance: number | null = null;
  let closingBalance: number | null = null;
  let skippedTransferCount = 0;
  const purchases: (ParsedTransaction & { normDesc: string })[] = [];
  const refunds: { date: string; description: string; amount: number; normDesc: string }[] = [];

  for (const row of rows) {
    if (!row.date) continue;
    const desc = row.description.trim();

    if (isOpeningOrClosing(desc)) {
      if (/^opening/i.test(desc)) openingBalance = row.balance;
      else closingBalance = row.balance;
      continue;
    }

    if (isRefund(desc)) {
      if (row.moneyIn !== null) {
        refunds.push({ date: row.date, description: desc, amount: row.moneyIn, normDesc: normalizeDescription(desc.replace(/^rev\s*/i, "")) });
      }
      continue;
    }

    if (isTransfer(desc)) {
      if (row.moneyIn !== null) skippedTransferCount++;
      continue;
    }

    if (row.moneyOut !== null) {
      purchases.push({ date: row.date, description: desc, amount: row.moneyOut, normDesc: normalizeDescription(desc) });
    }
  }

  // Net refunds against a matching earlier purchase (same normalized description + amount).
  const unmatchedRefunds: UnmatchedRefund[] = [];
  for (const refund of refunds) {
    const match = purchases.find((p) => !p.nettedRefund && p.normDesc === refund.normDesc && p.amount === refund.amount);
    if (match) match.nettedRefund = true;
    else unmatchedRefunds.push({ date: refund.date, description: refund.description, amount: refund.amount });
  }

  const transactions: ParsedTransaction[] = purchases
    .filter((p) => !p.nettedRefund)
    .map(({ normDesc, ...t }) => t);

  return { transactions, skippedTransferCount, unmatchedRefunds, openingBalance, closingBalance };
}
