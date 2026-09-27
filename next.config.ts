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
      { source: '/n/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }, { key: 'X-Robots-Tag', value: 'noindex' }] },
    ]
  },
}

export default nextConfig
