"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn, getSession } from "../../lib/auth";
import { useTheme } from "../../contexts/ThemeContext";
import { Sovereign } from "../../components/EssaBrand";
import RecoveryCodeModal from "../../components/RecoveryCodeModal";
import Field from "../../components/form/Field";

export default function SignInPage() {
  const router  = useRouter();
  const T       = useTheme();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  useEffect(() => {
    if (getSession()) router.replace("/");
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    await new Promise((r) => setTimeout(r, 300));
    const result = await signIn(email, password);
    setLoading(false);
    if (!result.ok) { setError(result.error); return; }
    // Older accounts get a recovery code the first time they sign in after
    // this feature shipped — show it once before continuing.
    if (result.recoveryCode) { setRecoveryCode(result.recoveryCode); return; }
    router.push("/");
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
          Welcome back
        </h2>
        <p className="text-xs mb-7" style={{ color: T.mute }}>Sign in to your account</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@email.com" autoComplete="email" />
          <Field label="Password" type="password" value={password} onChange={setPassword} placeholder="••••••••" autoComplete="current-password" />

          <div className="text-right -mt-2">
            <Link href="/recover" className="text-xs hover:opacity-80 transition-opacity" style={{ color: T.mute }}>
              Forgot password?
            </Link>
          </div>

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
            style={{ background: T.brass, color: T.ink }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-xs text-center mt-6" style={{ color: T.mute }}>
          No account yet?{" "}
          <Link href="/sign-up" className="font-medium hover:opacity-80 transition-opacity" style={{ color: T.jade }}>
            Create one
          </Link>
        </p>
      </div>

      <p className="text-[10px] mt-8 text-center max-w-xs" style={{ color: T.mute }}>
        Your data is stored privately in your browser. Connect a database to sync across devices.
      </p>

      {recoveryCode && (
        <RecoveryCodeModal code={recoveryCode} onContinue={() => router.push("/")} />
      )}
    </div>
  );
}
