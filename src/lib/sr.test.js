import { describe, it, expect, vi } from 'vitest'
import {
  isDue, formatDue, draftValid, advanceBucket, bucketSessions,
  syncCards, shuffle, encodeWAV, DEFAULT_SETTINGS, CRITERIA, getCriteria,
  parseTags, itemTags, isCardPinned, cardMatchesTag, sessionPool, buildQueue,
  dayKey, streakDays, weeklyStats,
  computeBadges, bucketTransitions, scoreColor,
} from './sr.js'

describe('isDue', () => {
  it('returns true when sessionsUntilDue is 0', () => {
    expect(isDue({ sessionsUntilDue: 0 })).toBe(true)
  })
  it('returns true when sessionsUntilDue is undefined', () => {
    expect(isDue({})).toBe(true)
  })
  it('returns false when sessionsUntilDue > 0', () => {
    expect(isDue({ sessionsUntilDue: 1 })).toBe(false)
    expect(isDue({ sessionsUntilDue: 3 })).toBe(false)
  })
})

describe('formatDue', () => {
  it('returns "due now" for 0 or falsy', () => {
    expect(formatDue(0)).toBe('due now')
    expect(formatDue(null)).toBe('due now')
    expect(formatDue(undefined)).toBe('due now')
  })
  it('returns "next session" for 1', () => {
    expect(formatDue(1)).toBe('next session')
  })
  it('returns "in N sessions" for N > 1', () => {
    expect(formatDue(2)).toBe('in 2 sessions')
    expect(formatDue(5)).toBe('in 5 sessions')
  })
})

describe('draftValid', () => {
  it('returns truthy when both composer and title are set', () => {
    expect(draftValid({ composer: 'Bach', title: 'Suite No. 1', detail: '' })).toBeTruthy()
  })
  it('returns falsy when composer is empty', () => {
    expect(draftValid({ composer: '', title: 'Suite No. 1', detail: '' })).toBeFalsy()
    expect(draftValid({ composer: '   ', title: 'Suite No. 1', detail: '' })).toBeFalsy()
  })
  it('returns falsy when title is empty', () => {
    expect(draftValid({ composer: 'Bach', title: '', detail: '' })).toBeFalsy()
    expect(draftValid({ composer: 'Bach', title: '  ', detail: '' })).toBeFalsy()
  })
})

describe('advanceBucket', () => {
  // hot: up=warm, dn=null (floor)
  it('promotes hot → warm on 4/4', () => {
    expect(advanceBucket('hot', 4)).toBe('warm')
  })
  it('keeps hot on 3/4', () => {
    expect(advanceBucket('hot', 3)).toBe('hot')
  })
  it('keeps hot on ≤2 (no lower bucket)', () => {
    expect(advanceBucket('hot', 2)).toBe('hot')
    expect(advanceBucket('hot', 0)).toBe('hot')
  })

  // warm: up=cold, dn=hot
  it('promotes warm → cold on 4/4', () => {
    expect(advanceBucket('warm', 4)).toBe('cold')
  })
  it('keeps warm on 3/4', () => {
    expect(advanceBucket('warm', 3)).toBe('warm')
  })
  it('demotes warm → hot on ≤2', () => {
    expect(advanceBucket('warm', 2)).toBe('hot')
    expect(advanceBucket('warm', 0)).toBe('hot')
  })

  // cold: up=null (ceiling), dn=warm
  it('keeps cold on 4/4 (no higher bucket)', () => {
    expect(advanceBucket('cold', 4)).toBe('cold')
  })
  it('keeps cold on 3/4', () => {
    expect(advanceBucket('cold', 3)).toBe('cold')
  })
  it('demotes cold → warm on ≤2', () => {
    expect(advanceBucket('cold', 2)).toBe('warm')
    expect(advanceBucket('cold', 0)).toBe('warm')
  })
})

describe('bucketSessions', () => {
  it('returns built-in defaults when settings are missing', () => {
    expect(bucketSessions('hot', undefined)).toBe(1)
    expect(bucketSessions('warm', null)).toBe(2)
    expect(bucketSessions('cold', {})).toBe(3)
  })
  it('returns defaults from DEFAULT_SETTINGS', () => {
    expect(bucketSessions('hot', DEFAULT_SETTINGS)).toBe(1)
    expect(bucketSessions('warm', DEFAULT_SETTINGS)).toBe(2)
    expect(bucketSessions('cold', DEFAULT_SETTINGS)).toBe(3)
  })
  it('honors user overrides', () => {
    const s = { intervals: { hot: 2, warm: 4, cold: 7 } }
    expect(bucketSessions('hot', s)).toBe(2)
    expect(bucketSessions('warm', s)).toBe(4)
    expect(bucketSessions('cold', s)).toBe(7)
  })
  it('clamps to 1–9 and falls back on invalid values', () => {
    expect(bucketSessions('hot', { intervals: { hot: 99 } })).toBe(9)
    expect(bucketSessions('hot', { intervals: { hot: 0 } })).toBe(1)
    expect(bucketSessions('hot', { intervals: { hot: -3 } })).toBe(1)
    expect(bucketSessions('warm', { intervals: { warm: 'abc' } })).toBe(2)
  })
})

describe('syncCards', () => {
  const makeItem = (id) => ({ id, composer: 'X', title: 'Y', detail: '' })
  const makeCard = (id, bucket = 'hot') => ({ id, bucket, sessionsUntilDue: 0, history: [] })

  it('creates new cards for items with no existing card', () => {
    const result = syncCards([makeItem('a')], [])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'a', bucket: 'hot', sessionsUntilDue: 0 })
  })

  it('preserves existing card state', () => {
    const card = { id: 'a', bucket: 'cold', sessionsUntilDue: 2, history: [{ date: 'x' }] }
    const result = syncCards([makeItem('a')], [card])
    expect(result[0].bucket).toBe('cold')
    expect(result[0].sessionsUntilDue).toBe(2)
    expect(result[0].history).toHaveLength(1)
  })

  it('removes cards whose item was deleted', () => {
    const result = syncCards([makeItem('a')], [makeCard('a'), makeCard('b')])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('a')
  })

  it('handles empty items list', () => {
    expect(syncCards([], [makeCard('a')])).toHaveLength(0)
  })
})

describe('shuffle', () => {
  it('returns an array of the same length', () => {
    const arr = [1, 2, 3, 4, 5]
    expect(shuffle(arr)).toHaveLength(arr.length)
  })

  it('contains the same elements', () => {
    const arr = [1, 2, 3, 4, 5]
    expect(shuffle(arr).sort()).toEqual([...arr].sort())
  })

  it('does not mutate the original array', () => {
    const arr = [1, 2, 3]
    shuffle(arr)
    expect(arr).toEqual([1, 2, 3])
  })
})

describe('encodeWAV', () => {
  const chunk = (vals) => new Float32Array(vals)

  it('returns a Blob with audio/wav type', () => {
    const blob = encodeWAV([chunk([0, 0.5])], [chunk([0, -0.5])], 48000)
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('audio/wav')
  })

  it('has correct byte length: 44-byte header + n*2*2 PCM bytes', () => {
    const n = 4
    const blob = encodeWAV([chunk(new Array(n).fill(0))], [chunk(new Array(n).fill(0))], 48000)
    expect(blob.size).toBe(44 + n * 2 * 2)
  })

  it('clamps float values to [-1, 1] without throwing', () => {
    expect(() => encodeWAV([chunk([2.0, -3.0])], [chunk([1.5, -1.5])], 44100)).not.toThrow()
  })
})

describe('getCriteria', () => {
  it('falls back to CRITERIA for undefined settings', () => {
    expect(getCriteria(undefined)).toBe(CRITERIA)
  })

  it('falls back to CRITERIA when settings.criteria is empty array', () => {
    expect(getCriteria({ criteria: [] })).toBe(CRITERIA)
  })

  it('falls back to CRITERIA when all entries have empty labels', () => {
    expect(getCriteria({ criteria: [{ id: 'a', label: '' }, { id: 'b', label: '   ' }] })).toBe(CRITERIA)
  })

  it('returns custom list when entries have valid labels', () => {
    const custom = [{ id: 'x', label: 'Bow Speed' }, { id: 'y', label: 'Vibrato' }]
    const result = getCriteria({ criteria: custom })
    expect(result).toHaveLength(2)
    expect(result[0].label).toBe('Bow Speed')
  })

  it('filters out empty-label entries', () => {
    const custom = [{ id: 'a', label: 'Good' }, { id: 'b', label: '' }, { id: 'c', label: 'Also Good' }]
    const result = getCriteria({ criteria: custom })
    expect(result).toHaveLength(2)
    expect(result.map((c) => c.label)).toEqual(['Good', 'Also Good'])
  })

  it('caps at 6 entries', () => {
    const custom = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, label: `Criterion ${i}` }))
    expect(getCriteria({ criteria: custom })).toHaveLength(6)
  })
})

describe('parseTags', () => {
  it('splits and trims comma-separated tags', () => {
    expect(parseTags('audition, etudes, scales')).toEqual(['audition', 'etudes', 'scales'])
  })
  it('deduplicates tags', () => {
    expect(parseTags('a, a, b')).toEqual(['a', 'b'])
  })
  it('drops empty entries', () => {
    expect(parseTags('a,,  ,b')).toEqual(['a', 'b'])
  })
  it('handles undefined input', () => {
    expect(parseTags(undefined)).toEqual([])
  })
  it('returns empty array for empty string', () => {
    expect(parseTags('')).toEqual([])
  })
})

describe('itemTags', () => {
  it('returns the tags array when present', () => {
    expect(itemTags({ tags: ['a', 'b'] })).toEqual(['a', 'b'])
  })
  it('returns [] when tags is missing', () => {
    expect(itemTags({ composer: 'Bach' })).toEqual([])
  })
  it('returns [] when item is undefined', () => {
    expect(itemTags(undefined)).toEqual([])
  })
  it('returns [] when tags is not an array', () => {
    expect(itemTags({ tags: 'a,b' })).toEqual([])
  })
})

describe('isCardPinned', () => {
  const items = [{ id: 'a', pinned: true }, { id: 'b', pinned: false }, { id: 'c' }]

  it('returns true for a pinned item', () => {
    expect(isCardPinned({ id: 'a' }, items)).toBe(true)
  })
  it('returns false for an unpinned item', () => {
    expect(isCardPinned({ id: 'b' }, items)).toBe(false)
  })
  it('returns false when pinned field is absent', () => {
    expect(isCardPinned({ id: 'c' }, items)).toBe(false)
  })
  it('returns false when card id not found in items', () => {
    expect(isCardPinned({ id: 'z' }, items)).toBe(false)
  })
})

describe('cardMatchesTag', () => {
  const items = [{ id: 'a', tags: ['audition', 'etudes'] }, { id: 'b', tags: ['scales'] }]

  it('returns true when tag is null (no filter)', () => {
    expect(cardMatchesTag({ id: 'a' }, items, null)).toBe(true)
  })
  it('returns true when tag matches item tags', () => {
    expect(cardMatchesTag({ id: 'a' }, items, 'audition')).toBe(true)
  })
  it('returns false when tag does not match', () => {
    expect(cardMatchesTag({ id: 'a' }, items, 'scales')).toBe(false)
  })
  it('returns false when item has no tags', () => {
    expect(cardMatchesTag({ id: 'b' }, items, 'audition')).toBe(false)
  })
})

describe('sessionPool', () => {
  const mkItem = (id, tags = [], pinned = false) => ({ id, tags, pinned })
  const mkCard = (id, due = true) => ({ id, sessionsUntilDue: due ? 0 : 2 })

  it('includes due unpinned cards', () => {
    const items = [mkItem('a')]
    const cards = [mkCard('a', true)]
    expect(sessionPool(cards, items, null)).toHaveLength(1)
  })
  it('includes pinned-but-not-due cards', () => {
    const items = [mkItem('a', [], true)]
    const cards = [mkCard('a', false)]
    expect(sessionPool(cards, items, null)).toHaveLength(1)
  })
  it('excludes non-due non-pinned cards', () => {
    const items = [mkItem('a')]
    const cards = [mkCard('a', false)]
    expect(sessionPool(cards, items, null)).toHaveLength(0)
  })
  it('excludes cards that do not match the tag filter', () => {
    const items = [mkItem('a', ['etudes']), mkItem('b', ['scales'])]
    const cards = [mkCard('a', true), mkCard('b', true)]
    const pool = sessionPool(cards, items, 'etudes')
    expect(pool).toHaveLength(1)
    expect(pool[0].id).toBe('a')
  })
})

describe('buildQueue', () => {
  const mkItem = (id, pinned = false) => ({ id, tags: [], pinned })
  const mkCard = (id, due = true) => ({ id, sessionsUntilDue: due ? 0 : 2 })

  it('includes all pinned cards even when length is smaller', () => {
    const items = [mkItem('a', true), mkItem('b', true), mkItem('c', true)]
    const cards = [mkCard('a', true), mkCard('b', true), mkCard('c', true)]
    const q = buildQueue(cards, items, null, 1)
    expect(q).toHaveLength(3)
  })
  it('respects length limit for unpinned cards', () => {
    const items = [mkItem('a'), mkItem('b'), mkItem('c')]
    const cards = [mkCard('a', true), mkCard('b', true), mkCard('c', true)]
    const q = buildQueue(cards, items, null, 2)
    expect(q).toHaveLength(2)
  })
  it('only returns cards from the session pool', () => {
    const items = [mkItem('a'), mkItem('b')]
    const cards = [mkCard('a', true), mkCard('b', false)]
    const q = buildQueue(cards, items, null, 5)
    expect(q.map((c) => c.id)).toContain('a')
    expect(q.map((c) => c.id)).not.toContain('b')
  })
})

describe('advanceBucket proportional', () => {
  // total = 6
  it('promotes on 5/6 (>0.75)', () => {
    expect(advanceBucket('hot', 5, 6)).toBe('warm')
  })
  it('keeps unchanged on 4/6 (>0.5, ≤0.75)', () => {
    expect(advanceBucket('hot', 4, 6)).toBe('hot')
  })
  it('demotes on 3/6 (≤0.5)', () => {
    expect(advanceBucket('warm', 3, 6)).toBe('hot')
  })

  // total = 2
  it('promotes on 2/2 (>0.75)', () => {
    expect(advanceBucket('hot', 2, 2)).toBe('warm')
  })
  it('demotes on 1/2 (=0.5, ≤0.5)', () => {
    expect(advanceBucket('warm', 1, 2)).toBe('hot')
  })

  // total = 1
  it('promotes on 1/1 (>0.75)', () => {
    expect(advanceBucket('hot', 1, 1)).toBe('warm')
  })
  it('demotes on 0/1 (=0, ≤0.5)', () => {
    expect(advanceBucket('warm', 0, 1)).toBe('hot')
  })
})

describe('dayKey', () => {
  it('formats local date as YYYY-MM-DD', () => {
    expect(dayKey(new Date(2025, 0, 5))).toBe('2025-01-05')   // Jan 5
    expect(dayKey(new Date(2025, 11, 31))).toBe('2025-12-31') // Dec 31
    expect(dayKey(new Date(2024, 1, 29))).toBe('2024-02-29')  // leap day
  })
})

describe('streakDays', () => {
  const mkSessions = (...dateStrings) => dateStrings.map((d) => ({ date: d }))

  it('returns 0 for empty sessions', () => {
    expect(streakDays([], new Date(2025, 5, 9))).toBe(0)
  })

  it('returns 1 for a session today only', () => {
    const now = new Date(2025, 5, 9)
    const sessions = mkSessions(new Date(2025, 5, 9).toISOString())
    expect(streakDays(sessions, now)).toBe(1)
  })

  it('returns 2 for sessions today and yesterday', () => {
    const now = new Date(2025, 5, 9)
    const sessions = mkSessions(
      new Date(2025, 5, 8).toISOString(),
      new Date(2025, 5, 9).toISOString(),
    )
    expect(streakDays(sessions, now)).toBe(2)
  })

  it('returns 1 for yesterday only (none today)', () => {
    const now = new Date(2025, 5, 9)
    const sessions = mkSessions(new Date(2025, 5, 8).toISOString())
    expect(streakDays(sessions, now)).toBe(1)
  })

  it('returns 0 when the gap breaks the streak (two days ago only)', () => {
    const now = new Date(2025, 5, 9)
    const sessions = mkSessions(new Date(2025, 5, 7).toISOString())
    expect(streakDays(sessions, now)).toBe(0)
  })

  it('counts consecutive days correctly even with a later gap', () => {
    const now = new Date(2025, 5, 9)
    // 9, 8, 7 → streak of 3; 5 is not consecutive so it stops
    const sessions = mkSessions(
      new Date(2025, 5, 7).toISOString(),
      new Date(2025, 5, 8).toISOString(),
      new Date(2025, 5, 9).toISOString(),
      new Date(2025, 5, 5).toISOString(),
    )
    expect(streakDays(sessions, now)).toBe(3)
  })

  it('multiple sessions same day count once', () => {
    const now = new Date(2025, 5, 9)
    const sessions = mkSessions(
      new Date(2025, 5, 9, 9, 0).toISOString(),
      new Date(2025, 5, 9, 14, 0).toISOString(),
      new Date(2025, 5, 8).toISOString(),
    )
    expect(streakDays(sessions, now)).toBe(2)
  })
})

describe('weeklyStats', () => {
  // Monday 2025-06-09
  const monday = new Date(2025, 5, 9, 10, 0)
  // Friday of same week
  const friday = new Date(2025, 5, 13, 10, 0)
  // Sunday before (last week)
  const prevSunday = new Date(2025, 5, 8, 23, 59)

  const mkItem = (id) => ({ id })
  const mkCard = (id, bucket = 'hot') => ({ id, bucket, sessionsUntilDue: 0, history: [] })

  it('counts sessions within the Monday-start week', () => {
    const sessions = [
      { date: new Date(2025, 5, 9).toISOString(), itemIds: ['a'], note: '' },   // this week (Monday)
      { date: new Date(2025, 5, 11).toISOString(), itemIds: ['b'], note: '' },  // this week (Wed)
      { date: new Date(2025, 5, 8).toISOString(), itemIds: ['c'], note: '' },   // last week (Sunday)
    ]
    const stats = weeklyStats(sessions, [], [], friday)
    expect(stats.sessionsThisWeek).toBe(2)
  })

  it('unions itemIds across sessions this week', () => {
    const sessions = [
      { date: new Date(2025, 5, 9).toISOString(), itemIds: ['a', 'b'], note: '' },
      { date: new Date(2025, 5, 10).toISOString(), itemIds: ['b', 'c'], note: '' },
    ]
    const stats = weeklyStats(sessions, [], [], friday)
    expect(stats.itemsThisWeek).toBe(3) // a, b, c
  })

  it('excludes sessions before week start', () => {
    const sessions = [
      { date: prevSunday.toISOString(), itemIds: ['x'], note: '' },
    ]
    const stats = weeklyStats(sessions, [], [], monday)
    expect(stats.sessionsThisWeek).toBe(0)
    expect(stats.itemsThisWeek).toBe(0)
  })

  it('counts bucket distribution from cards matching items', () => {
    const items = [mkItem('a'), mkItem('b'), mkItem('c')]
    const cards = [mkCard('a', 'hot'), mkCard('b', 'warm'), mkCard('c', 'cold'), mkCard('orphan', 'hot')]
    const stats = weeklyStats([], cards, items, monday)
    expect(stats.buckets).toEqual({ hot: 1, warm: 1, cold: 1 })
  })

  it('ignores orphan cards (no matching item) in bucket counts', () => {
    const items = [mkItem('a')]
    const cards = [mkCard('a', 'hot'), mkCard('b', 'hot')]
    const stats = weeklyStats([], cards, items, monday)
    expect(stats.buckets.hot).toBe(1)
  })

  it('includes streak in result', () => {
    const now = new Date(2025, 5, 9)
    const sessions = [{ date: new Date(2025, 5, 9).toISOString(), itemIds: [], note: '' }]
    const stats = weeklyStats(sessions, [], [], now)
    expect(stats.streak).toBe(1)
  })
})

// ── computeBadges ─────────────────────────────────────────────────────────────

describe('computeBadges', () => {
  const mkSession = (d) => ({ date: d.toISOString(), itemIds: [], note: '' })
  const mkCard    = (id, bucket) => ({ id, bucket, sessionsUntilDue: 0, history: [] })

  it('returns empty for no sessions', () => {
    expect(computeBadges([], [], new Date(2025, 5, 9))).toEqual([])
  })

  it('awards first_session after 1 session', () => {
    const sessions = [mkSession(new Date(2025, 5, 9))]
    const badges = computeBadges(sessions, [], new Date(2025, 5, 9))
    expect(badges).toContain('first_session')
  })

  it('does NOT award streak_7 for 6 consecutive days', () => {
    const now = new Date(2025, 5, 9)
    const sessions = Array.from({ length: 6 }, (_, i) => mkSession(new Date(2025, 5, 9 - i)))
    const badges = computeBadges(sessions, [], now)
    expect(badges).not.toContain('streak_7')
  })

  it('awards streak_7 for 7 consecutive days', () => {
    const now = new Date(2025, 5, 9)
    const sessions = Array.from({ length: 7 }, (_, i) => mkSession(new Date(2025, 5, 9 - i)))
    const badges = computeBadges(sessions, [], now)
    expect(badges).toContain('streak_7')
  })

  it('awards streak_30 for 30 consecutive days', () => {
    const now = new Date(2025, 5, 30)
    const sessions = Array.from({ length: 30 }, (_, i) => mkSession(new Date(2025, 5, 30 - i)))
    const badges = computeBadges(sessions, [], now)
    expect(badges).toContain('streak_30')
  })

  it('does NOT award streak_30 for 29 consecutive days', () => {
    const now = new Date(2025, 5, 30)
    const sessions = Array.from({ length: 29 }, (_, i) => mkSession(new Date(2025, 5, 30 - i)))
    const badges = computeBadges(sessions, [], now)
    expect(badges).not.toContain('streak_30')
  })

  it('awards first_cold when any card is cold', () => {
    const sessions = [mkSession(new Date(2025, 5, 9))]
    const cards = [mkCard('a', 'hot'), mkCard('b', 'cold')]
    const badges = computeBadges(sessions, cards, new Date(2025, 5, 9))
    expect(badges).toContain('first_cold')
  })

  it('does NOT award first_cold with no cold cards', () => {
    const sessions = [mkSession(new Date(2025, 5, 9))]
    const cards = [mkCard('a', 'hot'), mkCard('b', 'warm')]
    const badges = computeBadges(sessions, cards, new Date(2025, 5, 9))
    expect(badges).not.toContain('first_cold')
  })

  it('awards all_warm when all cards are warm or cold (no hot)', () => {
    const sessions = [mkSession(new Date(2025, 5, 9))]
    const cards = [mkCard('a', 'warm'), mkCard('b', 'cold')]
    const badges = computeBadges(sessions, cards, new Date(2025, 5, 9))
    expect(badges).toContain('all_warm')
  })

  it('does NOT award all_warm when any card is hot', () => {
    const sessions = [mkSession(new Date(2025, 5, 9))]
    const cards = [mkCard('a', 'hot'), mkCard('b', 'warm')]
    const badges = computeBadges(sessions, cards, new Date(2025, 5, 9))
    expect(badges).not.toContain('all_warm')
  })

  it('does NOT award all_warm when cards is empty', () => {
    const sessions = [mkSession(new Date(2025, 5, 9))]
    const badges = computeBadges(sessions, [], new Date(2025, 5, 9))
    expect(badges).not.toContain('all_warm')
  })

  it('awards sessions_100 at exactly 100 sessions', () => {
    const now = new Date(2025, 5, 9)
    const sessions = Array.from({ length: 100 }, () => mkSession(new Date(2025, 0, 1)))
    const badges = computeBadges(sessions, [], now)
    expect(badges).toContain('sessions_100')
  })

  it('does NOT award sessions_100 for 99 sessions', () => {
    const now = new Date(2025, 5, 9)
    const sessions = Array.from({ length: 99 }, () => mkSession(new Date(2025, 0, 1)))
    const badges = computeBadges(sessions, [], now)
    expect(badges).not.toContain('sessions_100')
  })
})

// ── bucketTransitions ─────────────────────────────────────────────────────────

describe('bucketTransitions', () => {
  it('returns empty array for empty history', () => {
    expect(bucketTransitions([])).toEqual([])
  })

  it('returns empty array for null/undefined history', () => {
    expect(bucketTransitions(null)).toEqual([])
    expect(bucketTransitions(undefined)).toEqual([])
  })

  it('skips history entries without a bucket field', () => {
    const history = [{ date: '2025-01-01', ups: 4, scores: {} }]
    expect(bucketTransitions(history)).toEqual([])
  })

  it('records first bucket seen', () => {
    const history = [{ date: '2025-01-01', bucket: 'hot', ups: 4 }]
    expect(bucketTransitions(history)).toEqual(['hot'])
  })

  it('deduplicates consecutive identical buckets', () => {
    const history = [
      { date: '2025-01-01', bucket: 'hot' },
      { date: '2025-01-02', bucket: 'hot' },
      { date: '2025-01-03', bucket: 'warm' },
    ]
    expect(bucketTransitions(history)).toEqual(['hot', 'warm'])
  })

  it('records all unique transitions', () => {
    const history = [
      { date: '2025-01-01', bucket: 'hot' },
      { date: '2025-01-02', bucket: 'warm' },
      { date: '2025-01-03', bucket: 'cold' },
      { date: '2025-01-04', bucket: 'warm' },
    ]
    expect(bucketTransitions(history)).toEqual(['hot', 'warm', 'cold', 'warm'])
  })
})

// ── scoreColor ────────────────────────────────────────────────────────────────

describe('scoreColor', () => {
  it('returns "pass" when ratio > 0.75 (e.g. 4/4)', () => {
    expect(scoreColor(4, 4)).toBe('pass')
  })

  it('returns "pass" when ratio > 0.75 (e.g. 4/5 = 0.8)', () => {
    expect(scoreColor(4, 5)).toBe('pass')
  })

  it('returns "warm" when ratio > 0.5 and <= 0.75 (e.g. 3/4 = 0.75)', () => {
    // 3/4 = 0.75 is not > 0.75, so falls to warm check (0.75 > 0.5 → warm)
    expect(scoreColor(3, 4)).toBe('warm')
  })

  it('returns "warm" when ratio > 0.5 (e.g. 2/3 ≈ 0.667)', () => {
    expect(scoreColor(2, 3)).toBe('warm')
  })

  it('returns "fail" when ratio = 0.5 (e.g. 2/4)', () => {
    // 0.5 is not > 0.5, so falls to fail
    expect(scoreColor(2, 4)).toBe('fail')
  })

  it('returns "fail" when ratio < 0.5', () => {
    expect(scoreColor(1, 4)).toBe('fail')
    expect(scoreColor(0, 4)).toBe('fail')
  })

  it('uses total=4 as fallback when total is 0', () => {
    // ups=4, total=0 → fallback 4 → 4/4 = 1.0 > 0.75 → pass
    expect(scoreColor(4, 0)).toBe('pass')
    // ups=1, total=0 → fallback 4 → 1/4 = 0.25 → fail
    expect(scoreColor(1, 0)).toBe('fail')
  })
})
