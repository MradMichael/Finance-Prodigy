import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  // Session 52 (owner, R5): hover: classes only where the device can hover. On a touch screen a tap leaves a
  // control in its hover state, and the app dims on hover: a dimmed control stayed dimmed (and under contrast).
  future: { hoverOnlyWhenSupported: true },
  theme: { extend: {} },
  plugins: [],
};

export default config;
