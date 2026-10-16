import { describe, expect, it } from 'vitest'
import { buildMilestones, milestonePercent, nextMilestone, overallCompleteness, MILESTONE_KEYS } from './alumniProgress.js'

const company = (over = {}) => ({ id: 'c1', completeness: { percent: 80, missing: ['description', 'annual_update'] }, latest_snapshot_year: null, ...over })
const profile = (over = {}) => ({ founder: { completeness: { percent: 75, missing: ['education_status'] } }, companies: [company()], ...over })

describe('buildMilestones: only real data decides', () => {
  it('a brand new founder has the account only', () => {
    const m = buildMilestones({ profile: { founder: { completeness: { percent: 25, missing: [] } }, companies: [] }, programs: [], certificates: [] })
    expect(m.map((x) => x.key)).toEqual(['account', 'profile', 'company', 'companyProfile', 'annualUpdate', 'program', 'certificate'])
    expect(m.filter((x) => x.done).map((x) => x.key)).toEqual(['account'])
    expect(m.find((x) => x.key === 'company').to).toBe('/alumni/founder/company/new')
    expect(milestonePercent(m)).toBe(14)
  })
  it('the company profile ignores the yearly update; the update has its own milestone', () => {
    const m = buildMilestones({ profile: profile({ companies: [company({ completeness: { percent: 90, missing: ['annual_update'] } })] }), programs: [], certificates: [] })
    expect(m.find((x) => x.key === 'companyProfile').done).toBe(true)
    expect(m.find((x) => x.key === 'annualUpdate').done).toBe(false)
    expect(m.find((x) => x.key === 'annualUpdate').to).toBe('/alumni/founder/company/c1#metrics')
  })
  it('every company must be complete (one incomplete company keeps the milestone open)', () => {
    const m = buildMilestones({
      profile: profile({ companies: [company({ completeness: { percent: 100, missing: [] } }), company({ id: 'c2', completeness: { percent: 70, missing: ['sector'] } })] }),
      programs: [], certificates: [],
    })
    expect(m.find((x) => x.key === 'companyProfile').done).toBe(false)
    expect(m.find((x) => x.key === 'annualUpdate').done).toBe(true)
  })
  it('a withdrawn program is not a joined program; a certificate counts when the founder holds one', () => {
    const base = { profile: profile(), certificates: [] }
    expect(buildMilestones({ ...base, programs: [{ status: 'withdrawn' }] }).find((x) => x.key === 'program').done).toBe(false)
    expect(buildMilestones({ ...base, programs: [{ status: 'withdrawn' }, { status: 'accepted' }] }).find((x) => x.key === 'program').done).toBe(true)
    expect(buildMilestones({ ...base, programs: [], certificates: [{ certificate_id: 'x' }] }).find((x) => x.key === 'certificate').done).toBe(true)
  })
  it('everything done = 100 % and no next step', () => {
    const m = buildMilestones({
      profile: { founder: { completeness: { percent: 100, missing: [] } }, companies: [company({ completeness: { percent: 100, missing: [] } })] },
      programs: [{ status: 'attended' }], certificates: [{ certificate_id: 'x' }],
    })
    expect(milestonePercent(m)).toBe(100)
    expect(nextMilestone(m)).toBeNull()
  })
  it('tolerates missing payloads', () => {
    expect(milestonePercent(buildMilestones({}))).toBe(14)
    expect(nextMilestone(buildMilestones({}))?.key).toBe('profile')
  })
})

describe('overallCompleteness', () => {
  it('weights the founder (4 items) and each company (10 items)', () => {
    expect(overallCompleteness(profile())).toBe(Math.round((75 * 4 + 80 * 10) / 14))
    expect(overallCompleteness({ founder: { completeness: { percent: 50 } }, companies: [] })).toBe(50)
    expect(overallCompleteness({})).toBeNull()
  })
})
