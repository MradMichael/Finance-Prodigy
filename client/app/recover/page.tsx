"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { recoverAccount, getSession } from "../../lib/auth";
import { useTheme } from "../../contexts/ThemeContext";
import { Sovereign } from "../../components/EssaBrand";
import RecoveryCodeModal from "../../components/RecoveryCodeModal";
import Field from "../../components/form/Field";

export default function RecoverPage() {
  const router  = useRouter();
  const T       = useTheme();
  const [email,        setEmail]        = useState("");
  const [code,         setCode]         = useState("");
  const [newPassword,  setNewPassword]  = useState("");
  const [confirm,      setConfirm]      = useState("");
  const [error,        setError]        = useState("");
  const [loading,      setLoading]      = useState(false);
  const [newRecoveryCode, setNewRecoveryCode] = useState<string | null>(null);

  useEffect(() => {
    if (getSession()) router.replace("/");
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 300));
    const result = await recoverAccount(email, code, newPassword);
    setLoading(false);
    if (!result.ok) { setError(result.error); return; }
    setNewRecoveryCode(result.newRecoveryCode);
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12" style={{ background: T.ink }}>

      <div className="flex flex-col items-center mb-10">
        <Sovereign size={64} />
        <h1 className="text-3xl font-medium tracking-tight mt-4" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>
          ESSA
        </h1>
        <p className="text-xs mt-1 tracking-widest uppercase" style={{ color: T.mute }}>
          Earn · Spend · Save · Achieve
        </p>
      </div>

      <div
        className="w-full max-w-sm rounded-2xl p-8 shadow-2xl"
        style={{ background: T.panel, border: `1px solid ${T.line}` }}
      >
        <h2 className="text-lg font-medium mb-1" style={{ color: T.text, fontFamily: "Spectral, Georgia, serif" }}>
          Recover your account
        </h2>
        <p className="text-xs mb-7" style={{ color: T.mute }}>
          Enter the recovery code you saved when you signed up, plus a new password.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@email.com" autoComplete="email" />
          <Field label="Recovery code" value={code} onChange={setCode} placeholder="XXXX-XXXX-XXXX-XXXX" autoComplete="off" />
          <Field label="New password" type="password" value={newPassword} onChange={setNewPassword} placeholder="Min. 10 characters" autoComplete="new-password" />
          <Field label="Confirm new password" type="password" value={confirm} onChange={setConfirm} placeholder="••••••••" autoComplete="new-password" />

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
            {loading ? "Recovering…" : "Reset password"}
          </button>
        </form>

        <p className="text-xs text-center mt-6" style={{ color: T.mute }}>
          Remembered it after all?{" "}
          <Link href="/sign-in" className="font-medium hover:opacity-80 transition-opacity" style={{ color: T.brass }}>
            Sign in
          </Link>
        </p>
      </div>

      <p className="text-[10px] mt-8 text-center max-w-xs" style={{ color: T.mute }}>
        No recovery code saved? There&apos;s no other way back into an account&apos;s data. That&apos;s the tradeoff for it being encrypted only you can unlock.
      </p>

      {newRecoveryCode && (
        <RecoveryCodeModal code={newRecoveryCode} onContinue={() => router.push("/")} />
      )}
    </div>
  );
}
