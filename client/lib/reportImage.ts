// F4 (owner, session 56; held): the monthly report as an image to share, made on this device with the page's own
// canvas (no library, nothing sent anywhere). The screen asks first (REPORT_TEXT.confirm); only its "Share" calls
// shareReport. The image carries the same lines as the screen, from the same report and sentence builders, and
// ends with the approved footer. 1080 px wide; as tall as its lines.
import { REPORT_TEXT, changeSentence, goalSentence, type MonthlyReport, type ReportSection } from "./monthlyReport";
import { fmtCur } from "../components/screens/shared";

export interface ImageLine { text: string; right?: string; kind: "title" | "period" | "heading" | "note" | "line" | "sentence" | "footer" }
export interface ImageColors { background: string; text: string; mute: string; accent: string; line: string }

const usd = (n: number) => fmtCur(n, "USD");

/** Every line of the image, top to bottom. */
export function reportImageLines(r: MonthlyReport): ImageLine[] {
  const out: ImageLine[] = [{ text: REPORT_TEXT.title, kind: "title" }, { text: r.longLabel, kind: "period" }];
  const section = (heading: string, s: ReportSection) => {
    out.push({ text: heading, right: usd(s.total), kind: "heading" });
    for (const l of s.lines) out.push({ text: l.label, right: usd(l.usd), kind: "line" });
  };
  section(REPORT_TEXT.moneyIn, r.moneyIn);
  // Session 69, step D: right after Money in, only when it has lines; no total.
  if (r.paidBackAndBorrowed.lines.length) {
    out.push({ text: REPORT_TEXT.paidBackAndBorrowed, kind: "heading" }, { text: REPORT_TEXT.notCounted, kind: "note" });
    for (const l of r.paidBackAndBorrowed.lines) out.push({ text: l.label, right: usd(l.usd), kind: "line" });
  }
  section(REPORT_TEXT.bills, r.bills);
  section(REPORT_TEXT.whereItWent, r.whereItWent);
  out.push({ text: REPORT_TEXT.saved, kind: "heading" });
  for (const l of r.saved.lines) out.push({ text: l.label, right: usd(l.usd), kind: "line" });
  if (r.goals.length) {
    out.push({ text: REPORT_TEXT.goals, kind: "heading" });
    for (const g of r.goals) out.push({ text: goalSentence(g, r.noun), kind: "sentence" });
  }
  out.push({ text: REPORT_TEXT.compared(r.previousLabel), kind: "heading" });
  if (r.first) out.push({ text: REPORT_TEXT.first(r.noun), kind: "sentence" });
  else if (!r.changes.length) out.push({ text: REPORT_TEXT.noChanges(r.previousLabel), kind: "sentence" });
  else for (const c of r.changes) out.push({ text: changeSentence(c, r.previousLabel), kind: "sentence" });
  out.push({ text: REPORT_TEXT.footer, kind: "footer" });
  return out;
}

const WIDTH = 1080, PAD = 72;
const STYLE: Record<ImageLine["kind"], { font: string; height: number; gapBefore: number }> = {
  title: { font: "600 60px Spectral, Georgia, serif", height: 72, gapBefore: 0 },
  period: { font: "32px system-ui, sans-serif", height: 44, gapBefore: 4 },
  heading: { font: "600 32px system-ui, sans-serif", height: 44, gapBefore: 36 },
  note: { font: "26px system-ui, sans-serif", height: 36, gapBefore: 2 },
  line: { font: "30px system-ui, sans-serif", height: 42, gapBefore: 0 },
  sentence: { font: "30px system-ui, sans-serif", height: 42, gapBefore: 4 },
  footer: { font: "26px system-ui, sans-serif", height: 36, gapBefore: 48 },
};

/** A sentence broken into lines that fit the image's width. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && ctx.measureText(next).width > width) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Draws the report on a new canvas. Called only after the person has said "Share". */
export function drawReport(r: MonthlyReport, colors: ImageColors): HTMLCanvasElement {
  const lines = reportImageLines(r);
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = 4000; // measured first, then set (setting the size clears the canvas)
  let ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas");
  const inner = WIDTH - PAD * 2;
  const laidOut: { line: ImageLine; rows: string[]; y: number }[] = [];
  let y = PAD;
  for (const line of lines) {
    const st = STYLE[line.kind];
    ctx.font = st.font;
    y += st.gapBefore;
    const rows = line.right ? [line.text] : wrap(ctx, line.text, inner);
    laidOut.push({ line, rows, y });
    y += st.height * rows.length;
  }
  canvas.height = Math.ceil(y + PAD);
  ctx = canvas.getContext("2d")!;
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, WIDTH, canvas.height);
  ctx.textBaseline = "top";
  for (const { line, rows, y: top } of laidOut) {
    const st = STYLE[line.kind];
    ctx.font = st.font;
    ctx.fillStyle = line.kind === "heading" ? colors.accent : line.kind === "period" || line.kind === "note" || line.kind === "footer" ? colors.mute : colors.text;
    rows.forEach((row, i) => { ctx!.textAlign = "left"; ctx!.fillText(row, PAD, top + i * st.height); });
    if (line.right) { ctx.textAlign = "right"; ctx.fillText(line.right, WIDTH - PAD, top); }
  }
  return canvas;
}

/** The file name the image is shared or saved under. */
export const reportFileName = (r: MonthlyReport) => `essa-report-${r.key}.png`;

/**
 * Draws the image and hands it to the phone's share sheet; where there is none (or it refuses files), downloads it.
 * "cancelled" when the person closed the share sheet. Nothing is sent to any server.
 */
export async function shareReport(r: MonthlyReport, colors: ImageColors): Promise<"shared" | "downloaded" | "cancelled"> {
  const canvas = drawReport(r, colors);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/png"));
  const file = new File([blob], reportFileName(r), { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share === "function" && (!nav.canShare || nav.canShare({ files: [file] }))) {
    try {
      await nav.share({ files: [file] });
      return "shared";
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return "cancelled";
      // Refused (no user gesture left, or files not allowed): fall through to the download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = reportFileName(r);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
