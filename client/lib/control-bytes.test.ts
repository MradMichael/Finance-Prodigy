// 2.4.125's fence: no raw control bytes in source, tests, or the docs.
//
// A habit was tried and failed three times in one session -- twice inside
// the comment written to explain the first failure. Per 2.4.123: a fence
// fails closed and leaves evidence; a habit fails open and leaves bytes.
//
// WHAT IS CHECKED, AND WHY IT IS NOT JUST 0x08. The byte that actually
// landed was 0x08, written as `\b` through a replacement string that
// interpreted the escape instead of emitting two characters. The SAME
// mechanism produces 0x07 (`\a`), 0x0B (`\v`), 0x0C (`\f`), 0x1B (`\e`) and
// 0x00 (`\0`) from the identical mistake, so a fence scoped to 0x08 alone
// would fail open for its own siblings. Every C0 control byte is rejected
// except tab, LF and CR, plus DEL (0x7F). Measured before choosing the net:
// zero violations across 115 files today, so this encodes no pre-existing
// state.
//
// HOW IT CHECKS, which is the whole point. Bytes are counted in BINARY.
// 2.4.100's stated mitigation was `cat -v file | grep '^H'`, and that check
// is WRONG: `cat -v` renders many multi-byte UTF-8 characters as `M-x`
// sequences, and U+2212 MINUS SIGN comes out as `M-bM-^HM-^R`, which
// contains the literal two-character substring `^H`. Run against the audit
// it reported six hits where the true count is zero -- every one a minus
// sign. `cat -v` is how you LOOK AT a suspect line; it is not how you
// SEARCH for one.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, relative, resolve } from "node:path";

/** Repo root: vitest runs with cwd = client/. */
const ROOT = resolve(process.cwd(), "..");
const CLIENT = join(ROOT, "client");

const SKIP_DIRS = new Set([
  "node_modules", ".next", ".git", "coverage", "dist", "build", ".vercel",
  // Vendored, minified third-party bundle (pdf.worker.min.mjs). It legitimately
  // contains control bytes, nobody hand-edits it, and including it would make
  // the fence permanently red for something it is not about. Named rather than
  // globbed away, so the exclusion is a decision on the record.
  "public",
]);
const EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".json", ".md"]);

/**
 * Docs at the repo root. AUDIT / OPEN_ITEMS / PERIOD_CLOSE_PLAN are
 * deliberately never committed, so they are absent in CI and on any fresh
 * clone. Absence must not fail the suite -- but it must not pass silently
 * either, which is what the coverage test below is for.
 */
const DOCS = [
  "docs/AUDIT_2026-08.md",
  "docs/OPEN_ITEMS_2026-09-03.md",
  "docs/PERIOD_CLOSE_PLAN.md",
  "docs/ROADMAP.md",
  "docs/CLAUDE_CODE_BRIEF.md",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXTS.has(extname(name))) out.push(p);
  }
  return out;
}

const NAMES: Record<number, string> = {
  0x00: "NUL (\\0)", 0x07: "BEL (\\a)", 0x08: "BACKSPACE (\\b)",
  0x0b: "VTAB (\\v)", 0x0c: "FORMFEED (\\f)", 0x1b: "ESC (\\e)", 0x7f: "DEL",
};

/** Every offending byte in one file, with enough context to fix it. */
function offenders(buf: Buffer): { byte: number; line: number; col: number; name: string }[] {
  const out: { byte: number; line: number; col: number; name: string }[] = [];
  let line = 1, col = 1;
  for (const b of buf) {
    if (b === 0x0a) { line++; col = 1; continue; }
    if (b < 0x20 ? b !== 0x09 && b !== 0x0d : b === 0x7f) {
      out.push({ byte: b, line, col, name: NAMES[b] ?? `0x${b.toString(16).padStart(2, "0")}` });
    }
    col++;
  }
  return out;
}

function scan(files: string[]): string[] {
  const report: string[] = [];
  for (const f of files) {
    for (const o of offenders(readFileSync(f))) {
      report.push(`${relative(ROOT, f)}:${o.line}:${o.col} — ${o.name} (0x${o.byte.toString(16).padStart(2, "0")})`);
    }
  }
  return report;
}

const CLIENT_FILES = walk(CLIENT);
const PRESENT_DOCS = DOCS.map((d) => join(ROOT, d.replace(/\//g, "/"))).filter((p) => existsSync(p));

describe("no raw control bytes — the fence (2.4.125)", () => {
  it("client source and tests are clean", () => {
    // Premise: the walk found a realistic number of files. A scan that
    // silently walked nothing would report zero violations and read as a
    // pass -- the vacuous-fence failure, 2.4.97's family.
    expect(CLIENT_FILES.length).toBeGreaterThan(80);
    expect(scan(CLIENT_FILES)).toEqual([]);
  });

  it("the docs present on this machine are clean", () => {
    expect(scan(PRESENT_DOCS)).toEqual([]);
  });
});

describe("the fence itself, so a green result means something", () => {
  it("detects a planted 0x08 — the byte that actually landed, three times", () => {
    // String.fromCharCode(8), not a \b escape. Writing the escape here is
    // exactly the keystroke that produced the bug -- and it produced it a
    // FOURTH time while this very test was being written, through the file-
    // writing tool rather than a script. A test for a trap must not be built
    // out of the trap.
    const BS = String.fromCharCode(8);
    const planted = Buffer.from(`expect(x).toMatch(/[$]10${BS}/);`, "utf8");
    const found = offenders(planted);
    expect(found).toHaveLength(1);
    expect(found[0].byte).toBe(0x08);
    expect(found[0].line).toBe(1);
  });

  it("detects the siblings the same mistake produces", () => {
    for (const b of [0x00, 0x07, 0x0b, 0x0c, 0x1b, 0x7f]) {
      expect(offenders(Buffer.from([0x61, b, 0x62]))).toHaveLength(1);
    }
  });

  it("does NOT reject tab, LF or CR — every file here has them", () => {
    // Without this the fence would be red on every file in the repo, which
    // is a different way of being useless.
    expect(offenders(Buffer.from("a\tb\r\nc\n", "utf8"))).toEqual([]);
  });

  it("does NOT reject the character that fooled cat -v", () => {
    // U+2212 MINUS SIGN: the source of 2.4.100's mitigation reporting six
    // phantom hits in a file whose true count is zero. Its UTF-8 bytes are
    // e2 88 92 -- none of them a control byte. Pinned so nobody 'fixes' the
    // detector back into rendering-space.
    const minus = Buffer.from("−", "utf8");
    expect([...minus]).toEqual([0xe2, 0x88, 0x92]);
    expect(offenders(minus)).toEqual([]);
  });
});

describe("coverage — an absent file must not read as a clean one", () => {
  it("reports which docs were scanned and which were absent", () => {
    // The three working docs are never committed, so a CI run legitimately
    // scans only ROADMAP and CLAUDE_CODE_BRIEF. That is fine. What is not
    // fine is a silent skip, so the list is asserted rather than assumed:
    // the two TRACKED docs must always be present, anywhere this runs.
    const scanned = PRESENT_DOCS.map((p) => relative(ROOT, p).replace(/\\/g, "/"));
    expect(scanned).toContain("docs/ROADMAP.md");
    expect(scanned).toContain("docs/CLAUDE_CODE_BRIEF.md");
    // The untracked three are checked when they exist and named when they
    // do not, so the gap is visible in the test name rather than invisible
    // in a pass.
    const absent = DOCS.filter((d) => !existsSync(join(ROOT, d)));
    if (absent.length) {
      // eslint-disable-next-line no-console
      console.info(`control-byte fence: not present on this machine, not scanned — ${absent.join(", ")}`);
    }
  });
});
