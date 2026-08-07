import { describe, it, expect } from "vitest";
import { parseStatementRows, parseNeoStatement, normalizeDescription, guessAccountLast4, type PositionedTextItem } from "./neoBankAudiParser";

// Column x-positions mirror the real statement's layout (DATE, TRANSACTIONS,
// MONEY OUT, MONEY IN, BALANCE, left to right). Body text is jittered a few
// units off the header's exact x to mimic real PDF text-run variance, since
// the parser must tolerate that (it buckets by nearest column, not exact x).
const X = { DATE: 90, DESC: 170, OUT: 480, IN: 560, BAL: 650 };
let page = 1, y = 1000, seq = 0;
const it_ = (text: string, x: number): PositionedTextItem => ({ text, x, y: y--, page, });

function row(date: string | null, descLines: string[], moneyOut?: string, moneyIn?: string, balance?: string): PositionedTextItem[] {
  const items: PositionedTextItem[] = [];
  if (date) items.push(it_(date, X.DATE));
  for (const line of descLines) items.push(it_(line, X.DESC + (seq++ % 3))); // small x jitter
  if (moneyOut !== undefined) items.push(it_(moneyOut, X.OUT));
  if (moneyIn !== undefined) items.push(it_(moneyIn, X.IN));
  if (balance !== undefined) items.push(it_(balance, X.BAL));
  return items;
}

function buildFixture(): PositionedTextItem[] {
  const header = [it_("DATE", X.DATE), it_("TRANSACTIONS", X.DESC), it_("MONEY OUT", X.OUT), it_("MONEY IN", X.IN), it_("BALANCE", X.BAL)];
  const rows: PositionedTextItem[][] = [
    row("01/07/2026", ["Opening Balance"], undefined, undefined, "0.00"),
    row("04/07/2026", ["Transfer from Own Account", "500191330003 - Fuel Allocation"], "-", "120.00", "120.00"),
    row("07/07/2026", ["POS Purchase MOULIN DOR JEITA", "LB 0000"], "5.95", "-", "114.05"),
    row("07/07/2026", ["POS Purchase SPINNEYS ZOUK", "ZOUK MOSBEH LB 0000"], "4.98", "-", "109.07"),
    row("08/07/2026", ["POS Purchase LE CHARCUTIER", "AOUN JEITA LB 0000"], "3.83", "-", "105.24"),
    row("08/07/2026", ["POS Purchase FADDOUL STORE", "JOUNIEH LB 0000"], "4.96", "-", "100.28"),
    row("08/07/2026", ["POS Purchase TOTAL NACCACHE", "NACCACHE LB 0000"], "20.00", "-", "80.28"),
    row("08/07/2026", ["POS Purchase MOULIN D OR-JEITA", "JEITA LB 0000"], "25.00", "-", "55.28"),
    row("08/07/2026", ["POS Purchase MOULIN DOR JEITA", "LB 0000"], "5.95", "-", "49.33"),
    row("08/07/2026", ["POS Purchase BIRDHAUS DIGITAL", "SAL LEB LB 0000"], "8.50", "-", "40.83"),
    row("08/07/2026", ["REV POS Purchase MOULIN DOR", "JEITA LB 0000"], "-", "5.95", "46.78"),
    row("09/07/2026", ["Transfer from Own Account", "500191330003 - Fuel"], "-", "30.00", "76.78"),
    row("11/07/2026", ["Transfer from Own Account", "500191330003 -"], "-", "20.00", "96.78"),
    row("13/07/2026", ["POS Purchase CHOCOLA BEAN TO", "BAR DBAYEH LB 0000"], "9.35", "-", "87.43"),
    row("13/07/2026", ["POS Purchase SOURDOUGH DBAYE", "LB 0000"], "4.00", "-", "83.43"),
    row("13/07/2026", ["POS Purchase YAACOUB GROUP", "SARL ZOUK MIKAEL LB 0000"], "60.00", "-", "23.43"),
    row("14/07/2026", ["POS Purchase LE CHARCUTIER", "AOUN ADONIS LB 0000"], "8.01", "-", "15.42"),
    row("15/07/2026", ["POS Purchase BIRDHAUS DIGITAL", "SAL LEB LB 0000"], "14.00", "-", "1.42"),
    row("17/07/2026", ["Transfer from Own Account", "500191330003 - weekend"], "-", "10.00", "11.42"),
    row("18/07/2026", ["Transfer from Own Account", "500191330003 - card"], "-", "5.00", "16.42"),
    row("20/07/2026", ["POS Purchase HAWA CHICKEN", "ZOUK MIKA ZOUK MIKHAEL LB 0000"], "7.00", "-", "9.42"),
    row("20/07/2026", ["POS Purchase LE CHARCUTIER", "AOUN-SAR ASARBA LB 0000"], "5.00", "-", "4.42"),
    row("23/07/2026", ["Transfer from Own Account", "500191330003 - card"], "-", "6.08", "10.50"),
    row("25/07/2026", ["Transfer from Own Account", "500191330004 - to Current Account"], "-", "10.00", "20.50"),
    row("27/07/2026", ["Transfer from Own Account", "500191330003 - Current Account"], "-", "300.00", "320.50"),
    row("28/07/2026", ["POS Purchase MACHAWE EL", "KARAM BAABDA LB 0000"], "16.07", "-", "304.43"),
    row("29/07/2026", ["POS Purchase CHARCUTIER AOUN-", "ADONIS ADONIS LB 0000"], "15.23", "-", "289.20"),
  ];
  page = 2;
  const page3Rows: PositionedTextItem[][] = [
    row("31/07/2026", ["POS Purchase TOTAL NACCACHE", "NACCACHE LB 0000"], "70.00", "-", "219.20"),
    row("31/07/2026", ["Closing Balance"], undefined, undefined, "219.20"),
  ];
  return [...header, ...rows.flat(), ...page3Rows.flat()];
}

describe("parseStatementRows", () => {
  it("merges a wrapped two-line description into one row", () => {
    const rows = parseStatementRows(buildFixture());
    const moulin = rows.find((r) => r.date === "2026-07-07" && r.description.includes("MOULIN"));
    expect(moulin?.description).toBe("POS Purchase MOULIN DOR JEITA LB 0000");
    expect(moulin?.moneyOut).toBe(5.95);
  });

  it("parses Opening/Closing Balance rows with no money in/out", () => {
    const rows = parseStatementRows(buildFixture());
    expect(rows[0]).toMatchObject({ date: "2026-07-01", description: "Opening Balance", moneyOut: null, moneyIn: null, balance: 0 });
    const closing = rows[rows.length - 1];
    expect(closing).toMatchObject({ date: "2026-07-31", description: "Closing Balance", balance: 219.2 });
  });

  it("correctly attributes MONEY OUT vs MONEY IN by column position, not order", () => {
    const rows = parseStatementRows(buildFixture());
    const transfer = rows.find((r) => r.description.startsWith("Transfer") && r.date === "2026-07-04");
    expect(transfer?.moneyOut).toBeNull();
    expect(transfer?.moneyIn).toBe(120);
  });
});

describe("parseNeoStatement", () => {
  const result = parseNeoStatement(buildFixture());

  it("imports exactly the real POS purchases, net of the refund pair", () => {
    // 18 POS Purchase rows total in the statement, minus 1 netted against the REV refund = 17.
    expect(result.transactions).toHaveLength(17);
  });

  it("nets the REV refund against a matching earlier purchase instead of importing a negative amount", () => {
    const moulinCharges = result.transactions.filter((t) => t.description.includes("MOULIN DOR JEITA") && t.amount === 5.95);
    expect(moulinCharges).toHaveLength(1); // two $5.95 charges existed; one got reversed
  });

  it("skips every Transfer from Own Account row", () => {
    expect(result.skippedTransferCount).toBe(8);
    expect(result.transactions.some((t) => t.description.startsWith("Transfer"))).toBe(false);
  });

  it("excludes Opening/Closing Balance rows from the transaction list", () => {
    expect(result.transactions.some((t) => /balance/i.test(t.description))).toBe(false);
    expect(result.openingBalance).toBe(0);
    expect(result.closingBalance).toBe(219.2);
  });

  it("has no unmatched refunds in this statement (the one REV row matches a purchase within it)", () => {
    expect(result.unmatchedRefunds).toHaveLength(0);
  });

  it("preserves the original (non-normalized) description for display", () => {
    const spinneys = result.transactions.find((t) => t.description.includes("SPINNEYS"));
    expect(spinneys?.description).toBe("POS Purchase SPINNEYS ZOUK ZOUK MOSBEH LB 0000");
  });
});

describe("parseNeoStatement — unmatched refund", () => {
  it("flags a REV row as unmatched when no matching purchase exists in this statement", () => {
    const items = [
      it_("DATE", X.DATE), it_("TRANSACTIONS", X.DESC), it_("MONEY OUT", X.OUT), it_("MONEY IN", X.IN), it_("BALANCE", X.BAL),
      ...row("05/07/2026", ["REV POS Purchase SOME MERCHANT"], "-", "12.00", "12.00"),
    ];
    const result = parseNeoStatement(items);
    expect(result.transactions).toHaveLength(0);
    expect(result.unmatchedRefunds).toHaveLength(1);
    expect(result.unmatchedRefunds[0].amount).toBe(12);
  });
});

describe("parseStatementRows — DATE-column fallback", () => {
  it("merges a stray non-date item landing in the DATE column's x-range into the description instead of dropping it", () => {
    const items = [
      it_("DATE", X.DATE), it_("TRANSACTIONS", X.DESC), it_("MONEY OUT", X.OUT), it_("MONEY IN", X.IN), it_("BALANCE", X.BAL),
      it_("05/07/2026", X.DATE),
      it_("POS Purchase FOO", X.DESC),
      it_("bar", X.DATE), // not a real date — should fall through as description text, not vanish
      it_("10.00", X.OUT),
      it_("-", X.IN),
      it_("50.00", X.BAL),
    ];
    const rows = parseStatementRows(items);
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe("POS Purchase FOO bar");
    expect(rows[0].moneyOut).toBe(10);
  });
});

describe("parseNeoStatement — unparsed amount tracking", () => {
  it("counts a malformed money-column cell instead of silently dropping the row with no signal", () => {
    const items = [
      it_("DATE", X.DATE), it_("TRANSACTIONS", X.DESC), it_("MONEY OUT", X.OUT), it_("MONEY IN", X.IN), it_("BALANCE", X.BAL),
      ...row("05/07/2026", ["POS Purchase WEIRD FORMAT"], "10", "-", "50.00"), // "10" has no decimals — doesn't match NUMBER_RE
    ];
    const result = parseNeoStatement(items);
    expect(result.transactions).toHaveLength(0); // moneyOut never got set, so this row isn't a purchase
    expect(result.unparsedAmountCount).toBe(1);
  });

  it("does not count a blank/dash cell as an unparsed amount — that's a legitimate absence, not a failure", () => {
    const items = buildFixture();
    const result = parseNeoStatement(items);
    expect(result.unparsedAmountCount).toBe(0);
  });

  it("reports noRowsFound when the file has no header/table at all (wrong file)", () => {
    const result = parseNeoStatement([it_("Not a statement", 10)]);
    expect(result.noRowsFound).toBe(true);
    expect(result.transactions).toHaveLength(0);
  });

  it("does not report noRowsFound for a real statement with zero purchases (valid, just nothing to import)", () => {
    const items = [
      it_("DATE", X.DATE), it_("TRANSACTIONS", X.DESC), it_("MONEY OUT", X.OUT), it_("MONEY IN", X.IN), it_("BALANCE", X.BAL),
      ...row("01/07/2026", ["Opening Balance"], undefined, undefined, "0.00"),
      ...row("31/07/2026", ["Closing Balance"], undefined, undefined, "0.00"),
    ];
    const result = parseNeoStatement(items);
    expect(result.noRowsFound).toBe(false);
    expect(result.transactions).toHaveLength(0);
  });
});

describe("normalizeDescription", () => {
  it("collapses whitespace/punctuation and case for matching purposes", () => {
    expect(normalizeDescription("  Moulin  Dor -- Jeita  ")).toBe("MOULIN DOR JEITA");
  });

  it("is stable for repeated calls with already-normalized input", () => {
    expect(normalizeDescription("MOULIN DOR JEITA")).toBe("MOULIN DOR JEITA");
  });
});

describe("guessAccountLast4", () => {
  it("extracts the last 4 digits of an IBAN found anywhere in the extracted text", () => {
    const items = [it_("IBAN:LB63005699840103500191330005", 10)];
    expect(guessAccountLast4(items)).toBe("0005");
  });

  it("returns null when no IBAN-shaped text is present", () => {
    expect(guessAccountLast4([it_("Statement Date: 01/08/2026", 10)])).toBeNull();
  });
});

// Both cases below were found by running the parser against a REAL Neo by
// Bank Audi PDF, not invented — pdfjs-dist's raw text-extraction order does
// not always match visual reading order, and this parser has to sort by
// (page, y, x) rather than trust extraction order to handle them.
describe("parseStatementRows — real-world extraction-order quirks", () => {
  it("still assembles a row correctly when its description text item is emitted before its date item at the same y", () => {
    // Observed in the real PDF: a REV (refund) row's "REV POS Purchase X"
    // text and its "date" text shared the exact same y, but the date item
    // came SECOND in pdfjs-dist's raw extraction order — naive
    // extraction-order processing glued the description onto the PRECEDING
    // row instead of starting a new one.
    const sameY = 500;
    const items: PositionedTextItem[] = [
      { text: "DATE", x: X.DATE, y: 999, page: 1 },
      { text: "TRANSACTIONS", x: X.DESC, y: 999, page: 1 },
      { text: "MONEY OUT", x: X.OUT, y: 999, page: 1 },
      { text: "MONEY IN", x: X.IN, y: 999, page: 1 },
      { text: "BALANCE", x: X.BAL, y: 999, page: 1 },
      // Description arrives BEFORE the date in raw order, both at sameY:
      { text: "REV POS Purchase MOULIN DOR", x: X.DESC, y: sameY, page: 1 },
      { text: "08/07/2026", x: X.DATE, y: sameY, page: 1 },
      { text: "-", x: X.OUT, y: sameY, page: 1 },
      { text: "5.95", x: X.IN, y: sameY, page: 1 },
      { text: "46.78", x: X.BAL, y: sameY, page: 1 },
    ];
    const rows = parseStatementRows(items);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "2026-07-08", description: "REV POS Purchase MOULIN DOR", moneyIn: 5.95, balance: 46.78 });
  });

  it("ignores a later page's footer/boilerplate block even when it's extracted before that page's real transaction rows", () => {
    // Observed in the real PDF: page 3's verification/QR-code footer text
    // was emitted BEFORE that page's actual "31/07/2026 ... Closing
    // Balance" rows despite rendering visually below them, so naive
    // extraction-order processing appended the footer onto the LAST row
    // from the previous page (corrupting a real purchase's description).
    // Built with fully explicit page/y/x (not the shared-counter `row()`
    // helper) so this test is self-contained regardless of execution order.
    const items: PositionedTextItem[] = [
      { text: "DATE", x: X.DATE, y: 999, page: 1 },
      { text: "TRANSACTIONS", x: X.DESC, y: 999, page: 1 },
      { text: "MONEY OUT", x: X.OUT, y: 999, page: 1 },
      { text: "MONEY IN", x: X.IN, y: 999, page: 1 },
      { text: "BALANCE", x: X.BAL, y: 999, page: 1 },
      { text: "29/07/2026", x: X.DATE, y: 500, page: 1 },
      { text: "POS Purchase CHARCUTIER AOUN-", x: X.DESC, y: 500, page: 1 },
      { text: "ADONIS ADONIS LB 0000", x: X.DESC, y: 490, page: 1 },
      { text: "15.23", x: X.OUT, y: 500, page: 1 },
      { text: "-", x: X.IN, y: 500, page: 1 },
      { text: "289.20", x: X.BAL, y: 500, page: 1 },
      // Page 3: footer text extracted FIRST in the array (low y, but emitted before the real row below)...
      { text: "For Verifications", x: 123, y: 661, page: 3 },
      { text: "This Tamperproof is digitally signed.", x: 123, y: 618, page: 3 },
      { text: "Bank Audi Plaza, Omar Daouk Street, Bab Idriss.", x: 165, y: 573, page: 3 },
      // ...then the real transaction rows, at a HIGHER y (visually above the footer):
      { text: "31/07/2026", x: X.DATE, y: 786, page: 3 },
      { text: "POS Purchase TOTAL NACCACHE", x: X.DESC, y: 786, page: 3 },
      { text: "NACCACHE LB 0000", x: X.DESC, y: 772, page: 3 },
      { text: "70.00", x: X.OUT, y: 786, page: 3 },
      { text: "-", x: X.IN, y: 786, page: 3 },
      { text: "219.20", x: X.BAL, y: 786, page: 3 },
      { text: "31/07/2026", x: X.DATE, y: 740, page: 3 },
      { text: "Closing Balance", x: X.DESC, y: 740, page: 3 },
      { text: "219.20", x: X.BAL, y: 740, page: 3 },
    ];
    const rows = parseStatementRows(items);
    const charcutier = rows.find((r) => r.description.includes("CHARCUTIER"));
    const naccache = rows.find((r) => r.description.includes("NACCACHE") && r.date === "2026-07-31");
    const closing = rows.find((r) => /closing balance/i.test(r.description));
    expect(charcutier?.description).toBe("POS Purchase CHARCUTIER AOUN- ADONIS ADONIS LB 0000");
    expect(naccache?.description).toBe("POS Purchase TOTAL NACCACHE NACCACHE LB 0000");
    expect(closing?.description.trim().toLowerCase()).toBe("closing balance"); // must exactly match, not "closing balance <footer text>"
  });
});
