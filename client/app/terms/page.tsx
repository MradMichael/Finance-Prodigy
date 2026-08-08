"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTheme } from "../../contexts/ThemeContext";

const SERIF: React.CSSProperties = { fontFamily: "Spectral, Georgia, serif" };
const LAST_UPDATED = "6 July 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const T = useTheme();
  return (
    <section>
      <h2 className="text-base font-semibold mb-3" style={{ ...SERIF, color: T.text }}>{title}</h2>
      <div className="text-sm leading-relaxed space-y-3" style={{ color: T.mute }}>{children}</div>
    </section>
  );
}

export default function TermsPage() {
  const router = useRouter();
  const T = useTheme();

  return (
    <div className="min-h-screen" style={{ background: T.ink }}>
      <header
        className="flex items-center gap-3 px-6 py-3 sticky top-0 z-10"
        style={{ background: T.panel, borderBottom: `1px solid ${T.line}` }}
      >
        <button onClick={() => router.back()} className="text-sm px-3 py-1.5 rounded-lg transition-opacity hover:opacity-70" style={{ color: T.mute }}>
          ← Back
        </button>
        <span className="text-sm font-medium" style={{ color: T.text }}>Terms of Service</span>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
        <div
          className="rounded-xl p-4 text-xs leading-relaxed"
          style={{ background: T.brass + "12", border: `1px solid ${T.brass}30`, color: T.brass }}
        >
          Draft terms written to describe ESSA&apos;s actual behavior as of {LAST_UPDATED}, including a placeholder
          governing-law jurisdiction below. Have this reviewed by a lawyer familiar with your jurisdiction before
          relying on it for a public launch. This is not legal advice.
        </div>

        <div>
          <h1 className="text-2xl" style={{ ...SERIF, color: T.text }}>Terms of Service</h1>
          <p className="text-xs mt-1" style={{ color: T.mute }}>Last updated: {LAST_UPDATED}</p>
        </div>

        <Section title="Acceptance">
          <p>By creating an account, you agree to these terms and to the <Link href="/privacy" style={{ color: T.jade }}>Privacy Policy</Link>. If you don&apos;t agree, don&apos;t use ESSA.</p>
        </Section>

        <Section title="What ESSA is">
          <p>ESSA is a personal budgeting and financial-tracking tool. Your financial data is stored encrypted in your own browser; an optional sync feature backs it up to our database if you turn it on.</p>
        </Section>

        <Section title="Eligibility">
          <p>You must be at least 16 years old to create an account.</p>
        </Section>

        <Section title="Not financial advice">
          <p>
            ESSA shows you a health score, budget-pace warnings, debt payoff projections, and other suggestions
            based on the numbers you enter. <strong style={{ color: T.text }}>None of this is professional
            financial, tax, or legal advice</strong>: it&apos;s informational, based on simple rules and the data
            you&apos;ve provided, and it can be wrong (a projection is only as good as the numbers behind it).
            Make your own financial decisions, and talk to a licensed professional for anything that actually
            matters to your finances.
          </p>
        </Section>

        <Section title="Your account and recovery code">
          <p>You&apos;re responsible for keeping your password and your recovery code safe. There is no email-based password reset. If you lose both, your data cannot be recovered by us or anyone else. See the <Link href="/privacy" style={{ color: T.jade }}>Privacy Policy</Link> for how the encryption behind this works.</p>
        </Section>

        <Section title="Acceptable use">
          <ul className="list-disc pl-5 space-y-1">
            <li>Don&apos;t try to access another account or bypass authentication.</li>
            <li>Don&apos;t abuse, flood, or attempt to overwhelm the service (including its API).</li>
            <li>Don&apos;t use ESSA for anything illegal.</li>
          </ul>
        </Section>

        <Section title="Service availability">
          <p>ESSA is provided &quot;as is,&quot; without warranty of any kind. We don&apos;t guarantee uninterrupted availability, and we may change or discontinue features at any time.</p>
        </Section>

        <Section title="Limitation of liability">
          <p>
            To the fullest extent permitted by law, ESSA and its operator aren&apos;t liable for any indirect,
            incidental, or consequential damages arising from your use of the service, including financial
            decisions made based on information it shows you.
          </p>
        </Section>

        <Section title="Termination">
          <p>You can delete your account at any time from Profile → Danger zone. We may suspend or terminate accounts that violate these terms.</p>
        </Section>

        <Section title="Changes to these terms">
          <p>If these terms change materially, we&apos;ll update the date at the top of this page.</p>
        </Section>

        <Section title="Governing law">
          <p>[Placeholder: specify the jurisdiction whose laws govern these terms before public launch.]</p>
        </Section>

        <Section title="Contact">
          <p>Questions about these terms: <a href="mailto:mmrad1998@gmail.com" style={{ color: T.jade }}>mmrad1998@gmail.com</a></p>
        </Section>
      </div>
    </div>
  );
}
