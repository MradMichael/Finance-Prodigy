// Owner, session 34 (decision 26): the service worker precaches the app shell and every route's code at install,
// in a cache named for the build. build-sw.mjs writes public/sw.js after `next build`, embedding the build ID and
// the list, so the worker's bytes change with every build (how the browser notices a deploy). Never /api, never
// /admin, never the worker itself; the PDF worker is cached on first use instead.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { buildManifest, renderWorker, PAGES } from "./build-sw.mjs";

let root: string;
const put = (rel: string, body = "x") => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };
const templateDir = path.join(process.cwd(), "sw");

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "essa-sw-"));
  put(".next/BUILD_ID", "b1d-42\n");
  put(".next/static/chunks/main-abc.js");
  put(".next/static/chunks/app/page-def.js");
  put(".next/static/css/app-123.css");
  put(".next/static/b1d-42/_buildManifest.js");
  put(".next/server/app/index.html"); // server files are never listed
  put("public/sw.js", "old worker");
  put("public/pdf.worker.min.mjs");
  put("public/icon-192.png");
  put("public/fonts/spectral-400.woff2");
  put("public/manifest.webmanifest");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const manifest = () => buildManifest({ nextDir: path.join(root, ".next"), publicDir: path.join(root, "public") });

describe("the precache list", () => {
  it("every file the build wrote under .next/static, as /_next/static paths", () => {
    expect(manifest().files).toEqual(expect.arrayContaining([
      "/_next/static/chunks/main-abc.js", "/_next/static/chunks/app/page-def.js", "/_next/static/css/app-123.css", "/_next/static/b1d-42/_buildManifest.js",
    ]));
    expect(manifest().files.some((f) => f.includes("server"))).toBe(false);
  });

  it("the public files, but never the worker itself or the PDF worker", () => {
    const { files } = manifest();
    expect(files).toEqual(expect.arrayContaining(["/icon-192.png", "/fonts/spectral-400.woff2", "/manifest.webmanifest"]));
    expect(files).not.toContain("/sw.js");
    expect(files).not.toContain("/pdf.worker.min.mjs");
  });

  it("the pages, without /admin, and nothing under /api", () => {
    const m = manifest();
    expect(m.pages).toEqual(PAGES);
    expect(m.pages).toEqual(["/", "/sign-in", "/sign-up", "/profile", "/recover", "/privacy", "/terms", "/about", "/security"]);
    expect([...m.pages, ...m.files].some((u) => u.startsWith("/api") || u.startsWith("/admin"))).toBe(false);
  });

  it("the build's ID", () => {
    expect(manifest().build).toBe("b1d-42");
  });

  // Session 35 (owner): a file whose content hasn't changed is kept from the previous cache. Every listed file
  // carries a hash of its bytes, so the next build's worker can tell.
  it("a content hash for every listed file, changing only when the file's bytes change", () => {
    const one = manifest();
    expect(Object.keys(one.hashes).sort()).toEqual([...one.files].sort());
    for (const h of Object.values(one.hashes)) expect(h).toMatch(/^[0-9a-f]{16}$/);
    put("public/icon-192.png", "x"); // same bytes again
    expect(manifest().hashes["/icon-192.png"]).toBe(one.hashes["/icon-192.png"]);
    put("public/icon-192.png", "a new icon");
    expect(manifest().hashes["/icon-192.png"]).not.toBe(one.hashes["/icon-192.png"]);
    expect(manifest().hashes["/_next/static/chunks/main-abc.js"]).toBe(one.hashes["/_next/static/chunks/main-abc.js"]);
  });
});

describe("the worker", () => {
  it("embeds this build's list, so a new build changes its bytes", () => {
    const one = renderWorker({ manifest: manifest(), kill: false, templateDir });
    expect(one).not.toContain("__ESSA_MANIFEST__");
    expect(one).toContain('"build":"b1d-42"');
    put(".next/BUILD_ID", "b1d-43");
    expect(renderWorker({ manifest: manifest(), kill: false, templateDir })).not.toBe(one);
  });

  it("the kill switch: deletes ESSA's caches and unregisters, caching nothing", () => {
    const kill = renderWorker({ manifest: null, kill: true, templateDir });
    expect(kill).toContain("unregister");
    expect(kill).not.toContain("cache.put");
    expect(kill).not.toContain("addEventListener(\"fetch\"");
  });
});
