import { validateView } from '@repo/catalog'
import type { Event } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { memoryRecords } from '../records/memory.ts'
import { createScreen } from '../views/screen.ts'
import { createObjections, DECISION } from './objection.ts'

function setup(records = memoryRecords()) {
  let ids = 0
  const screen = createScreen({ records, newId: () => `v${++ids}` })
  const events: Event[] = []
  screen.onEvent((event) => events.push(event))
  const objections = createObjections({ records, screen, now: () => new Date('2026-11-17T08:00:00Z') })
  const [raise, record] = objections.tools(() => ({ thread: 't', turn: 'turn', focused: true }))
  if (!raise || !record) throw new Error('Two tools are expected.')
  return { objections, raise, record, screen, events, records }
}

describe('objecting', () => {
  it('shows a decision card, composed from the catalogue, with both ways forward', async () => {
    const { raise, screen } = setup()
    const result = await raise.run({
      concern: 'The second paragraph admits you withheld rent.',
      alternative: 'Send it without that paragraph.',
      severity: 'critical'
    })

    expect(result.ok).toBe(true)
    expect(result.text).toContain('Ask aloud')
    const card = screen.current()
    expect(card?.title).toBe('A decision')
    expect(validateView(card?.spec).ok).toBe(true)
    const choice = Object.values(card?.spec.elements ?? {}).find((element) => element.type === 'Questions')
    const options = (choice?.props as { questions: { options: { say: string }[] }[] } | undefined)?.questions[0]?.options ?? []
    expect(options.map((option) => option.say)).toEqual(["Let's do it the better way: Send it without that paragraph.", 'I am sure. Go ahead as I asked.'])
  })

  it('asks for a concern and an alternative', async () => {
    expect((await setup().raise.run({ concern: 'Hmm' })).ok).toBe(false)
  })

  it('keeps the decisions made despite a concern, for every session to respect', async () => {
    const { record, objections, records } = setup()
    expect(objections.standing()).toBeUndefined()

    await record.run({ matter: 'Letter to the landlord', concern: 'It admits withheld rent.', chosen: 'proceed' })
    await record.run({ matter: 'Backup', concern: 'No copy exists.', chosen: 'alternative' })

    expect(records.read([DECISION])).toHaveLength(2)
    expect(objections.standing()).toBe(
      'Decisions the person made despite a concern. Respect them and do not raise these concerns again:\n- 2026-11-17: Letter to the landlord. They went ahead despite: It admits withheld rent.'
    )
  })
})
