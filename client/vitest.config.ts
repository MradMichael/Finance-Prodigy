import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// VER-05 (external audit, 2026-08-28): react() added so .tsx test files can
// actually parse JSX -- this project's suite only ever tested pure .ts
// functions from lib/ before, so nothing needed a JSX transform until the
// first real component test (app/admin/page.test.tsx, AUD-01) was added.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/*.test.ts"],
    },
  },
});
