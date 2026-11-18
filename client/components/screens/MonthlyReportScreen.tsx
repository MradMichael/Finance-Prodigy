"use client";

// F4 (ROADMAP Phase 5; owner, session 56: built per session 55's plan, item 9; held for the owner's look): one
// period's report, the account's own cycle, under More. Figures and sentences come from lib/monthlyReport.ts;
// the image from lib/reportImage.ts, drawn only after the confirmation's "Share". Built only when this screen is
// open (a lazy screen), so its cost is nobody's until then.
import { useMemo, useRef, useState } from "react";
import type { LocalFinancials } from "../../lib/localData";
import { cycleStartDayOf } from "../../lib/localData";
import { cycleLabelLong, type CycleKey } from "../../lib/period";
import { buildMonthlyReport, reportPeriods, changeSentence, goalSentence, REPORT_TEXT, type ReportLine } from "../../lib/monthlyReport";
import { shareReport } from "../../lib/reportImage";
import { useTheme } from "../../contexts/ThemeContext";
import { useDialogFocus } from "../useDialogFocus";
import { SERIF, NUMS, fmtCur } from "./shared";

export default function MonthlyReportScreen({ financials }: { financials: LocalFinancials }) {
  const T = useTheme();
  const [now] = useState(() => new Date());
  const startDay = cycleStartDayOf(financials);
  const periods = useMemo(() => reportPeriods(financials, now), [financials, now]);
  const [picked, setPicked] = useState<CycleKey | null>(null);
  const key = picked && periods.includes(picked) ? picked : periods[0];
  const report = useMemo(() => buildMonthlyReport(financials, key, now), [financials, key, now]);
  const [confirming, setConfirming] = useState(false);
  const [sharing, setSharing] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, confirming, () => setConfirming(false));

  async function share() {
    setConfirming(false);
    setSharing(true);
    try {
      await shareReport(report, { background: T.ink, text: T.text, mute: T.mute, accent: T.jade, line: T.line });
    } catch {
      // Nothing was sent anywhere; the image just wasn't made (no canvas). The button stays for another try.
    } finally {
      setSharing(false);
    }
  }

  const card = "rounded-2xl p-5";
  const cardStyle = { background: T.panel, border: `1px solid ${T.line}` };
  const Lines = ({ lines }: { lines: ReportLine[] }) => (
    <ul className="mt-3 space-y-1.5">
      {lines.map((l) => (
        <li key={l.label} className="flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 truncate" style={{ color: T.text }}>{l.label}</span>
          <span className="flex-shrink-0" style={{ ...NUMS, color: T.text }}>{fmtCur(l.usd, "USD")}</span>
        </li>
      ))}
    </ul>
  );
  const Heading = ({ children, total }: { children: string; total?: number }) => (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-xs uppercase tracking-widest font-semibold" style={{ color: T.jade }}>{children}</h2>
      {total !== undefined && <span className="text-sm font-semibold flex-shrink-0" style={{ ...NUMS, color: T.text }}>{fmtCur(total, "USD")}</span>}
    </div>
  );

  return (
    <main className="min-h-screen px-4 py-8 md:px-10" style={{ background: T.ink }}>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: T.mute }}>ESSA</p>
          <h1 className="text-3xl mt-1" style={SERIF}>{REPORT_TEXT.title}</h1>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <label htmlFor="report-period" className="block text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: T.mute }}>{REPORT_TEXT.picker}</label>
            <select
              id="report-period"
              value={key}
              onChange={(e) => setPicked(e.target.value as CycleKey)}
              className="rounded-xl px-3 py-2 text-sm"
              style={{ background: T.panel, border: `1px solid ${T.line}`, color: T.text, colorScheme: "dark" }}
            >
              {periods.map((k) => <option key={k} value={k}>{cycleLabelLong(k, startDay)}</option>)}
            </select>
          </div>
          {!report.empty && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={sharing}
              className="px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40"
              style={{ background: T.jade, color: T.ink }}
            >
              {REPORT_TEXT.share}
            </button>
          )}
        </div>

        {report.empty ? (
          <p className="text-sm" style={{ color: T.mute }}>{REPORT_TEXT.empty(report.noun)}</p>
        ) : (
          <>
            <section className={card} style={cardStyle}><Heading total={report.moneyIn.total}>{REPORT_TEXT.moneyIn}</Heading><Lines lines={report.moneyIn.lines} /></section>
            <section className={card} style={cardStyle}><Heading total={report.bills.total}>{REPORT_TEXT.bills}</Heading><Lines lines={report.bills.lines} /></section>
            <section className={card} style={cardStyle}><Heading total={report.whereItWent.total}>{REPORT_TEXT.whereItWent}</Heading><Lines lines={report.whereItWent.lines} /></section>
            <section className={card} style={cardStyle}><Heading>{REPORT_TEXT.saved}</Heading><Lines lines={report.saved.lines} /></section>
            {report.goals.length > 0 && (
              <section className={card} style={cardStyle}>
                <Heading>{REPORT_TEXT.goals}</Heading>
                <ul className="mt-3 space-y-1.5">
                  {report.goals.map((g) => <li key={g.name} className="text-sm" style={{ ...NUMS, color: T.text }}>{goalSentence(g, report.noun)}</li>)}
                </ul>
              </section>
            )}
            <section className={card} style={cardStyle}>
              <Heading>{REPORT_TEXT.compared(report.previousLabel)}</Heading>
              <ul className="mt-3 space-y-1.5">
                {report.first ? <li className="text-sm" style={{ color: T.mute }}>{REPORT_TEXT.first(report.noun)}</li>
                  : report.changes.length === 0 ? <li className="text-sm" style={{ color: T.mute }}>{REPORT_TEXT.noChanges(report.previousLabel)}</li>
                  : report.changes.map((c) => <li key={c.name} className="text-sm" style={{ ...NUMS, color: T.text }}>{changeSentence(c, report.previousLabel)}</li>)}
              </ul>
            </section>
          </>
        )}
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }} onClick={() => setConfirming(false)}>
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={REPORT_TEXT.share}
            aria-describedby="report-share-text"
            className="w-full max-w-sm rounded-2xl p-6 shadow-2xl"
            style={{ background: T.panel, border: `1px solid ${T.line}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <p id="report-share-text" className="text-sm mb-5" style={{ color: T.text }}>{REPORT_TEXT.confirm(report.noun)}</p>
            <div className="flex gap-2">
              <button type="button" onClick={share} className="flex-1 px-3 py-2 rounded-xl text-sm font-semibold hover:opacity-90" style={{ background: T.jade, color: T.ink }}>{REPORT_TEXT.confirmShare}</button>
              <button type="button" onClick={() => setConfirming(false)} className="px-3 py-2 rounded-xl text-sm hover:opacity-70" style={{ color: T.mute }}>{REPORT_TEXT.confirmCancel}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
