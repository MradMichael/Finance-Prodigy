"use client";

import { useEffect } from "react";

// Catches an error in the ROOT layout itself (e.g. ThemeProvider throwing) —
// rare, but when it happens the layout that would normally provide the
// theme is exactly what failed, so this can't rely on useTheme() and must
// render its own <html>/<body> (Next replaces the whole root layout with
// this component in that case). Colors are hardcoded to the ledger theme's
// palette as a reasonable-looking fallback.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ background: "#0B1F1E", color: "#EAF2EF", fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
          <div style={{ maxWidth: 380, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
            <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
            <p style={{ fontSize: 14, opacity: 0.7, marginBottom: 20 }}>
              Your financial data is safe. It lives in your browser, not on this screen. Try reloading the page.
            </p>
            <button
              onClick={reset}
              style={{ padding: "10px 20px", borderRadius: 12, background: "#4FD1A5", color: "#0B1F1E", fontWeight: 600, border: "none", cursor: "pointer" }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
