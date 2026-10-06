const { securityHeaders } = require("./securityHeaders");

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_URL ?? "http://localhost:4000"}/api/:path*`,
      },
    ];
  },
  // FB-1c (SEC-03, PRIV-01). Production only: `next dev` needs eval for hot
  // reload, which the policy forbids. What each header does, and why the
  // content policy is report-only for now, is in securityHeaders.js.
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];
    return [
      { source: "/:path*", headers: securityHeaders({ enforce: process.env.ESSA_CSP_ENFORCE === "1" }) },
      // The self-hosted fonts' file names carry their version, so a year as immutable is safe.
      { source: "/fonts/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};

module.exports = nextConfig;
