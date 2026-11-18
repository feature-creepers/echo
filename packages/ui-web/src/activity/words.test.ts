import type { AccessUse } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { dayOf, decisionInWords, shownUnder, summary } from './words.ts'

const use = (fields: Partial<AccessUse>): AccessUse => ({
  id: 'u',
  at: '2026-11-18T10:00:00Z',
  tool: 'Read',
  action: 'read',
  paths: ['/w/a.md'],
  decision: 'ran',
  reason: 'read-only',
  ...fields
})

describe('the activity, in words', () => {
  it.each([
    [use({}), 'Read a.md', false],
    [use({ tool: 'Grep', paths: ['/w/src'] }), 'Searched src', false],
    [use({ tool: 'Write', action: 'create', paths: ['C:\\Users\\me\\notes.txt'] }), 'Created notes.txt', false],
    [use({ tool: 'apply_patch', action: 'change', paths: ['/a', '/b'] }), 'Changed 2 files', false],
    [use({ tool: 'Bash', action: 'run', command: 'git status\ngit log' }), 'git status', true]
  ])('sums up a use', (given, text, code) => {
    expect(summary(given)).toEqual({ text, code })
  })

  it.each([
    [use({}), 'Ran', 'only reads'],
    [use({ decision: 'approved', reason: 'said' }), 'Approved', 'you said yes'],
    [use({ decision: 'ran', reason: 'session' }), 'Ran', 'allowed for this session'],
    [use({ decision: 'refused', reason: 'protected' }), 'Refused', 'never reached'],
    [use({ decision: 'refused', reason: 'outside' }), 'Refused', 'outside what you gave']
  ])('says what was decided', (given, word, why) => {
    expect(decisionInWords(given)).toMatchObject({ word, why })
  })

  it.each([
    ['all', use({}), true],
    ['asked', use({}), false],
    ['asked', use({ decision: 'approved', reason: 'pressed' }), true],
    ['asked', use({ decision: 'refused', reason: 'declined' }), true],
    ['asked', use({ decision: 'refused', reason: 'outside' }), false],
    ['refused', use({ decision: 'refused', reason: 'outside' }), true],
    ['changes', use({}), false],
    ['changes', use({ action: 'run', reason: 'read-only' }), false],
    ['changes', use({ action: 'run', reason: 'level' }), true],
    ['changes', use({ action: 'create' }), true]
  ] as const)('files a use under %s', (filter, given, shown) => {
    expect(shownUnder(given, filter)).toBe(shown)
  })

  it('names the day', () => {
    const now = new Date(2026, 10, 18, 15, 0)
    expect(dayOf(new Date(2026, 10, 18, 9, 0).toISOString(), now)).toBe('Today')
    expect(dayOf(new Date(2026, 10, 17, 23, 0).toISOString(), now)).toBe('Yesterday')
    expect(dayOf(new Date(2026, 10, 16, 9, 0).toISOString(), now)).toBe('Monday 16 November')
  })
})
