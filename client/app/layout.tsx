import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "../contexts/ThemeContext";

export const metadata: Metadata = {
  title: "ESSA — Earn Spend Save Achieve",
  description: "Earn Spend Save Achieve — your financial command center",
};

const THEME_INIT = `(function(){try{var t=localStorage.getItem('essa_theme')||'ledger';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Spectral:wght@400;600;700&display=swap" rel="stylesheet" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
