import { describe, expect, it } from 'vitest'
import { scriptedHarness } from '../replay/scripted-harness.ts'
import type { KnownFact } from './facts.ts'
import { basisOf, PROFILE_INSTRUCTIONS, profileFor, writeProfile } from './profile.ts'

const fact = (id: string, text: string, kind: KnownFact['kind'], at = '2026-11-01T00:00:00.000Z'): KnownFact => ({
  fact: id,
  text,
  kind,
  origin: 'conversation',
  sources: [],
  since: at,
  at,
  record: `record-${id}`,
  versions: [`record-${id}`]
})

const tea = fact('tea', 'The user prefers tea.', 'preference')
const anna = fact('anna', 'Anna is the user’s sister.', 'person')
const override = fact('send', 'The user sent the letter on 2026-10-02 despite the warning.', 'override')

describe('the profile', () => {
  it('is written from the most important facts first, overrides above all', async () => {
    const harness = scriptedHarness({ complete: () => '  The user prefers tea and has a sister, Anna.  ' })
    const text = await writeProfile(harness, [tea, anna, override], new Date(2026, 10, 17, 10, 0))

    expect(text).toBe('The user prefers tea and has a sister, Anna.')
    const request = harness.completions[0]
    expect(request).toMatchObject({ role: 'utility', instructions: PROFILE_INSTRUCTIONS })
    expect(request?.input).toContain('Today is Tuesday 2026-11-17, 10:00.')
    const lines = request?.input.split('\n').filter((line) => line.startsWith('- ')) ?? []
    expect(lines).toEqual([
      '- (override, learned 2026-11-01) The user sent the letter on 2026-10-02 despite the warning.',
      '- (person, learned 2026-11-01) Anna is the user’s sister.',
      '- (preference, learned 2026-11-01) The user prefers tea.'
    ])
  })

  it('changes its basis when a fact is learned, corrected or forgotten', () => {
    const base = basisOf([tea, anna])
    expect(basisOf([anna, tea])).toBe(base)
    expect(basisOf([tea])).not.toBe(base)
    expect(basisOf([tea, { ...anna, record: 'record-anna-2' }])).not.toBe(base)
  })

  it('is the facts themselves before one was written, and nothing when nothing is known', () => {
    expect(profileFor(undefined, [])).toBeUndefined()
    expect(profileFor(undefined, [tea, anna])).toBe('- Anna is the user’s sister.\n- The user prefers tea.')
  })

  it('is followed by the facts learned since it was written', () => {
    const written = { text: 'The user prefers tea.', at: '2026-11-05T00:00:00.000Z' }
    expect(profileFor(written, [tea])).toBe('The user prefers tea.')
    const later = fact('bike', 'The user cycles to work.', 'other', '2026-11-10T00:00:00.000Z')
    expect(profileFor(written, [tea, later])).toBe('The user prefers tea.\n\nLearned since:\n- The user cycles to work.')
  })
})
