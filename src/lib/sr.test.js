import { describe, it, expect, vi } from 'vitest'
import {
  isDue, formatDue, draftValid, advanceBucket, bucketSessions,
  syncCards, shuffle, encodeWAV, DEFAULT_SETTINGS,
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
