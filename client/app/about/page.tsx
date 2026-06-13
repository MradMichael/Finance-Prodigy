"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "../../contexts/ThemeContext";
import { Signet } from "../../components/EssaBrand";

const SERIF = { fontFamily: "Spectral, Georgia, serif" };

// ─── FAQ DATA ────────────────────────────────────────────────────────────────
const FAQ: { q: string; a: string }[] = [
  {
    q: "Where is my data stored?",
    a: "All your financial data lives encrypted in your browser's localStorage using AES-256-GCM. Nothing is sent anywhere unless you explicitly use the 'Push to database' feature.",
  },
  {
    q: "How secure is the encryption?",
    a: "Your data is encrypted with AES-GCM 256-bit. The key is derived from your password using PBKDF2 with 120,000 iterations and is never stored — only held in sessionStorage while you're logged in.",
  },
  {
    q: "What happens if I clear my browser data?",
    a: "Your data will be lost unless you pushed it to the database first. Use Profile → Database sync → Push before clearing browser storage.",
  },
  {
    q: "Can I use ESSA on multiple devices?",
    a: "Yes — push your data from one device, then pull it on another. Both must be connected to the same local database server (running at localhost:4000).",
  },
  {
    q: "What currencies are supported?",
    a: "USD and LBP (Lebanese Pound). Set your LBP rate in My Finances → Settings and all amounts are converted automatically.",
  },
  {
    q: "How is the health score calculated?",
    a: "It's a weighted score across five dimensions: savings rate (25%), needs discipline (20%), emergency fund (25%), debt pressure (20%), and goal momentum (10%).",
  },
  {
    q: "What does the 50/30/20 rule mean?",
    a: "A budgeting guideline: 50% of income on Needs, 30% on Wants, and 20% on Savings/debt. ESSA tracks your actual split and shows how close you are.",
  },
  {
    q: "How do I record a debt payment?",
    a: "Go to My Finances → Debts. Hover over a debt and click 'Pay'. Enter the payment amount — the balance is reduced automatically.",
  },
];

// ─── FEATURES ────────────────────────────────────────────────────────────────
const FEATURES = [
  { icon: "🔒", title: "AES-256 encrypted", body: "Your data is encrypted with your password before being stored." },
  { icon: "📊", title: "Financial health score", body: "Track five pillars: savings, needs, safety net, debt, and goals." },
  { icon: "🎯", title: "Goal tracking", body: "Set goals with target dates and contribute funds over time." },
  { icon: "🔄", title: "Recurring payments", body: "Model subscriptions, loans, and any periodic expense or income." },
  { icon: "💳", title: "Payment methods", body: "Track cash vs card (Visa, Mastercard, Amex) per transaction." },
  { icon: "🌍", title: "Multi-currency", body: "USD + LBP with a configurable exchange rate." },
  { icon: "☁️", title: "Database sync", body: "Back up to a local SQL Server and restore on any device." },
  { icon: "🎨", title: "3 themes", body: "Ledger (green), Midnight (navy), and Obsidian (black)." },
];

// ─── COMPONENT ───────────────────────────────────────────────────────────────
export default function AboutPage() {
  const router = useRouter();
  const T = useTheme();

  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [suggestion, setSuggestion] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function handleSubmitFeedback(e: React.FormEvent) {
    e.preventDefault();
    if (!suggestion.trim() && rating === null) return;
    const stored = JSON.parse(localStorage.getItem("essa_feedback") ?? "[]");
    stored.push({ rating, suggestion: suggestion.trim(), at: new Date().toISOString() });
    localStorage.setItem("essa_feedback", JSON.stringify(stored));
    setSubmitted(true);
    setSuggestion("");
    setRating(null);
  }

  return (
    <div className="min-h-screen" style={{ background: T.ink }}>

      {/* Header */}
      <header
        className="flex items-center gap-3 px-6 py-3 sticky top-0 z-10"
        style={{ background: T.panel, borderBottom: `1px solid ${T.line}` }}
      >
        <button
          onClick={() => router.back()}
          className="text-sm px-3 py-1.5 rounded-lg transition-opacity hover:opacity-70"
          style={{ color: T.mute }}
        >
          ← Back
        </button>
        <span className="text-sm font-medium" style={{ color: T.text }}>About ESSA</span>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-10 space-y-10">

        {/* Hero */}
        <section className="flex flex-col items-center text-center py-8 gap-4">
          <Signet size={72} />
          <div>
            <h1 className="text-4xl font-medium tracking-tight" style={{ ...SERIF, color: T.text }}>ESSA</h1>
            <p className="text-sm mt-1 tracking-widest uppercase" style={{ color: T.mute }}>
              Earn · Spend · Save · Achieve
            </p>
          </div>
          <p className="text-sm max-w-md leading-relaxed" style={{ color: T.mute }}>
            A personal finance companion built for clarity and control. Track every dollar, plan every goal,
            and understand your financial health — all from your browser, with your data staying yours.
          </p>
          <div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs"
            style={{ background: T.jade + "18", color: T.jade, border: `1px solid ${T.jade}30` }}
          >
            Version 1.0 — offline-first, encrypted
          </div>
        </section>

        {/* Features */}
        <section>
          <h2 className="text-base font-semibold mb-4" style={{ ...SERIF, color: T.text }}>What ESSA does</h2>
          <div className="grid grid-cols-2 gap-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl p-4"
                style={{ background: T.panel, border: `1px solid ${T.line}` }}
              >
                <div className="text-xl mb-2">{f.icon}</div>
                <p className="text-xs font-semibold mb-1" style={{ color: T.text }}>{f.title}</p>
                <p className="text-[11px] leading-relaxed" style={{ color: T.mute }}>{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section>
          <h2 className="text-base font-semibold mb-4" style={{ ...SERIF, color: T.text }}>Frequently asked questions</h2>
          <div className="space-y-2">
            {FAQ.map((item, i) => (
              <div
                key={i}
                className="rounded-2xl overflow-hidden"
                style={{ background: T.panel, border: `1px solid ${T.line}` }}
              >
                <button
                  className="w-full text-left px-5 py-4 flex items-center justify-between gap-3 text-sm font-medium transition-opacity hover:opacity-80"
                  style={{ color: T.text }}
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span>{item.q}</span>
                  <span
                    className="text-lg flex-shrink-0 transition-transform duration-200"
                    style={{ color: T.jade, transform: openFaq === i ? "rotate(45deg)" : "none" }}
                  >
                    +
                  </span>
                </button>
                {openFaq === i && (
                  <div
                    className="px-5 pb-4 text-sm leading-relaxed"
                    style={{ color: T.mute }}
                  >
                    {item.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Contact */}
        <section>
          <h2 className="text-base font-semibold mb-4" style={{ ...SERIF, color: T.text }}>Contact</h2>
          <div
            className="rounded-2xl p-6 space-y-3"
            style={{ background: T.panel, border: `1px solid ${T.line}` }}
          >
            <p className="text-sm" style={{ color: T.mute }}>
              ESSA is a personal project. For questions or support, reach out directly:
            </p>
            <a
              href="mailto:mmrad1998@gmail.com"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-80"
              style={{ background: T.brass + "20", color: T.brass, border: `1px solid ${T.brass}30` }}
            >
              ✉ mmrad1998@gmail.com
            </a>
            <p className="text-[11px]" style={{ color: T.mute }}>
              This app is offline-first and does not connect to any external servers unless you configure a local database.
            </p>
          </div>
        </section>

        {/* Review & Suggestions */}
        <section>
          <h2 className="text-base font-semibold mb-4" style={{ ...SERIF, color: T.text }}>
            Review &amp; suggestions
          </h2>
          <div
            className="rounded-2xl p-6"
            style={{ background: T.panel, border: `1px solid ${T.line}` }}
          >
            {submitted ? (
              <div className="text-center py-8">
                <div className="text-4xl mb-3">🙏</div>
                <p className="text-sm font-semibold" style={{ color: T.text }}>Thanks for your feedback!</p>
                <p className="text-xs mt-1" style={{ color: T.mute }}>Your response is saved locally.</p>
                <button
                  className="mt-4 text-xs underline"
                  style={{ color: T.jade }}
                  onClick={() => setSubmitted(false)}
                >
                  Leave another
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmitFeedback} className="space-y-5">
                {/* Star rating */}
                <div>
                  <p className="text-xs uppercase tracking-widest mb-3 font-medium" style={{ color: T.mute }}>
                    How would you rate ESSA?
                  </p>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRating(star)}
                        className="text-2xl transition-transform hover:scale-110 active:scale-95"
                        style={{ opacity: rating !== null && star > rating ? 0.3 : 1 }}
                      >
                        ⭐
                      </button>
                    ))}
                  </div>
                  {rating && (
                    <p className="text-xs mt-1.5" style={{ color: T.jade }}>
                      {["", "Needs work", "It's okay", "Pretty good", "Great!", "Outstanding!"][rating]}
                    </p>
                  )}
                </div>

                {/* Suggestion */}
                <div>
                  <label className="block text-xs uppercase tracking-widest mb-2 font-medium" style={{ color: T.mute }}>
                    Suggestions or comments
                  </label>
                  <textarea
                    value={suggestion}
                    onChange={(e) => setSuggestion(e.target.value)}
                    placeholder="What would make ESSA better for you?"
                    rows={4}
                    className="w-full rounded-xl px-4 py-3 text-sm resize-none transition-all"
                    style={{
                      background: T.panelSoft,
                      border: `1px solid ${T.line}`,
                      color: T.text,
                      outline: "none",
                      colorScheme: "dark",
                    }}
                    onFocus={(e) => (e.target.style.borderColor = T.jade)}
                    onBlur={(e) => (e.target.style.borderColor = T.line)}
                  />
                </div>

                <button
                  type="submit"
                  disabled={!suggestion.trim() && rating === null}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90 active:scale-95 disabled:opacity-40"
                  style={{ background: T.jade, color: T.ink }}
                >
                  Submit feedback
                </button>
              </form>
            )}
          </div>
        </section>

        {/* Footer */}
        <footer className="text-center pt-4 pb-8">
          <p className="text-[11px]" style={{ color: T.mute }}>
            ESSA — built with Next.js, Tailwind, and Recharts.
          </p>
          <p className="text-[10px] mt-1" style={{ color: T.mute + "80" }}>
            Your data never leaves your device without your permission.
          </p>
        </footer>

      </div>
    </div>
  );
}
