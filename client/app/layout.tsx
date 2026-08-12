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
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
