"use client";

import { useRouter } from "next/navigation";
import { useTheme } from "../../contexts/ThemeContext";

const SERIF: React.CSSProperties = { fontFamily: "Spectral, Georgia, serif" };
const LAST_UPDATED = "8 October 2026";

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
          a lawyer familiar with your jurisdiction before relying on it for a public launch. This is not legal advice.
        </div>

        <div>
          <h1 className="text-2xl" style={{ ...SERIF, color: T.text }}>Privacy Policy</h1>
          <p className="text-xs mt-1" style={{ color: T.mute }}>Last updated: {LAST_UPDATED}</p>
        </div>

        <Section title="What this covers">
          <p>This policy explains what ESSA collects, how it&apos;s protected, and what happens to it if you delete your account.</p>
        </Section>

        <Section title="What we collect">
          <p><strong style={{ color: T.text }}>Account info:</strong> your name, email address, and a password hash, never your raw password.</p>
          <p><strong style={{ color: T.text }}>Financial data:</strong> transactions, goals, debts, recurring payments, and anything else you enter — including any notes you write, such as the explanation required when you mark a balance difference as accounted for. <strong style={{ color: T.text }}>Some entries are written by ESSA rather than typed by you</strong>: when you confirm what your emergency fund or a debt actually holds and it differs from ESSA&apos;s own figure, the difference is recorded as a correction in your transaction list — visible and reversible, rather than a number changing silently. This is encrypted (AES-256-GCM) and stored in your own browser&apos;s local storage. It is copied to our servers only if you turn on backup &mdash; see the next paragraph.</p>
          <p><strong style={{ color: T.text }}>Sync backup &mdash; off unless you turn it on.</strong> If you turn on automatic backup (in Profile, or when ESSA first asks you), a copy of your data is sent to our database (currently hosted on Neon/Postgres) a few seconds after each change, so you can sign in and restore it on another device. With backup on, each of your devices also fetches the copy when you open or return to ESSA, and combines it with what it already has. With backup off, nothing is uploaded automatically. Turning backup off lets you delete the server copy or keep it. If you delete it, or never had one, you can&apos;t sign in on another device, and your recovery code only works on this device. If you keep it, it stays on our server, this device stops updating it automatically, and you can still sign in on another device with your password. Generating a new recovery code always checks with our server first, even with backup off: that check sends your email address and your password-derived sync token, and uploads no data. Replacing a server copy&apos;s recovery code also sends tokens derived from your current and new recovery codes, never the codes themselves. <strong style={{ color: T.text }}>Until 28 September 2026, backup was automatic for every signed-in account, and earlier versions of this page wrongly said otherwise; accounts already backed up are asked the next time they open ESSA whether to keep it, delete it, or keep the existing copy without updating it.</strong> If you use ESSA on more than one device, turning backup off on one does not yet stop another device where you turned it on; turn it off on each. <strong style={{ color: T.text }}>Unlike your local browser storage, this server-side copy is not client-side-encrypted:</strong> it&apos;s stored as readable data, because it has to be restorable on a device that does not hold this device&apos;s encryption key — a second device that joins by pulling your data generates its own. It&apos;s protected instead by database access controls, TLS in transit, and requiring your password-derived sync token to read it back (your recovery code can reset that token, which is how recovery works), a materially different guarantee than the local encryption, and worth knowing plainly rather than assuming it carries over.</p>
        </Section>

        <Section title="How it's protected">
          <p>Your data-encryption key is random and never derived directly from your password. It&apos;s locked two ways (once by your password, once by a one-time recovery code shown at sign-up) so either one unlocks it. This protects the copy in your browser; see the sync-backup note above for what protects the server-side copy instead, if you use it.</p>
          <p><strong style={{ color: T.text }}>There is no email-based password reset.</strong> If you lose both your password and your recovery code, your account&apos;s data cannot be recovered by us or anyone else. That&apos;s a direct consequence of how the encryption works, not a support limitation we can override.</p>
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
            Pushing to sync <strong style={{ color: T.text }}>used to</strong> also write a decomposed copy
            (categorized transactions, dates, accounts) into an internal analytics warehouse, intended for future
            features that could query trends across your own data. <strong style={{ color: T.text }}>That stopped in
            September 2026: no decomposed copy is written any more.</strong> Copies made before it stopped are still on
            our database. They were never shared externally, nothing in the app ever read them back, and deleting
            your account removes them along with the sync backup itself.
          </p>
          <p>
            Separately, Profile → Help improve ESSA is a toggle, <strong style={{ color: T.text }}>on by default but a real opt-out</strong>,
            that sends anonymous counts for a handful of named product actions (like completing an onboarding step) to
            our own server, no third-party analytics SDK, no identity attached, never your financial data. Turning
            it on or off takes effect immediately.
          </p>
        </Section>

        <Section title="Security reports">
          <p>
            If ESSA&apos;s security policy blocks, or would block, something on a page, your browser may send a short
            report to our own server. The report itself carries nothing that identifies you and never your financial
            data: we log only which ESSA page it was and what was blocked, reduced to the site it came from or a word
            such as &apos;inline&apos;.
          </p>
        </Section>

        <Section title="Deleting your data">
          <p>
            Profile → Danger zone → Delete account removes your account and financial data from your browser
            immediately.
          </p>
          <p>
            <strong style={{ color: T.text }}>If backup was ever on for your account</strong>, including automatically before 28 September 2026, deleting your account
            also removes that backup copy (and anything derived from it) from our server automatically, on a
            best-effort basis. If you&apos;re offline at the moment you delete, or the server is unreachable, that
            part won&apos;t complete. Email us and we&apos;ll remove it by hand.
          </p>
          <p>
            When you delete an item, or reset all data, ESSA keeps a short record that it was deleted &mdash; its
            internal key (for a custom category, its name in lowercase) and when &mdash; so your other devices remove
            it too. These records are stored with the rest of your data, in the server copy too if backup is on, and
            are kept until you delete your account, which removes them.
          </p>
        </Section>

        <Section title="Taking your data with you">
          <p>
            Profile → Download my data exports everything: transactions, goals, debts, recurring payments,
            settings, as a JSON file, anytime, with no restriction. Yours to keep, move elsewhere, or back up by hand.
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
