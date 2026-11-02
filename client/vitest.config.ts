import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// VER-05 (external audit, 2026-08-28): react() added so .tsx test files can
// actually parse JSX -- this project's suite only ever tested pure .ts
// functions from lib/ before, so nothing needed a JSX transform until the
// first real component test (app/admin/page.test.tsx, AUD-01) was added.
export default defineConfig({
  plugins: [react()],
  // R3 (session 33): the page's lazy screens (app/screens.lazy.tsx) are their plain imports under test, so
  // a page test renders a screen the moment it's chosen. components/screens-lazy.test.tsx tests the lazy
  // module itself (it imports it by a path this alias doesn't match).
  resolve: {
    alias: [{ find: /^\.\/screens\.lazy$/, replacement: fileURLToPath(new URL("./app/screens.sync.tsx", import.meta.url)) }],
  },
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
