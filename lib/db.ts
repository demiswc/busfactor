import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from './generated/prisma/client'

/** Prisma CLI wants mysql://, the MariaDB driver wants mariadb:// — accept either. */
function driverUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return url.replace(/^mysql:\/\//, 'mariadb://')
}

const g = globalThis as unknown as { __busfactorDb?: PrismaClient }

function client(): PrismaClient {
  if (!g.__busfactorDb) g.__busfactorDb = new PrismaClient({ adapter: new PrismaMariaDb(driverUrl()) })
  return g.__busfactorDb
}

/** Connects on first use, so `next build` works without a database. */
export const db = new Proxy({} as PrismaClient, {
  get(_t, prop) {
    const c = client()
    const v = Reflect.get(c, prop, c)
    return typeof v === 'function' ? v.bind(c) : v
  },
})
