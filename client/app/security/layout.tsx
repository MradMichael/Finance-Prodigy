import type { Metadata } from "next";

// A11Y-07 (session 22, draft, held): this page's own title, from its heading. Every page
// had the same one, "ESSA: Earn Spend Save Achieve".
export const metadata: Metadata = { title: "Security · ESSA" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
