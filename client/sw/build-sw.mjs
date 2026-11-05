// Writes public/sw.js after `next build` (owner, session 34, decision 26). The worker embeds this build's ID and
// precache list, so its bytes change with every build -- that's how the browser notices a new deploy. The list is
// every file under .next/static, the public files (never sw.js itself; the PDF worker is cached on first use
// instead), and the pages below. Never /api, never /admin. ESSA_SW_KILL=1 writes the kill switch instead.
//   node sw/build-sw.mjs            (run by `npm run build`)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Pages precached as the app shell: prerendered at build, filled in on the device, so they hold no data. */
export const PAGES = ["/", "/sign-in", "/sign-up", "/profile", "/recover", "/privacy", "/terms", "/about", "/security"];
/** Not precached; the worker stores them on first use. */
export const ON_FIRST_USE = ["/pdf.worker.min.mjs", "/geo/cities15000.json"]; // the city file: travel map plan, Phase 1b (D6)
const NEVER = new Set(["/sw.js", ...ON_FIRST_USE]);

function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p, base) : [path.relative(base, p).split(path.sep).join("/")];
  });
}

/** Session 35: a short hash of a file's bytes, so the next build's worker can tell an unchanged file. */
const hashOf = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 16);

/** @param {{ nextDir: string, publicDir: string }} dirs */
export function buildManifest({ nextDir, publicDir }) {
  const build = fs.readFileSync(path.join(nextDir, "BUILD_ID"), "utf8").trim();
  /** @type {[string, string][]} url, file on disk */
  const listed = [
    ...walk(path.join(nextDir, "static")).map((p) => [`/_next/static/${p}`, path.join(nextDir, "static", p)]),
    ...walk(publicDir).map((p) => [`/${p}`, path.join(publicDir, p)]).filter(([u]) => !NEVER.has(u) && !u.startsWith("/api/") && !u.startsWith("/admin")),
  ];
  const files = listed.map(([u]) => u).sort();
  const hashes = Object.fromEntries(listed.map(([u, f]) => [u, hashOf(f)]));
  return { build, pages: PAGES, files, hashes };
}

/** @param {{ manifest: { build: string, pages: string[], files: string[] } | null, kill: boolean, templateDir: string }} opts */
export function renderWorker({ manifest, kill, templateDir }) {
  if (kill) return fs.readFileSync(path.join(templateDir, "sw-kill.js"), "utf8");
  const template = fs.readFileSync(path.join(templateDir, "sw-template.js"), "utf8");
  if (!template.includes("__ESSA_MANIFEST__")) throw new Error("sw-template.js has no __ESSA_MANIFEST__ placeholder");
  return template.replace("__ESSA_MANIFEST__", () => JSON.stringify(manifest));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const kill = process.env.ESSA_SW_KILL === "1";
  const manifest = kill ? null : buildManifest({ nextDir: path.join(root, ".next"), publicDir: path.join(root, "public") });
  fs.writeFileSync(path.join(root, "public", "sw.js"), renderWorker({ manifest, kill, templateDir: path.join(root, "sw") }));
  console.log(kill ? "sw.js: the kill switch" : `sw.js: build ${manifest.build}, ${manifest.pages.length} pages, ${manifest.files.length} files`);
}
