import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "../contexts/ThemeContext";
import { THEME_SCRIPT } from "../lib/theme";
import ErrorReporting from "../components/ErrorReporting";
import UpdateNotice from "../components/UpdateNotice";

export const metadata: Metadata = {
  title: "ESSA: Earn Spend Save Achieve",
  description: "Earn Spend Save Achieve: your financial command center",
  manifest: "/manifest.webmanifest",
  // Explicitly listing `icon` here, not just `apple` -- an explicit `icons`
  // object in metadata suppresses Next.js's own app/icon.svg file-convention
  // auto-detection rather than merging with it, so with only `apple` set,
  // no <link rel="icon"> tag was ever rendered at all and every browser
  // fell back to its generic default tab icon.
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  // PWA P1 (owner-approved, 2026-11-05): on an iPhone home screen the app is named "ESSA", and the status bar
  // keeps its own background ("default"), so its text is readable on every theme -- "black-translucent" would
  // put white text over Ivory, the default theme. No startup images (owner, Q3).
  appleWebApp: { capable: true, title: "ESSA", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#0B1F1E",
  // PWA P2 (owner-approved, 2026-11-05): draw to the screen's edges so the browser reports the notch and
  // home-indicator insets (env(safe-area-inset-*) reads 0 without this); the top bar, bottom navigation, pinned
  // notices and page body pad themselves by them (components/shell/safe-area-shell.test.tsx, safe-area.test.ts).
  viewportFit: "cover",
};

// Registers the service worker (owner, session 34, decision 26). public/sw.js is generated at build time
// (sw/build-sw.mjs) and precaches the app shell and the build's files, so the app opens offline. It never
// caches /api/* or any data, and a new build waits for UpdateNotice's Reload, so nobody is moved to a new
// build mid-session. Without a built worker (`next dev`) the registration fails quietly.
const SW_INIT = `if ('serviceWorker' in navigator) { window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function(){}); }); }`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Spectral is self-hosted (globals.css, PRIV-01): no request to any other site. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: SW_INIT }} />
      </head>
      <body>
        {/* Every screen in this app is a Client Component -- with JS disabled,
            nothing below this ever renders. Without this, a JS-disabled visitor
            saw a permanently blank page with no explanation at all. */}
        <noscript>
          <div style={{
            minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
            padding: "1rem", background: "#0B1F1E", color: "#EAF2EF", fontFamily: "system-ui, sans-serif",
          }}>
            <div style={{ maxWidth: 380, textAlign: "center" }}>
              <h1 style={{ fontSize: 20, marginBottom: 8 }}>JavaScript is required</h1>
              <p style={{ fontSize: 14, opacity: 0.8 }}>
                ESSA runs entirely in your browser — including decrypting your own financial data — so it needs JavaScript enabled to work at all. Please enable it and reload this page.
              </p>
            </div>
          </div>
        </noscript>
        <ErrorReporting />
        <ThemeProvider>
          {children}
          <UpdateNotice />
        </ThemeProvider>
      </body>
    </html>
  );
}
