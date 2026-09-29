import { defineConfig } from "vitest/config";

// Server tests (audit 2.4.156). Node environment; tests live in test/, outside
// src/, so tsc's rootDir build never compiles them into dist. The setup file
// is the production-isolation guard -- it must stay first.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/support/setup.ts"],
  },
});
