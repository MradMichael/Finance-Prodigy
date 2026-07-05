"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signUp, signIn, getSession } from "../../lib/auth";
import { useTheme } from "../../contexts/ThemeContext";
import { Sovereign } from "../../components/EssaBrand";
import RecoveryCodeModal from "../../components/RecoveryCodeModal";
import Field from "../../components/form/Field";

export default function SignUpPage() {
  const router  = useRouter();
  const T       = useTheme();
  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  useEffect(() => {
    if (getSession()) router.replace("/");
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 300));
    const reg = await signUp(email, name, password);
    setLoading(false);
    if (!reg.ok) { setError(reg.error); return; }
    setRecoveryCode(reg.recoveryCode);
  }

  async function finishSignUp() {
    const login = await signIn(email, password);
    if (login.ok) { router.push("/"); return; }
    // Account was created successfully — only the immediate sign-in failed.
    // Dismiss the modal and fall back to the normal form (with its existing
    // error banner) instead of leaving the user stuck on it silently.
    setRecoveryCode(null);
    setError(`Account created, but automatic sign-in failed: ${login.error} Please sign in below.`);
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

      {recoveryCode && <RecoveryCodeModal code={recoveryCode} onContinue={finishSignUp} />}
    </div>
  );
}
