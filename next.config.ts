import type { NextConfig } from 'next'

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' }, // personal links in URLs must never leak via Referer
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  // Content-Security-Policy for pages is set per request with a nonce in proxy.ts
]

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: { unoptimized: true }, // no image optimiser endpoint to attack
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: '/api/:path*', headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'" }, { key: 'Cache-Control', value: 'no-store' }] },
      // Images and icons: cache for a week (files in /_next/static are already cached for a year by Next.js)
      { source: '/:file(.*\\.(?:png|ico|svg|webp))', headers: [{ key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=86400' }] },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Content-Type', value: 'application/javascript; charset=utf-8' }] },
      { source: '/n/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }, { key: 'X-Robots-Tag', value: 'noindex' }] },
    ]
  },
}

export default nextConfig
