import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "../contexts/ThemeContext";
import { THEME_SCRIPT } from "../lib/theme";

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
};

export const viewport: Viewport = {
  themeColor: "#0B1F1E",
};

// Registers a deliberately no-op-caching service worker (see public/sw.js)
// purely so the app is installable to a phone home screen — real offline
// caching is intentionally not part of this, so there's no risk of anyone
// seeing stale financial data or a stale build after a deploy.
const SW_INIT = `if ('serviceWorker' in navigator) { window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function(){}); }); }`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Spectral:wght@400;600;700&display=swap" rel="stylesheet" />
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
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
