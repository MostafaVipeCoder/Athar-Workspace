import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getMessages, translatePlural } from '../../../i18n/core.js'
import { DUPLICATE_REASONS, EXPERT_SORTS, MERGE_BLOCKERS, MERGE_FIELDS } from '../../../lib/experts.js'
import './experts.i18n.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const sources = [
  ...fs.readdirSync(here).filter((f) => /\.(jsx?|js)$/.test(f) && !/\.test\.|i18n\.js$/.test(f)).map((f) => path.join(here, f)),
  path.join(here, '../../../lib/experts.js'),
  path.join(here, '../../../data/people.js'),
  path.join(here, '../../../data/errors.js'),
]
const used = new Set()
for (const file of sources) {
  const text = fs.readFileSync(file, 'utf8')
  for (const m of text.matchAll(/['"`](experts\.[A-Za-z0-9_.]+)['"`]/g)) used.add(m[1])
}
// the dynamic families (a template literal with ${...}) are enumerated here
for (const r of DUPLICATE_REASONS) used.add(`experts.dup.reason.${r}`)
for (const r of ['mentor', 'provider', 'presenter', 'listed']) used.add(`experts.role.${r}`)
for (const k of ['expert', 'team']) { used.add(`experts.kind.${k}`); used.add(`experts.kind.${k}.long`) }
for (const s of ['new', 'created', 'duplicate', 'invalid']) used.add(`experts.import.status.${s}`)
for (const b of MERGE_BLOCKERS) used.add(`experts.merge.blocker.${b}`)
for (const f of MERGE_FIELDS.filter((x) => !['photo_path', 'linkedin_url', 'website_url', 'email', 'phone'].includes(x))) used.add(`experts.merge.field.${f}`)
for (const s of EXPERT_SORTS) used.add(`experts.sort.${s}`)
for (const k of ['photo', 'email']) for (const v of ['yes', 'no']) used.add(`experts.filter.${k}.${v}`)
for (const s of ['active', 'archived']) used.add(`experts.state.${s}`)
used.delete('experts.dup.reason.') // the prefix of the template above

const en = getMessages('en')
const ar = getMessages('ar')
const vars = (v) => [...new Set([...(typeof v === 'string' ? v : Object.values(v).join(' ')).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort()

describe('experts dictionary', () => {
  it('every key the code uses exists in BOTH languages', () => {
    expect([...used].length).toBeGreaterThan(200)
    const missingEn = [...used].filter((k) => en[k] === undefined)
    const missingAr = [...used].filter((k) => ar[k] === undefined)
    expect(missingEn).toEqual([])
    expect(missingAr).toEqual([])
  })

  it('no entry of the namespace is unused (a dead key is a stale translation)', () => {
    const all = Object.keys(en).filter((k) => k.startsWith('experts.'))
    const unused = all.filter((k) => !used.has(k))
    expect(unused).toEqual([])
  })

  it('both languages define exactly the same keys, the same shape (plural or text) and the same {variables}', () => {
    const enKeys = Object.keys(en).filter((k) => k.startsWith('experts.')).sort()
    const arKeys = Object.keys(ar).filter((k) => k.startsWith('experts.')).sort()
    expect(arKeys).toEqual(enKeys)
    for (const k of enKeys) {
      expect(typeof ar[k], k).toBe(typeof en[k])
      expect(vars(ar[k]), k).toEqual(vars(en[k]))
    }
  })

  it('every plural entry has the categories its language needs (Arabic: zero one two few many other; English: one other)', () => {
    for (const k of Object.keys(en).filter((x) => x.startsWith('experts.') && typeof en[x] === 'object')) {
      expect(Object.keys(en[k]), k).toEqual(expect.arrayContaining(['one', 'other']))
      expect(Object.keys(ar[k]), k).toEqual(expect.arrayContaining(['zero', 'one', 'two', 'few', 'many', 'other']))
    }
  })

  it('Arabic counts agree with their number (0, 1, 2, 3, 11, 100) and use Western digits', () => {
    const pick = (key, n) => translatePlural('ar', key, n)
    expect(pick('experts.count.programs', 0)).toBe('لا برامج')
    expect(pick('experts.count.programs', 1)).toBe('برنامج واحد')
    expect(pick('experts.count.programs', 2)).toBe('برنامجان')
    expect(pick('experts.count.programs', 3)).toBe('3 برامج')
    expect(pick('experts.count.programs', 11)).toBe('11 برنامجًا')
    expect(pick('experts.count.programs', 100)).toBe('100 برنامج')
    expect(pick('experts.count.sessions', 42)).toBe('42 جلسة')
    expect(pick('experts.results', 2)).toBe('تم العثور على خبيرين')
    expect(translatePlural('en', 'experts.count.projects', 1)).toBe('1 project')
    expect(translatePlural('en', 'experts.count.projects', 3)).toBe('3 projects')
    expect(/[٠-٩]/.test(pick('experts.count.sessions', 42))).toBe(false)
  })
})
