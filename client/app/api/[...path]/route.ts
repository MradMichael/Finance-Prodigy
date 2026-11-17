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
// - The forwarding itself is lib/apiProxy.ts: a route file may export only its handlers and Next's route settings.

import { forward } from "../../../lib/apiProxy";

export const dynamic = "force-dynamic";
/** The server can take a while to wake; the default function limit would cut a slow first call short. */
export const maxDuration = 60;

type Ctx = { params: Promise<{ path: string[] }> };
const handler = async (req: Request, ctx: Ctx) => forward(req, (await ctx.params).path);

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE, handler as HEAD, handler as OPTIONS };
