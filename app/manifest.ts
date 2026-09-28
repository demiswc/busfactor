import type { MetadataRoute } from 'next'

/** Lets busfactor be added to a phone's home screen, which iPhones need before they allow notifications. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'busfactor',
    short_name: 'busfactor',
    description: 'Check in every few weeks. If you stop, the people you trust are asked if you are OK.',
    id: '/dashboard',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#f8f7f4',
    theme_color: '#0f766e',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
