// Test environment. Point TEST_DATABASE_URL at a throwaway database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'mysql://bf:bfpass@127.0.0.1:3306/busfactor'
process.env.APP_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64')
process.env.APP_URL ||= 'https://busfactor.test'
;(process.env as Record<string, string>).NODE_ENV = 'test'
