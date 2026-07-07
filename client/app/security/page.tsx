"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTheme } from "../../contexts/ThemeContext";

const SERIF: React.CSSProperties = { fontFamily: "Spectral, Georgia, serif" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const T = useTheme();
  return (
    <section>
      <h2 className="text-base font-semibold mb-3" style={{ ...SERIF, color: T.text }}>{title}</h2>
      <div className="text-sm leading-relaxed space-y-3" style={{ color: T.mute }}>{children}</div>
    </section>
  );
}

export default function SecurityPage() {
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
        <span className="text-sm font-medium" style={{ color: T.text }}>Trust &amp; Security</span>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
        <div>
          <h1 className="text-2xl" style={{ ...SERIF, color: T.text }}>How ESSA actually protects your data</h1>
          <p className="text-sm mt-2" style={{ color: T.mute }}>
            Written plainly, including the parts that are less impressive than &quot;everything is encrypted.&quot; See the{" "}
            <Link href="/privacy" style={{ color: T.jade }}>Privacy Policy</Link> for the formal version.
          </p>
        </div>

        <Section title="Local storage: encrypted, and here's how">
          <p>
            A random 256-bit encryption key (the DEK) is generated once per account — it&apos;s never derived
            directly from your password. Instead it&apos;s locked two separate ways: once under a key derived
            from your password, once under a key derived from a one-time recovery code shown at sign-up (both via
            PBKDF2, 120,000 iterations). Either secret unlocks the same underlying key. Your financial data itself
            is encrypted with that key using AES-256-GCM before it&apos;s written to your browser&apos;s local storage.
          </p>
          <p>
            This is why the recovery code exists: forgetting your password doesn&apos;t mean losing your data, as
            long as you saved the code. But it also means there&apos;s no back door — <strong style={{ color: T.text }}>
            if you lose both, nobody, including us, can recover that account&apos;s data.</strong> That&apos;s the
            tradeoff real encryption requires, not a support policy we chose.
          </p>
        </Section>

        <Section title="Sync backup: not the same guarantee — read this if you use it">
          <p>
            If you turn on Database sync (Profile → Push), a copy of your data is uploaded to our server so you
            can restore it on another device. <strong style={{ color: T.text }}>That copy is not encrypted the
            way your local data is</strong> — it&apos;s stored as plain, readable data, because a background
            process decomposes it into a separate analytics database that needs to read actual field values
            (categories, dates, amounts) to work at all.
          </p>
          <p>
            What protects it instead: our database isn&apos;t publicly reachable outside its access controls,
            all traffic to it runs over TLS, and reading your data back (pull) requires a token derived from
            your password that we never see or store directly. That&apos;s a real, meaningful set of protections
            — but it is a different, weaker guarantee than &quot;even if someone got into the database, they couldn&apos;t
            read anything,&quot; which is only true for the copy that stays in your browser. If that distinction
            matters to you, don&apos;t turn on sync — the app is fully functional locally without it.
          </p>
        </Section>

        <Section title="What we don't do">
          <ul className="list-disc pl-5 space-y-1">
            <li>No linking to your bank or any third-party financial account — nothing to be breached on that front, because it doesn&apos;t exist.</li>
            <li>No ads, no third-party analytics or tracking scripts.</li>
            <li>No selling or sharing your data with anyone.</li>
          </ul>
        </Section>

        <Section title="The admin panel isn't a backdoor into your account">
          <p>
            An internal admin panel exists for diagnostics, but it&apos;s gated out of the production build
            entirely — it doesn&apos;t ship to the live app strangers use. It also couldn&apos;t show your
            financial data even in development: it only ever sees account metadata (email, sign-up date) from
            the browser it&apos;s opened in, never the encrypted contents of your local storage.
          </p>
        </Section>

        <Section title="Questions">
          <p>
            Something here doesn&apos;t add up, or you want more detail before trusting us with real financial
            data — ask: <a href="mailto:mmrad1998@gmail.com" style={{ color: T.jade }}>mmrad1998@gmail.com</a>.
            See also the <Link href="/privacy" style={{ color: T.jade }}>Privacy Policy</Link> and{" "}
            <Link href="/terms" style={{ color: T.jade }}>Terms of Service</Link>.
          </p>
        </Section>
      </div>
    </div>
  );
}
