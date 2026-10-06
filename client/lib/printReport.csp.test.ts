// FB-1c (SEC-03): the print report carries its own strict policy.
//
// The report opens as an about:blank tab the app writes into, so it inherits
// the app's policy, and that policy allows inline scripts ('unsafe-inline').
// SEC-02's vector ran in exactly this tab. The report needs no script, image
// or web font (one <style> block, Georgia), so its own <meta> policy allows
// none. In this tab no script runs, injected or not, whatever the app's policy
// allows. It's placed before any content, so it applies to all of it.
import { describe, it, expect } from "vitest";
import { buildReportHtml, REPORT_CSP } from "./printReport";
import { computeDashboard } from "./computeDashboard";
import { DEFAULT_DATA, migrateFinancials, type LocalFinancials } from "./localData";

function report(userName = "Quartz Runner") {
  const data = migrateFinancials({ ...DEFAULT_DATA, income: 2400 } as LocalFinancials);
  return buildReportHtml(userName, data, computeDashboard(data), { detailed: true });
}

describe("the report's own content policy", () => {
  it("is exactly: nothing by default, inline styles only", () => {
    expect(REPORT_CSP).toBe("default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
  });

  it("is in the head, before the title and anything else carrying data", () => {
    const html = report("<i>Quartz</i>");
    const meta = `<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}" />`;
    const at = html.indexOf(meta);
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(html.indexOf("<title>"));
    expect(at).toBeLessThan(html.indexOf("<style>"));
    expect(at).toBeGreaterThan(html.indexOf("<head>"));
  });

  it("the report itself needs nothing it blocks: no script, image, link or web font", () => {
    const html = report();
    expect(html).not.toMatch(/<script|<img|<link|@import|url\(|@font-face/i);
  });
});
