"use client";

import { useEffect } from "react";
import { installErrorReporting } from "../lib/errorReport";

// INF-02 (owner, session 30): installs the window handlers that report an
// error nothing caught to our own server (lib/errorReport.ts). Rendered once,
// in the root layout (a server component, so it can't install them itself).
export default function ErrorReporting() {
  useEffect(() => { installErrorReporting(); }, []);
  return null;
}
