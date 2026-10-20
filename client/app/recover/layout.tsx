import type { Metadata } from "next";

// A11Y-07 (session 22; approved and merged in session 23, b173718): this page's own title, from its heading. Every page
// had the same one, "ESSA: Earn Spend Save Achieve".
export const metadata: Metadata = { title: "Recover your account · ESSA" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
