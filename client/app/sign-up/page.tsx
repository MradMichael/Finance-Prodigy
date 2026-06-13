"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signUp, signIn, getSession } from "../../lib/auth";
import { useTheme } from "../../contexts/ThemeContext";
import { Sovereign } from "../../components/EssaBrand";

function Field({
  label, type = "text", value, onChange, placeholder, autoComplete,
}: {
  label: string; type?: string; value: string;
  onChange: (v: string) => void; placeholder?: string; autoComplete?: string;
}) {
  const T = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-widest mb-1.5 font-medium" style={{ color: T.mute }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="w-full rounded-xl px-4 py-3 text-sm transition-all duration-150"
        style={{
          background: T.panelSoft,
          border: `1px solid ${focused ? T.jade : T.line}`,
          color: T.text,
          outline: "none",
          boxShadow: focused ? `0 0 0 3px ${T.jade}28` : "none",
          colorScheme: "dark",
        }}
      />
    </div>
  );
}

export default function SignUpPage() {
  const router  = useRouter();
  const T       = useTheme();
  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  useEffect(() => {
    if (getSession()) router.replace("/");
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 300));
    const reg = signUp(email, name, password);
    if (!reg.ok) { setLoading(false); setError(reg.error); return; }
    const login = await signIn(email, password);
    setLoading(false);
    if (login.ok) router.push("/");
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12" style={{ background: T.ink }}>

      {/* Logo */}
      <div className="flex flex-col items-center mb-10">
        <Sovereign size={64} />
        <h1 className="text-3xl font-medium tracking-tight mt-4" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>
          ESSA
        </h1>
        <p className="text-xs mt-1 tracking-widest uppercase" style={{ color: T.mute }}>
          Earn · Spend · Save · Achieve
        </p>
      </div>

      {/* Card */}
      <div
        className="w-full max-w-sm rounded-2xl p-8 shadow-2xl"
        style={{ background: T.panel, border: `1px solid ${T.line}` }}
      >
        <h2 className="text-lg font-medium mb-1" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>
          Create your account
        </h2>
        <p className="text-xs mb-7" style={{ color: T.mute }}>Start tracking your financial journey</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Full name" value={name} onChange={setName} placeholder="Your name" autoComplete="name" />
          <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@email.com" autoComplete="email" />
          <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="Min. 6 characters" autoComplete="new-password" />
          <Field label="Confirm password" type="password" value={confirm} onChange={setConfirm} placeholder="••••••••" autoComplete="new-password" />

          {error && (
            <div
              className="rounded-xl px-4 py-3 text-sm"
              style={{ background: T.coral + "18", border: `1px solid ${T.coral}40`, color: T.coral }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl text-sm font-semibold tracking-wide transition-all duration-150 mt-2 hover:opacity-90 active:scale-95 disabled:opacity-60"
            style={{ background: T.jade, color: T.ink }}
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="text-xs text-center mt-6" style={{ color: T.mute }}>
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium hover:opacity-80 transition-opacity" style={{ color: T.brass }}>
            Sign in
          </Link>
        </p>
      </div>

      <p className="text-[10px] mt-8 text-center max-w-xs" style={{ color: T.mute }}>
        Each account&apos;s data is stored separately. Your records are private to you.
      </p>
    </div>
  );
}
