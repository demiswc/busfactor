import type { MetadataRoute } from 'next'
import { appUrl } from '@/lib/config'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: ['/', '/privacy', '/terms', '/signup', '/login'], disallow: ['/api/', '/dashboard', '/settings', '/n/', '/c', '/verify', '/reset', '/stats'] }],
    sitemap: `${appUrl()}/sitemap.xml`,
    host: appUrl(),
  }
}
