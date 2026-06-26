import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { SECURITY_HEADERS } from "./lib/security-headers";

// Static security headers applied to every response (including static assets).
// Defined once in lib/security-headers.ts so the /super-admin/security audit
// reads the exact same list. The Content-Security-Policy is NOT set here: it
// requires a per-request script nonce, attached per request in proxy.ts instead.
const securityHeaders = [...SECURITY_HEADERS];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    // Prefer AVIF (then WebP) for menu/vendor photos. This is the biggest mobile
    // win for an image-heavy food app on metered data: AVIF is typically 20-50%
    // smaller than WebP at equal quality, and Next negotiates per request Accept
    // header so older clients still get WebP/original. No code changes needed —
    // every <Image> already routes through the optimizer.
    formats: ['image/avif', 'image/webp'],
    // Menu/vendor photos are served from the Supabase Storage public bucket.
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '1mb',
    },
  },
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        // The service worker MUST never be HTTP-cached, or the browser keeps
        // serving the old sw.js and never sees a new CACHE_NAME — so deploys
        // never reach already-installed PWAs (the "I don't see any change" bug).
        // Always revalidate it so a new SW is picked up on the next foreground.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

// Wrap with Sentry. Source-map upload only runs when SENTRY_AUTH_TOKEN (+ org/
// project) are set — without them the build still succeeds, just without
// readable stack traces in Sentry. `silent` keeps CI logs clean.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  // Tree-shake Sentry's debug logging out of the client bundle (replaces the
  // deprecated `disableLogger`). No-op under Turbopack, applied under webpack.
  webpack: { treeshake: { removeDebugLogging: true } },
  // Avoid ad-blockers dropping client events by tunnelling through our origin.
  tunnelRoute: "/monitoring",
});
