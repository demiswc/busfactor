export const APP_NAME = 'busfactor'

/** Public base URL, e.g. https://busfactor.example (no trailing slash). */
export function appUrl(): string {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
}

export const LIMITS = {
  maxNominees: 10,
  maxInstructionsChars: 20_000,
  passwordMin: 10,
  maxMessageBytes: 10 * 1024 * 1024, // attachments + text, before encryption
  maxMessageBoxChars: 30_000_000,    // encrypted and base64-encoded
}
