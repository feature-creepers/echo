import { COMMANDS, PROTOCOL_VERSION, type Event } from '@repo/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createCore } from './core.ts'
import { memoryRecords } from './records/memory.ts'

function start(records = memoryRecords()) {
  return createCore({ version: '1.2.3', acceptsCredential: (credential) => credential === 'right', records, log: { error: vi.fn() } })
}

/** Run a command and read its output the way a client does. */
function run(core: ReturnType<typeof start>, name: keyof typeof COMMANDS, input: unknown) {
  const result = core.execute({ type: 'command', id: 'c1', name, input })
  if (!result?.ok) throw new Error(`"${name}" was refused: ${JSON.stringify(result)}`)
  return COMMANDS[name].output.parse(result.output)
}

describe('a core', () => {
  it('admits a client that presents the right credential', () => {
    const hello = { type: 'hello', protocol: PROTOCOL_VERSION, client: { kind: 'desktop', version: '1', device: 'd' }, capabilities: [], credential: 'right' }
    expect(start().admit(hello)).toMatchObject({ admitted: true, reply: { type: 'welcome', core: { version: '1.2.3' } } })
    expect(start().admit({ ...hello, credential: 'wrong' })).toMatchObject({ admitted: false, reply: { reason: 'credential' } })
  })

  it('starts a new user with personas to confirm', () => {
    const { settings } = run(start(), 'settings.read', {})
    expect(settings.revision).toBe(0)
    expect(settings.personas.confirmed).toBe(false)
    expect(settings.personas.active).toBe(settings.personas.available[0]?.id)
  })

  it('tells every listener when the personas are set, with the settings the command returned', () => {
    const core = start()
    const events: Event[] = []
    core.onEvent((event) => events.push(event))
    const [first, second] = run(core, 'settings.read', {}).settings.personas.available
    if (!first || !second) throw new Error('This test needs two personas.')

    const { settings } = run(core, 'personas.set', { names: [{ persona: second.id, name: 'Marvin' }], active: second.id })

    expect(settings.personas).toMatchObject({ active: second.id, confirmed: true })
    expect(settings.personas.available.map((persona) => persona.name)).toEqual([first.name, 'Marvin'])
    expect(events).toEqual([{ type: 'event', name: 'settings.changed', settings }])
  })

  it('stops telling a listener that asked to stop', () => {
    const core = start()
    const heard = vi.fn()
    core.onEvent(heard)()
    const { settings } = run(core, 'settings.read', {})

    run(core, 'personas.set', { names: [], active: settings.personas.active })

    expect(heard).not.toHaveBeenCalled()
  })

  it('finds the settings again when it restarts on the same records', () => {
    const records = memoryRecords()
    const before = start(records)
    const { settings: asked } = run(before, 'settings.read', {})
    const { settings: left } = run(before, 'personas.set', { names: [{ persona: asked.personas.active, name: 'Alan' }], active: asked.personas.active })

    expect(run(start(records), 'settings.read', {}).settings).toEqual(left)
  })
})
