import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { getMessages } from '../../i18n/core.js'
import { LINK_KINDS } from '../../lib/alumni.js'
import { MILESTONE_KEYS } from '../../lib/alumniProgress.js'
import { COMPANY_MISSING_SECTION, FOUNDER_MISSING_SECTION } from '../../lib/alumniForms.js'
// every dictionary of the Alumni founder side + the shared blocks (each one is imported by the page / block that needs it)
import './i18n.js'
import './i18n.id.js'
import './i18n.company.js'
import '../../app/pages/founder/alumni.i18n.js'
import '../../app/pages/founder/alumni.profile.i18n.js'
import '../../app/pages/founder/alumni.company.i18n.js'
import '../../app/pages/founder/alumni.notifications.i18n.js'
import '../../app/pages/founder/alumni.opportunities.i18n.js'
import '../../app/pages/founder/alumni.progress.i18n.js'
import '../../app/pages/founder/alumni.home.i18n.js'
import '../../app/pages/alumniAuth.i18n.js'
import '../../app/pages/alumniAuth.login.i18n.js'
import '../../i18n/dict.en.js'
import '../../i18n/dict.ar.js'
import '../../i18n/LanguageProvider.jsx'


/** The dictionary modules a file reaches through its relative imports (each page loads only what it needs: lazy per-page dictionaries). */
function reachableDictionaryKeys(file, seen = new Set()) {
  if (seen.has(file) || !existsSync(file)) return new Set()
  seen.add(file)
  const src = readFileSync(file, 'utf8')
  const keys = new Set()
  if (/registerMessages\(\s*'alumni'/.test(src)) for (const m of src.matchAll(/["']([A-Za-z0-9_.]+)["']\s*:/g)) keys.add(`alumni.${m[1]}`)
  for (const m of src.matchAll(/(?:from|import)\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
    let target = resolve(dirname(file), m[1])
    if (!/\.(jsx?|mjs)$/.test(target)) target += '.js'
    for (const k of reachableDictionaryKeys(target, seen)) keys.add(k)
  }
  return keys
}

const en = getMessages('en')
const ar = getMessages('ar')
const mine = (m) => Object.keys(m).filter((k) => k.startsWith('alumni.'))
const vars = (s) => (typeof s === 'string' ? [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort() : [])

describe('Alumni dictionaries (founder side + shared)', () => {
  it('Arabic and English have the same keys', () => {
    // the manager side registers `alumni.admin.*` in its own modules: only the keys of this side are compared here
    const own = (k) => !k.startsWith('alumni.admin.')
    expect(mine(ar).filter(own).sort()).toEqual(mine(en).filter(own).sort())
  })

  it('placeholders match between the languages; plural entries have the categories the language needs', () => {
    for (const k of mine(en)) {
      const a = en[k]
      const b = ar[k]
      if (typeof a === 'string') expect(vars(b), k).toEqual(vars(a))
      else {
        expect(typeof b, k).toBe('object')
        expect(Object.keys(a), k).toContain('other')
        expect(Object.keys(b), k).toContain('other')
        for (const cat of Object.keys(b)) expect(vars(b[cat]).every((v) => v === 'count'), `${k}.${cat}`).toBe(true)
      }
    }
  })

  it('no empty text', () => {
    for (const k of mine(en)) {
      const check = (v) => (typeof v === 'string' ? v.trim().length > 0 : Object.values(v).every((x) => x.trim().length > 0))
      expect(check(en[k]), `en ${k}`).toBe(true)
      expect(check(ar[k]), `ar ${k}`).toBe(true)
    }
  })

  it('every literal key the founder-side code asks for exists in both languages (no key shows up raw)', () => {
    const root = join(import.meta.dirname, '..', '..')
    const files = [
      ...readdirSync(join(root, 'shared', 'alumni')).filter((f) => /\.(jsx?)$/.test(f) && !/test|fixtures|i18n/.test(f)).map((f) => join(root, 'shared', 'alumni', f)),
      ...readdirSync(join(root, 'app', 'pages', 'founder')).filter((f) => /^(Founder(Profile|Company|CompanyNew|Notifications|Opportunities|Progress)Page|CoFounderInvite|HomeAlumniCards)\.jsx$/.test(f)).map((f) => join(root, 'app', 'pages', 'founder', f)),
      join(root, 'app', 'pages', 'SignupPage.jsx'), join(root, 'app', 'pages', 'FounderInvitePage.jsx'), join(root, 'app', 'pages', 'LoginPage.jsx'),
      join(root, 'app', 'shells', 'FounderShell.jsx'),
      join(root, 'data', 'alumniFounder.js'), join(root, 'data', 'auth.js'), join(root, 'data', 'errors.js'), join(root, 'data', 'alumni.js'),
      join(root, 'lib', 'alumniForms.js'), join(root, 'lib', 'alumniSignup.js'),
    ]
    const missing = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/['"`](alumni\.[A-Za-z0-9_.]+)['"`]/g)) {
        const key = m[1]
        if (/\.$/.test(key)) continue // a prefix built at run time: checked below
        if (!(key in en) || !(key in ar)) missing.push(`${f.slice(root.length)}: ${key}`)
      }
    }
    expect(missing).toEqual([])
  })


  it('each file imports the dictionaries of the keys it asks for (a page never relies on another page having loaded its texts)', () => {
    const root = join(import.meta.dirname, '..', '..')
    const dirs = [join(root, 'shared', 'alumni'), join(root, 'app', 'pages', 'founder')]
    const files = [
      ...dirs.flatMap((d) => readdirSync(d).filter((f) => /^(?!.*(test|fixtures|i18n)).*\.jsx?$/.test(f)).map((f) => join(d, f))),
      join(root, 'app', 'pages', 'SignupPage.jsx'), join(root, 'app', 'pages', 'FounderInvitePage.jsx'), join(root, 'app', 'pages', 'LoginPage.jsx'),
    ]
    const problems = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      if (!/alumni\./.test(src)) continue
      const own = [...src.matchAll(/['"`](alumni\.[A-Za-z0-9_.]+)['"`]/g)].map((m) => m[1]).filter((k) => !/\.$/.test(k))
      // only the files that RENDER text: a data / logic module has no page dictionary to import
      if (!/.jsx$/.test(f)) continue
      const reach = reachableDictionaryKeys(f)
      for (const k of own) if (!reach.has(k)) problems.push(`${f.slice(root.length)} uses ${k} but reaches no dictionary that defines it`)
    }
    expect(problems).toEqual([])
  })

  it('the keys built at run time exist for every value they can take', () => {
    const need = []
    for (const k of Object.values(FOUNDER_MISSING_SECTION).length ? Object.keys(FOUNDER_MISSING_SECTION) : []) need.push(`alumni.common.missing.${k}`)
    for (const k of Object.keys(COMPANY_MISSING_SECTION)) need.push(`alumni.common.missing.${k}`)
    for (const k of LINK_KINDS) need.push(`alumni.common.link.${k}`)
    for (const k of ['revenue_total', 'funding_raised_total', 'employees_total', 'employees_female', 'freelancers', 'traction', 'challenges', 'needs']) need.push(`alumni.common.metric.${k}`)
    for (const k of ['founder', 'manager']) need.push(`alumni.common.source.${k}`)
    for (const k of ['private', 'alumni', 'public']) need.push(`alumni.common.visibility.${k}`)
    for (const k of ['empty', 'digits', 'length', 'century', 'date', 'future', 'governorate']) need.push(`alumni.err.nid.${k}`)
    for (const k of MILESTONE_KEYS) need.push(`alumni.founder.progress.milestone.${k}`)
    for (const k of ['grant', 'investment', 'competition', 'event', 'partnership', 'other']) need.push(`alumni.founder.opp.type.${k}`)
    for (const k of ['applied', 'under_review', 'shortlisted', 'accepted', 'rejected', 'withdrawn']) need.push(`alumni.founder.opp.status.${k}`)
    // every reason the server can name on a field (contract section 4) and every field a refusal can point at
    for (const k of ['too_long', 'unknown', 'unknown_key', 'bad_value', 'bad_url', 'bad_date', 'future', 'required', 'manager_only', 'id_wins', 'parent_mismatch', 'needs_sector', 'requires_closed',
      'exceeds_total', 'out_of_range', 'not_a_number', 'not_your_folder', 'file_missing', 'bad_path', 'already_member', 'use_my_profile', 'closed_vocabulary', 'system_value']) need.push(`alumni.reason.${k}`)
    for (const k of ['name_ar', 'phone', 'linkedin_url', 'self_birth_date', 'self_gender', 'national_id', 'website_url', 'app_url', 'sector', 'subsector', 'stage', 'governorate', 'established_on', 'revenue_total']) need.push(`alumni.field.${k}`)
    // the error tokens of data/errors.js
    for (const k of ['invalid', 'nidInvalid', 'nidConflict', 'companyExists', 'stale', 'notFound', 'rateLimited', 'inUse', 'opportunityClosed']) need.push(`alumni.err.${k}`)
    for (const k of ['emailTaken', 'weakPassword', 'emailInvalid', 'signupDisabled', 'captchaFailed']) need.push(`alumni.auth.${k}`)
    expect(need.filter((k) => !(k in en) || !(k in ar))).toEqual([])
  })
})
