import { describe, expect, it } from 'vitest'
import { scriptedHarness } from '../replay/scripted-harness.ts'
import type { Candidate } from './extract.ts'
import type { KnownFact } from './facts.ts'
import { RECONCILE_INSTRUCTIONS, reconcile, reconcileInput } from './reconcile.ts'

const candidate = (text: string): Candidate => ({ text, kind: 'person', turns: ['t9'] })
const known = (fact: string, text: string): KnownFact => ({
  fact,
  text,
  kind: 'person',
  origin: 'conversation',
  sources: ['t1'],
  since: '2026-10-01T00:00:00.000Z',
  at: '2026-10-01T00:00:00.000Z',
  record: `record-${fact}`,
  versions: [`record-${fact}`]
})

const paris = known('fact-paris', 'The user lives in Paris.')
const anna = known('fact-anna', 'The user has a sister, Anna.')

describe('reconciliation', () => {
  it('adds what resembles nothing known, without asking', async () => {
    const harness = scriptedHarness()
    const decisions = await reconcile(harness, [{ candidate: candidate('The user plays the cello.'), similar: [] }])
    expect(decisions).toEqual([{ action: 'add', candidate: candidate('The user plays the cello.'), text: 'The user plays the cello.' }])
    expect(harness.completions).toEqual([])
  })

  it('labels known facts so their identifiers stay out of the prompt', () => {
    const { input, labels } = reconcileInput([
      { candidate: candidate('The user moved to Lyon.'), similar: [paris] },
      { candidate: candidate('The user plays the cello.'), similar: [] },
      { candidate: candidate('Anna lives in Paris too.'), similar: [anna, paris] }
    ])
    expect(input).toContain('Candidate 1 (person): The user moved to Lyon.\nKnown facts like it:\n  k1: The user lives in Paris.')
    expect(input).toContain('(no similar fact known)')
    expect(input).toContain('k2: The user has a sister, Anna.\n  k1: The user lives in Paris.')
    expect(input).not.toContain('fact-paris')
    expect([...labels.keys()]).toEqual(['k1', 'k2'])
  })

  it('follows the model: replace, update, ignore', async () => {
    const harness = scriptedHarness({
      complete: () =>
        JSON.stringify({
          decisions: [
            { candidate: 1, action: 'replace', fact: 'k1', text: 'The user lives in Lyon.' },
            { candidate: 2, action: 'update', fact: 'k2', text: 'The user has a sister, Anna, a nurse.' },
            { candidate: 3, action: 'ignore' }
          ]
        })
    })
    const decisions = await reconcile(harness, [
      { candidate: candidate('The user moved to Lyon.'), similar: [paris] },
      { candidate: candidate('Anna is a nurse.'), similar: [anna] },
      { candidate: candidate('The user has a sister called Anna.'), similar: [anna] }
    ])

    expect(harness.completions[0]?.instructions).toBe(RECONCILE_INSTRUCTIONS)
    expect(decisions.map((decision) => [decision.action, 'fact' in decision ? decision.fact.fact : undefined])).toEqual([
      ['replace', 'fact-paris'],
      ['update', 'fact-anna'],
      ['ignore', undefined]
    ])
    expect(decisions[1]).toMatchObject({ text: 'The user has a sister, Anna, a nurse.' })
  })

  it('adds rather than lose a fact, when the model forgets a candidate or names a fact it was not shown', async () => {
    const harness = scriptedHarness({ complete: () => '{"decisions": [{"candidate": 1, "action": "replace", "fact": "k2"}]}' })
    const decisions = await reconcile(harness, [
      { candidate: candidate('The user moved to Lyon.'), similar: [paris] },
      { candidate: candidate('Anna is a nurse.'), similar: [anna] }
    ])
    expect(decisions.map((decision) => decision.action)).toEqual(['add', 'add'])
  })
})
