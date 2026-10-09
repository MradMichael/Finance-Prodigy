// The owner's tool (scripts/goal-openings.mjs) is imported by a test, and
// run as `node client/scripts/goal-openings.mjs <file>`. It must not start
// with a "#!" line: on a Windows checkout (core.autocrlf, CRLF endings) the
// test's parser refuses that line, and lib/goal-openings-script.test.ts
// fails to load at all. Found on session 5's combined branch, where the file
// was checked out fresh. Read as text here, so this test runs even when the
// import would fail.
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

it("the tool has no #! line", () => {
  const source = readFileSync(join(process.cwd(), "scripts", "goal-openings.mjs"), "utf8");
  expect(source.startsWith("#!")).toBe(false);
});
