"use client";

import { useRouter } from "next/navigation";
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

export default function PrivacyPage() {
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
        <span className="text-sm font-medium" style={{ color: T.text }}>Privacy Policy</span>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
        <div
          className="rounded-xl p-4 text-xs leading-relaxed"
          style={{ background: T.brass + "12", border: `1px solid ${T.brass}30`, color: T.brass }}
        >
          Draft policy written to describe ESSA&apos;s actual behavior as of {LAST_UPDATED}. Have it reviewed by
          a lawyer familiar with your jurisdiction before relying on it for a public launch — this is not legal advice.
        </div>

        <div>
          <h1 className="text-2xl" style={{ ...SERIF, color: T.text }}>Privacy Policy</h1>
          <p className="text-xs mt-1" style={{ color: T.mute }}>Last updated: {LAST_UPDATED}</p>
        </div>

        <Section title="What this covers">
          <p>This policy explains what ESSA collects, how it&apos;s protected, and what happens to it if you delete your account.</p>
        </Section>

        <Section title="What we collect">
          <p><strong style={{ color: T.text }}>Account info:</strong> your name, email address, and a password hash — never your raw password.</p>
          <p><strong style={{ color: T.text }}>Financial data:</strong> transactions, goals, debts, recurring payments, and anything else you enter. This is encrypted (AES-256-GCM) and stored in your own browser&apos;s local storage — it never touches our servers unless you turn on Database sync.</p>
          <p><strong style={{ color: T.text }}>Optional sync backup:</strong> if you use Profile → Push, a copy of your data is sent to our database (currently hosted on Neon/Postgres) so you can restore it on another device. This is opt-in — nothing is uploaded unless you choose to push. <strong style={{ color: T.text }}>Unlike your local browser storage, this server-side copy is not client-side-encrypted</strong> — it&apos;s stored as readable data, because the analytics decomposition described below needs to read actual field values. It&apos;s protected instead by database access controls, TLS in transit, and requiring your password-derived sync token to read it back — a materially different guarantee than the local encryption, and worth knowing plainly rather than assuming it carries over.</p>
        </Section>

        <Section title="How it's protected">
          <p>Your data-encryption key is random and never derived directly from your password. It&apos;s locked two ways — once by your password, once by a one-time recovery code shown at sign-up — so either one unlocks it. This protects the copy in your browser; see the sync-backup note above for what protects the server-side copy instead, if you use it.</p>
          <p><strong style={{ color: T.text }}>There is no email-based password reset.</strong> If you lose both your password and your recovery code, your account&apos;s data cannot be recovered by us or anyone else — that&apos;s a direct consequence of how the encryption works, not a support limitation we can override.</p>
        </Section>

        <Section title="What we don't do">
          <ul className="list-disc pl-5 space-y-1">
            <li>We don&apos;t link to your bank or any third-party financial account.</li>
            <li>We don&apos;t sell or share your data with third parties.</li>
            <li>We don&apos;t run ads or third-party tracking/analytics scripts.</li>
          </ul>
        </Section>

        <Section title="Internal analytics">
          <p>
            When you push data to sync, a decomposed copy is also written into an internal analytics warehouse
            (categorized transactions, dates, accounts) so future features can eventually query trends across your
            own data. This stays on our own database, is not shared externally, and the app itself doesn&apos;t
            currently read it back — it exists for future internal use only.
          </p>
          <p>
            Separately, Profile → Help improve ESSA is an <strong style={{ color: T.text }}>opt-in, off by default</strong> toggle
            that sends anonymous counts for a handful of named product actions (like completing an onboarding step) to
            our own server — no third-party analytics SDK, no identity attached, never your financial data. Turning
            it on or off takes effect immediately.
          </p>
        </Section>

        <Section title="Deleting your data">
          <p>
            Profile → Danger zone → Delete account removes your account and financial data from your browser
            immediately.
          </p>
          <p>
            <strong style={{ color: T.text }}>If you&apos;ve ever used Database sync</strong>, deleting your account
            also removes that backup copy (and anything derived from it) from our server automatically, on a
            best-effort basis. If you&apos;re offline at the moment you delete, or the server is unreachable, that
            part won&apos;t complete — email us and we&apos;ll remove it by hand.
          </p>
        </Section>

        <Section title="Taking your data with you">
          <p>
            Profile → Download my data exports everything — transactions, goals, debts, recurring payments,
            settings — as a JSON file, anytime, with no restriction. Yours to keep, move elsewhere, or back up by hand.
          </p>
        </Section>

        <Section title="Children's privacy">
          <p>ESSA isn&apos;t intended for anyone under 16. We don&apos;t knowingly collect data from children.</p>
        </Section>

        <Section title="Changes to this policy">
          <p>If this policy changes materially, we&apos;ll update the date at the top of this page.</p>
        </Section>

        <Section title="Contact">
          <p>Questions about this policy or a data-deletion request: <a href="mailto:mmrad1998@gmail.com" style={{ color: T.jade }}>mmrad1998@gmail.com</a></p>
        </Section>
      </div>
    </div>
  );
}
