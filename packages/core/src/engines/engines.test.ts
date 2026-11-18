import { describe, expect, it, vi } from 'vitest'
import { scriptedHarness } from '../replay/scripted-harness.ts'
import { createEngineRoom } from './engines.ts'

describe('the engine room', () => {
  it('runs on the first harness that is installed and signed in', async () => {
    const absent = scriptedHarness({ id: 'absent', status: { installed: false, signedIn: false, problem: 'Not found.' } })
    const signedOut = scriptedHarness({ id: 'signed-out', status: { installed: true, signedIn: false } })
    const ready = scriptedHarness({ id: 'ready' })
    const room = createEngineRoom([absent, signedOut, ready])

    expect((await room.read()).active).toBe('ready')
    expect((await room.active())?.id).toBe('ready')
  })

  it('runs on nothing when no harness can be used', async () => {
    const room = createEngineRoom([scriptedHarness({ status: { installed: true, signedIn: false } })])
    expect((await room.read()).active).toBeUndefined()
    expect(await room.active()).toBeUndefined()
  })

  it('looks once, then remembers, until asked to look again', async () => {
    const harness = scriptedHarness()
    const status = vi.spyOn(harness, 'status')
    const room = createEngineRoom([harness])

    await room.read()
    await room.active()
    expect(status).toHaveBeenCalledOnce()

    await room.read(true)
    expect(status).toHaveBeenCalledTimes(2)
  })

  it('tells its listeners when a new look finds something different, and only then', async () => {
    const harness = scriptedHarness()
    const room = createEngineRoom([harness])
    const heard = vi.fn()
    room.onChange(heard)

    await room.read()
    await room.read(true)
    expect(heard).not.toHaveBeenCalled()

    harness.stand({ installed: true, signedIn: false })
    const engines = await room.read(true)
    expect(heard).toHaveBeenCalledExactlyOnceWith(engines)
  })

  it('reports a harness whose status cannot be read as unusable, with the reason', async () => {
    const broken = scriptedHarness({ id: 'broken' })
    vi.spyOn(broken, 'status').mockRejectedValue(new Error('It crashed.'))
    const room = createEngineRoom([broken])

    expect((await room.read()).harnesses).toEqual([
      {
        id: 'broken',
        name: 'Scripted',
        installed: false,
        signedIn: false,
        problem: 'It crashed.',
        models: [expect.objectContaining({ id: 'quick' }), expect.objectContaining({ id: 'deep' })],
        defaultModel: 'quick',
        model: 'quick'
      }
    ])
  })

  it('opens the sign-in of the harness named, and rejects for one it does not have', async () => {
    const harness = scriptedHarness({ id: 'here' })
    const room = createEngineRoom([harness])

    await room.signIn('here')
    expect(harness.signIns).toBe(1)
    await expect(room.signIn('elsewhere')).rejects.toThrow('There is no harness "elsewhere".')
  })
})

describe('the user’s choice of engine', () => {
  const choosing = (preferred?: string, models: Record<string, string> = {}, efforts: Record<string, string> = {}) => {
    const chosen = { preferred, models, efforts }
    return {
      chosen,
      choice: { preferred: () => chosen.preferred, model: (harness: string) => chosen.models[harness], effort: (harness: string) => chosen.efforts[harness] }
    }
  }

  it('runs on the harness the user prefers when it is ready, and on the first ready when it is not', async () => {
    const first = scriptedHarness({ id: 'first' })
    const second = scriptedHarness({ id: 'second' })
    const { chosen, choice } = choosing('second')
    const room = createEngineRoom([first, second], choice)

    expect((await room.read()).active).toBe('second')
    expect((await room.active())?.id).toBe('second')

    second.stand({ installed: true, signedIn: false })
    expect((await room.read(true)).active).toBe('first')

    chosen.preferred = 'nowhere'
    expect((await room.read(true)).active).toBe('first')
  })

  it('decides again when the choice changes, without looking again, and tells its listeners', async () => {
    const first = scriptedHarness({ id: 'first' })
    const second = scriptedHarness({ id: 'second' })
    const status = vi.spyOn(second, 'status')
    const { chosen, choice } = choosing()
    const room = createEngineRoom([first, second], choice)
    await room.read()
    const heard = vi.fn()
    room.onChange(heard)

    chosen.preferred = 'second'
    await room.reconsider()

    expect(heard).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ active: 'second' }))
    expect(status).toHaveBeenCalledOnce()
  })

  it('shows each harness’s models, its default, and the one its answers use', async () => {
    const { choice } = choosing(undefined, { scripted: 'deep' })
    const room = createEngineRoom([scriptedHarness()], choice)

    expect((await room.read()).harnesses[0]).toMatchObject({ defaultModel: 'quick', model: 'deep', models: [{ id: 'quick' }, { id: 'deep' }] })
  })

  it('runs the answers on the chosen model, and routing and the work asleep on their own', async () => {
    const harness = scriptedHarness()
    const { chosen, choice } = choosing(undefined, { scripted: 'deep' })
    const room = createEngineRoom([harness], choice)
    const active = await room.active()

    active?.open({ role: 'thread', instructions: '' })
    active?.open({ role: 'orchestrator', instructions: '' })
    await active?.complete({ role: 'thread', instructions: '', input: '' })
    await active?.complete({ role: 'utility', instructions: '', input: '' })
    // A change of choice applies to the next session.
    chosen.models = {}
    active?.open({ role: 'thread', instructions: '' })

    expect(harness.sessions.map((session) => session.request.model)).toEqual(['deep', undefined, undefined])
    expect(harness.completions.map((request) => request.model)).toEqual(['deep', undefined])
  })

  it('names the model chosen while the harness offers it, and none for its default', async () => {
    const { chosen, choice } = choosing(undefined, { scripted: 'deep' })
    const room = createEngineRoom([scriptedHarness()], choice)
    await room.read()

    expect(room.chosenModel('scripted')).toBe('deep')
    chosen.models = { scripted: 'retired' }
    expect(room.chosenModel('scripted')).toBeUndefined()
    chosen.models = {}
    expect(room.chosenModel('scripted')).toBeUndefined()
  })

  it('runs the answers at the level chosen while their model offers it, and shows the level in use', async () => {
    const harness = scriptedHarness()
    const { chosen, choice } = choosing(undefined, { scripted: 'deep' }, { scripted: 'hard' })
    const room = createEngineRoom([harness], choice)

    expect((await room.read()).harnesses[0]).toMatchObject({ model: 'deep', effort: 'hard' })
    const active = await room.active()
    active?.open({ role: 'thread', instructions: '' })
    active?.open({ role: 'orchestrator', instructions: '' })
    expect(harness.sessions.map((session) => session.request.effort)).toEqual(['hard', undefined])

    // Without a choice, the model's default is shown and the harness is left to it.
    chosen.efforts = {}
    await room.reconsider()
    expect((await room.read()).harnesses[0]?.effort).toBe('light')
    expect(room.chosenEffort('scripted')).toBeUndefined()

    // A model that offers no level ignores the choice, which comes back with a model that offers it.
    chosen.efforts = { scripted: 'hard' }
    chosen.models = {}
    expect(room.chosenEffort('scripted')).toBeUndefined()
    expect((await room.read()).harnesses[0]).not.toHaveProperty('effort')
    active?.open({ role: 'thread', instructions: '' })
    expect(harness.sessions[2]?.request).not.toHaveProperty('effort')
    chosen.models = { scripted: 'deep' }
    expect(room.chosenEffort('scripted')).toBe('hard')
  })

  it('leaves the harness to its default when the model chosen is no longer offered', async () => {
    const harness = scriptedHarness()
    const { choice } = choosing(undefined, { scripted: 'retired' })
    const room = createEngineRoom([harness], choice)

    expect((await room.read()).harnesses[0]?.model).toBe('quick')
    ;(await room.active())?.open({ role: 'thread', instructions: '' })
    expect(harness.sessions[0]?.request.model).toBeUndefined()
  })
})
