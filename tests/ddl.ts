/**
 * Test helper: builds MySQL DDL straight from prisma/schema.prisma, so the test database always
 * matches the real schema. (Production uses `npx prisma db push`; this avoids needing Prisma's
 * migration engine binary in CI or sandboxes.)
 */
import { readFileSync } from 'fs'
import { join } from 'path'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const wasm = require('@prisma/prisma-schema-wasm')

type Field = {
  name: string; kind: string; isRequired: boolean; isUnique: boolean; isId: boolean; type: string
  nativeType: [string, string[]] | null; hasDefaultValue: boolean; default?: unknown; isUpdatedAt: boolean
  relationFromFields?: string[]; relationToFields?: string[]; relationOnDelete?: string
}
type Model = { name: string; dbName: string | null; fields: Field[]; uniqueFields: string[][] }

function colType(f: Field): string {
  if (f.nativeType) {
    const [t, args] = f.nativeType
    return ({ Text: 'TEXT', MediumText: 'MEDIUMTEXT', LongText: 'LONGTEXT', VarChar: `VARCHAR(${args[0]})` } as Record<string, string>)[t] ?? t
  }
  return ({ String: 'VARCHAR(191)', Int: 'INT', Boolean: 'TINYINT(1)', DateTime: 'DATETIME(3)' } as Record<string, string>)[f.type]
}

function colDefault(f: Field): string {
  const d = f.default as { name?: string } | string | number | boolean | undefined
  if (d === undefined || (typeof d === 'object' && d?.name === 'cuid')) return ''
  if (typeof d === 'object' && d?.name === 'now') return ' DEFAULT CURRENT_TIMESTAMP(3)'
  if (typeof d === 'boolean') return ` DEFAULT ${d ? 1 : 0}`
  if (typeof d === 'number') return ` DEFAULT ${d}`
  if (typeof d === 'string') return ` DEFAULT '${d.replace(/'/g, "''")}'`
  return ''
}

export function buildDdl(): string[] {
  const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8')
  const dmmf = JSON.parse(wasm.get_dmmf(JSON.stringify({ prismaSchema: schema })))
  const models: Model[] = dmmf.datamodel.models
  const table = (name: string) => { const m = models.find(x => x.name === name)!; return m.dbName ?? m.name }
  const creates: string[] = []
  const fks: string[] = []
  for (const m of models) {
    const t = m.dbName ?? m.name
    const cols: string[] = []
    for (const f of m.fields) {
      if (f.kind === 'object') {
        if (f.relationFromFields?.length) {
          fks.push(`ALTER TABLE \`${t}\` ADD FOREIGN KEY (\`${f.relationFromFields[0]}\`) REFERENCES \`${table(f.type)}\`(\`${f.relationToFields![0]}\`) ON DELETE ${f.relationOnDelete === 'Cascade' ? 'CASCADE' : 'RESTRICT'}`)
        }
        continue
      }
      let c = `\`${f.name}\` ${colType(f)} ${f.isRequired ? 'NOT NULL' : 'NULL'}${colDefault(f)}`
      if (f.isId) c += ' PRIMARY KEY'
      else if (f.isUnique) c += ' UNIQUE'
      cols.push(c)
    }
    for (const u of m.uniqueFields) cols.push(`UNIQUE (${u.map(x => `\`${x}\``).join(', ')})`)
    creates.push(`CREATE TABLE \`${t}\` (${cols.join(', ')})`)
  }
  const drops = `DROP TABLE IF EXISTS ${models.map(m => `\`${m.dbName ?? m.name}\``).join(', ')}`
  return ['SET FOREIGN_KEY_CHECKS=0', drops, 'SET FOREIGN_KEY_CHECKS=1', ...creates, ...fks]
}

if (require.main === module) console.log(buildDdl().join(';\n') + ';')
