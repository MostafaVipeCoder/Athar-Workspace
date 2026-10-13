/**
 * The ONE matching algorithm of the Mentoring Distribution node (design 01 section 3.7 / decision 01-7; replaces the three as-is
 * generators of docs/05 section 4.4 and their bugs: unseeded `Math.random() - 0.5` shuffle, greedy mentor-order bias, per-mentor windows
 * honoured only by "regenerate", `max_slots` ignored, locked days wiped by a full generate).
 *
 * Pure and DETERMINISTIC given a seed (no Date, no Math.random, no I/O) so it is unit-tested and a result can be reproduced from the
 * stored seed. It produces the cells of the timetable (day x slot x mentor -> company | null) for the TARGET days only:
 *
 *  - locked days are never targets (their sessions only feed the pairing history and the company load);
 *  - scope 'all'      regenerates every target day from scratch (existing sessions of those days are discarded);
 *  - scope 'unlocked' keeps the manual overrides ("pins") of the target days as fixed cells and fills around them;
 *  - one cell exists for every (slot, mentor) where the mentor is on that day, inside their window, on an allowed day and under
 *    their per-day maximum; a company is in at most one room per slot; a mentor never meets the same company twice in a day;
 *  - with `uniquePairing` a (mentor, company) pair is NEVER repeated across the node (history = locked/untargeted days + pins);
 *    without it, repeats across days only cost extra (the cost model prefers fresh pairs);
 *  - each slot is ONE optimal assignment (Hungarian algorithm), not a greedy pass: it maximises the number of filled cells first, then
 *    fairness (companies with fewer meetings so far first, mentors with fewer filled cells first), then a seeded jitter that varies
 *    the pairing between seeds;
 *  - several attempts with derived seeds run and the best is kept (fewest unmatched cells, then most even company load): still
 *    deterministic for a given seed;
 *  - every cell that stays empty is EXPLAINED (`reason`).
 */

// ---------------------------------------------------------------- seeded PRNG
/** mulberry32: small, fast, well distributed; returns floats in [0, 1). */
export function mulberry32(seed) {
  let a = (Number(seed) >>> 0) || 0x9e3779b9
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------- assignment problem
/**
 * Minimum-cost assignment of n rows to m >= n columns (Hungarian algorithm with potentials, O(n^2 m)).
 * `cost[i][j]` finite numbers. Returns `assign[i] = column`.
 */
export function hungarian(cost) {
  const n = cost.length
  if (n === 0) return []
  const m = cost[0].length
  if (m < n) throw new Error('hungarian: needs at least as many columns as rows')
  const INF = Number.POSITIVE_INFINITY
  const u = new Array(n + 1).fill(0)
  const v = new Array(m + 1).fill(0)
  const p = new Array(m + 1).fill(0) // p[j] = row assigned to column j (1-based)
  const way = new Array(m + 1).fill(0)
  for (let i = 1; i <= n; i += 1) {
    p[0] = i
    let j0 = 0
    const minv = new Array(m + 1).fill(INF)
    const used = new Array(m + 1).fill(false)
    do {
      used[j0] = true
      const i0 = p[j0]
      let delta = INF
      let j1 = 0
      for (let j = 1; j <= m; j += 1) {
        if (used[j]) continue
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
        if (cur < minv[j]) {
          minv[j] = cur
          way[j] = j0
        }
        if (minv[j] < delta) {
          delta = minv[j]
          j1 = j
        }
      }
      for (let j = 0; j <= m; j += 1) {
        if (used[j]) {
          u[p[j]] += delta
          v[j] -= delta
        } else {
          minv[j] -= delta
        }
      }
      j0 = j1
    } while (p[j0] !== 0)
    do {
      const j1 = way[j0]
      p[j0] = p[j1]
      j0 = j1
    } while (j0 !== 0)
  }
  const assign = new Array(n).fill(-1)
  for (let j = 1; j <= m; j += 1) if (p[j] !== 0) assign[p[j] - 1] = j - 1
  return assign
}

// ---------------------------------------------------------------- helpers
export const pairKey = (mentorId, companyId) => `${mentorId}|${companyId}`
const cellKey = (dayId, slotIndex, mentorId) => `${dayId}|${slotIndex}|${mentorId}`

const HIGH = 1e5 // leaving a cell empty costs more than any real assignment, so the number of filled cells is maximised first
const MEETING_WEIGHT = 10 // fairness: companies with fewer meetings so far are preferred
const REPEAT_PENALTY = 40 // non-unique mode: a pair that met before costs extra (prefers fresh pairs)
const JITTER = 3 // < MEETING_WEIGHT: the seed only reorders companies with the same load

/** Resolve a mentor's availability for a given day/slot. `rule` = { days: number[]|null, maxSlots, from, to } in minutes of day. */
export function mentorAvailableAt(rule, day, slotIndex) {
  if (!rule) return true
  if (Array.isArray(rule.days) && !rule.days.includes(day.dayIndex)) return false
  const start = day.startMinutes + slotIndex * (day.slotMinutes + day.gapMinutes)
  const end = start + day.slotMinutes
  if (rule.from !== null && rule.from !== undefined && start < rule.from) return false
  if (rule.to !== null && rule.to !== undefined && end > rule.to) return false
  return true
}

function cloneCounts(map) {
  return new Map(map)
}

/**
 * @param {object} input
 * @param {Array<{id,dayIndex,slots,startMinutes,slotMinutes,gapMinutes,mentorIds:string[],locked?:boolean}>} input.days
 * @param {Record<string,{days:number[]|null,maxSlots:number|null,from:number|null,to:number|null}>} [input.rules]
 * @param {string[]} input.companyIds
 * @param {Array<{dayId,slotIndex,mentorId,companyId:string|null,manual?:boolean}>} [input.existing]  current sessions (history / pins)
 * @param {boolean} [input.uniquePairing=true]
 * @param {number} [input.seed=1]
 * @param {'all'|'unlocked'} [input.scope='all']
 * @param {string[]} [input.targetDayIds]   restrict to these days (default: every unlocked day)
 * @param {number} [input.attempts=8]
 */
export function generateDistribution(input) {
  const {
    days = [],
    rules = {},
    companyIds = [],
    existing = [],
    uniquePairing = true,
    seed = 1,
    scope = 'all',
    targetDayIds = null,
    attempts = 8,
  } = input
  const dayById = new Map(days.map((d) => [d.id, d]))
  const targets = days
    .filter((d) => !d.locked && (!targetDayIds || targetDayIds.includes(d.id)))
    .sort((a, b) => a.dayIndex - b.dayIndex)
  const targetIds = new Set(targets.map((d) => d.id))
  const companies = [...new Set(companyIds)].sort()

  // ---- base state: everything that stays (untargeted/locked days, and the pins of the target days)
  const base = {
    meetings: new Map(), // company -> sessions so far
    filledTotal: new Map(), // mentor -> sessions with a company so far
    pairs: new Map(), // pairKey -> count
    today: new Map(), // `${day}|${mentor}` -> Set(company)
    busy: new Map(), // `${day}|${slot}` -> Set(company)
    filledDay: new Map(), // `${day}|${mentor}` -> count
  }
  const pinned = []
  const droppedPins = []
  const pinnedCells = new Set()
  const bump = (map, k, by = 1) => map.set(k, (map.get(k) ?? 0) + by)
  const addToSet = (map, k, v) => {
    if (!map.has(k)) map.set(k, new Set())
    map.get(k).add(v)
  }
  const register = (s) => {
    if (!s.companyId) return
    bump(base.meetings, s.companyId)
    bump(base.filledTotal, s.mentorId)
    bump(base.pairs, pairKey(s.mentorId, s.companyId))
    addToSet(base.today, `${s.dayId}|${s.mentorId}`, s.companyId)
    addToSet(base.busy, `${s.dayId}|${s.slotIndex}`, s.companyId)
    bump(base.filledDay, `${s.dayId}|${s.mentorId}`)
  }
  for (const s of existing) {
    const day = dayById.get(s.dayId)
    if (!day) continue
    if (!targetIds.has(s.dayId)) {
      register(s)
    } else if (scope === 'unlocked' && s.manual) {
      const valid = day.mentorIds.includes(s.mentorId) && s.slotIndex >= 0 && s.slotIndex < day.slots && !pinnedCells.has(cellKey(s.dayId, s.slotIndex, s.mentorId))
      if (valid) {
        pinned.push(s)
        pinnedCells.add(cellKey(s.dayId, s.slotIndex, s.mentorId))
        register(s)
      } else droppedPins.push(s)
    }
  }

  const runAttempt = (attemptSeed) => {
    const rng = mulberry32(attemptSeed)
    const st = {
      meetings: cloneCounts(base.meetings),
      filledTotal: cloneCounts(base.filledTotal),
      pairs: cloneCounts(base.pairs),
      today: new Map([...base.today].map(([k, v]) => [k, new Set(v)])),
      busy: new Map([...base.busy].map(([k, v]) => [k, new Set(v)])),
      filledDay: cloneCounts(base.filledDay),
    }
    const cells = []
    const unmatched = []
    for (const day of targets) {
      const mentors = [...day.mentorIds].sort()
      for (let slot = 0; slot < day.slots; slot += 1) {
        const rows = mentors.filter((m) => {
          if (pinnedCells.has(cellKey(day.id, slot, m))) return false
          const rule = rules[m]
          if (!mentorAvailableAt(rule, day, slot)) return false
          if (rule?.maxSlots && (st.filledDay.get(`${day.id}|${m}`) ?? 0) >= rule.maxSlots) return false
          return true
        })
        if (rows.length === 0) continue
        const busy = st.busy.get(`${day.id}|${slot}`) ?? new Set()
        const free = companies.filter((c) => !busy.has(c))
        const nRows = rows.length
        const nCols = free.length + nRows
        const cost = rows.map((m) => {
          const rowCost = new Array(nCols)
          for (let j = 0; j < free.length; j += 1) {
            const c = free[j]
            const metBefore = st.pairs.get(pairKey(m, c)) ?? 0
            const metToday = st.today.get(`${day.id}|${m}`)?.has(c)
            if (metToday || (uniquePairing && metBefore > 0)) rowCost[j] = 1e9
            else rowCost[j] = (st.meetings.get(c) ?? 0) * MEETING_WEIGHT + metBefore * REPEAT_PENALTY + rng() * JITTER
          }
          // leaving this mentor empty: cheaper for mentors that already have many sessions (so the under-filled ones are served first)
          const emptyCost = HIGH - Math.min(st.filledTotal.get(m) ?? 0, 5000) + rng() * 0.5
          for (let j = free.length; j < nCols; j += 1) rowCost[j] = emptyCost
          return rowCost
        })
        const assign = hungarian(cost)
        const taken = new Set()
        rows.forEach((m, i) => {
          const j = assign[i]
          const chosen = j >= 0 && j < free.length && cost[i][j] < 1e9 ? free[j] : null
          if (chosen) {
            taken.add(chosen)
            cells.push({ dayId: day.id, slotIndex: slot, mentorId: m, companyId: chosen, manual: false })
            bump(st.meetings, chosen)
            bump(st.filledTotal, m)
            bump(st.pairs, pairKey(m, chosen))
            addToSet(st.today, `${day.id}|${m}`, chosen)
            addToSet(st.busy, `${day.id}|${slot}`, chosen)
            bump(st.filledDay, `${day.id}|${m}`)
          } else {
            cells.push({ dayId: day.id, slotIndex: slot, mentorId: m, companyId: null, manual: false })
          }
        })
        // explain the empty cells of this slot (after the whole slot is settled)
        const stillFree = free.filter((c) => !taken.has(c))
        for (const cell of cells.filter((x) => x.dayId === day.id && x.slotIndex === slot && !x.companyId)) {
          let reason
          if (companies.length === 0) reason = 'no_companies'
          else if (stillFree.length === 0) reason = 'not_enough_companies'
          else reason = 'already_met' // every company still free in this slot already met this mentor (today, or ever with unique pairing)
          cell.reason = reason
          unmatched.push({ dayId: cell.dayId, slotIndex: cell.slotIndex, mentorId: cell.mentorId, reason })
        }
      }
    }
    const loads = companies.map((c) => st.meetings.get(c) ?? 0)
    const spread = loads.reduce((a, x) => a + x * x, 0)
    return { cells, unmatched, score: unmatched.length * 1e9 + spread, loads, st }
  }

  let best = null
  const tries = Math.max(1, Math.floor(attempts))
  for (let k = 0; k < tries; k += 1) {
    const r = runAttempt((Number(seed) + k * 7919) >>> 0)
    if (!best || r.score < best.score) best = r
  }

  const sessions = best.cells.map((c) => ({ dayId: c.dayId, slotIndex: c.slotIndex, mentorId: c.mentorId, companyId: c.companyId, manual: c.manual }))
  const loads = best.loads
  return {
    sessions,
    pinned,
    droppedPins,
    dayIds: targets.map((d) => d.id),
    unmatched: best.unmatched,
    stats: {
      cells: sessions.length,
      filled: sessions.filter((s) => s.companyId).length,
      unmatched: best.unmatched.length,
      attempts: tries,
      seed: Number(seed) >>> 0,
      minMeetings: loads.length ? Math.min(...loads) : 0,
      maxMeetings: loads.length ? Math.max(...loads) : 0,
    },
  }
}

/** Short summary of why cells stayed empty: { reason: count } (for the explain panel). */
export function summarizeUnmatched(unmatched) {
  const out = {}
  for (const u of unmatched) out[u.reason] = (out[u.reason] ?? 0) + 1
  return out
}
