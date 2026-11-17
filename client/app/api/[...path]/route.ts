// SEC-04 / R1: the site's own proxy for /api.
//
// The browser calls /api on this site, as it always has. This route forwards the call to ESSA's server
// (API_URL) and, when ESSA_PROXY_KEY is set, tells the server who is calling: the address Vercel saw, with the
// secret that proves the message came from this route. The server's rate limits then count per person. Without
// it they count per connecting address, which behind a proxy is the proxy's: one allowance shared by everyone.
//
// - The secret is read here only, on the server side. It has no NEXT_PUBLIC_ name, is never sent to the browser
//   and is in no response. Anything a browser sends under the two header names is dropped.
// - The address comes from x-vercel-forwarded-for, which Vercel sets. Off Vercel a browser could set that header
//   itself, so nothing is vouched for there (a local run behaves as before: the server sees one address).
// - Forwarded to the server: the method, the body, the query, and four request headers (content type,
//   Authorization, Accept, User-Agent). Not cookies, and not Vercel's own headers.
// - Back to the browser: the status, the body, the content type, and the rate-limit headers.
// - If the server can't be reached the answer is a plain 502, which the app reads as "not our server's reply"
//   and shows its server-trouble line, as it does for a host's error page.
// - Without this file, next.config.js's fallback rewrite forwards /api as it did before (nothing vouched for).

export const dynamic = "force-dynamic";
/** The server can take a while to wake; the default function limit would cut a slow first call short. */
export const maxDuration = 60;

const MIN_SECRET = 32;
const REQUEST_HEADERS = ["content-type", "authorization", "accept", "user-agent"];
const RESPONSE_HEADERS = ["content-type", "cache-control", "retry-after", "ratelimit", "ratelimit-policy", "ratelimit-limit", "ratelimit-remaining", "ratelimit-reset"];

/** `||`, not `??`: an empty API_URL counts as unset, as in next.config.js (session 37). */
const upstream = () => process.env.API_URL || "http://localhost:4000";

/** The address to vouch for: the first one Vercel recorded. Only on Vercel, where a browser can't set that header. */
function callerAddress(req: Request): string | null {
  if (!process.env.VERCEL) return null;
  const first = (req.headers.get("x-vercel-forwarded-for") ?? "").split(",")[0].trim();
  return first || null;
}

export async function forward(req: Request, path: string[]): Promise<Response> {
  if (path.length === 0 || path.some((p) => p === "" || p === "." || p === ".." || /[\\/]/.test(p))) {
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const target = `${upstream()}/api/${path.map(encodeURIComponent).join("/")}${new URL(req.url).search}`;

  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const secret = process.env.ESSA_PROXY_KEY ?? "";
  const caller = callerAddress(req);
  if (secret.length >= MIN_SECRET && caller) {
    headers.set("x-essa-proxy-key", secret);
    headers.set("x-essa-client-ip", caller);
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let res: Response;
  try {
    res = await fetch(target, { method: req.method, headers, body: hasBody ? await req.arrayBuffer() : undefined, redirect: "manual", cache: "no-store" });
  } catch {
    return new Response("Bad gateway", { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const out = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = res.headers.get(name);
    if (value !== null) out.set(name, value);
  }
  const empty = res.status === 204 || res.status === 304 || req.method === "HEAD";
  return new Response(empty ? null : res.body, { status: res.status, headers: out });
}

type Ctx = { params: Promise<{ path: string[] }> };
const handler = async (req: Request, ctx: Ctx) => forward(req, (await ctx.params).path);

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE, handler as HEAD, handler as OPTIONS };
