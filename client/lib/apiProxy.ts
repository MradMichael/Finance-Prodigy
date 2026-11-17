// SEC-04 / R1: what the site's /api proxy route (app/api/[...path]/route.ts) does with each request. Kept here
// because a Next route file may export only its handlers and route settings; the route's own notes say why it exists.

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
