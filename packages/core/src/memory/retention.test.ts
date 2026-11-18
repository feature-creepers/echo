import { describe, expect, it } from 'vitest'
import { EXCHANGE, STEP, WORK } from '../channel/channel.ts'
import type { StoredRecord } from '../ports/records.ts'
import { VIEW_CLEARED, VIEW_SHOWN } from '../views/screen.ts'
import { expiredRecords, keptSince, readRetention } from './retention.ts'

let sequence = 0
const record = (type: string, at: string, payload: unknown): StoredRecord => ({ id: `r${++sequence}`, origin: 'core', sequence, at, type, payload })
const line = (turn: string, at: string) => record(EXCHANGE, at, { turn, at, persona: 'first', said: 'Something.', replied: 'An answer.', outcome: 'done' })

const SINCE = '2026-10-19T10:00:00.000Z'
const OLD = '2026-09-01T10:00:00.000Z'
const RECENT = '2026-11-01T10:00:00.000Z'

describe('keptSince', () => {
  it.each([
    [30, '2026-10-18T10:00:00.000Z'],
    [365, '2025-11-17T10:00:00.000Z']
  ])('counts %i days back from now', (days, since) => {
    expect(keptSince(new Date('2026-11-17T10:00:00Z'), days)).toBe(since)
  })
})

describe('readRetention', () => {
  it.each([
    [{ days: 90 }, 90],
    [{ days: null }, null],
    [{ days: 0 }, undefined],
    [null, undefined]
  ])('reads %j as %j', (payload, days) => {
    expect(readRetention(payload)).toBe(days)
  })
})

describe('expiredRecords', () => {
  it.each([
    ['an old line, with its turn', [line('old', OLD)], ['old'], 1],
    ['a recent line', [line('new', RECENT)], [], 0],
    ['a line already erased', [record(EXCHANGE, OLD, null)], [], 0],
    ['an old tool call', [record(STEP, OLD, { call: 'c1', turn: 'old' })], [], 1],
    ['an old request taken up', [record(WORK, OLD, { thread: 't', request: 'Do it.' })], [], 1],
    ['an old view still on the screen', [record(VIEW_SHOWN, OLD, { id: 'v1' })], [], 0],
    ['an old view closed since', [record(VIEW_SHOWN, OLD, { id: 'v1' }), record(VIEW_CLEARED, RECENT, { view: 'v1' })], [], 1],
    [
      'an old view closed, then brought back',
      [record(VIEW_SHOWN, OLD, { id: 'v1' }), record(VIEW_CLEARED, OLD, { view: 'v1' }), record(VIEW_SHOWN, RECENT, { id: 'v1' })],
      [],
      0
    ],
    ['an old view closed, but not its closing, which says nothing', [record(VIEW_SHOWN, OLD, { id: 'v1' }), record(VIEW_CLEARED, OLD, { view: 'v1' })], [], 1]
  ])('for %s', (_, records, turns, erased) => {
    const expired = expiredRecords(records, SINCE)
    expect([...expired.turns]).toEqual(turns)
    expect(expired.records).toHaveLength(erased)
  })
})
