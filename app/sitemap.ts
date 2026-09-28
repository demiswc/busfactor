import type { MetadataRoute } from 'next'
import { appUrl } from '@/lib/config'

export default function sitemap(): MetadataRoute.Sitemap {
  const u = appUrl()
  return [
    { url: `${u}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${u}/signup`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${u}/login`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${u}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${u}/terms`, changeFrequency: 'yearly', priority: 0.3 },
  ]
}
