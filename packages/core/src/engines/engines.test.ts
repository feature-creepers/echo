import { describe, expect, it, vi } from 'vitest'
import type { HarnessStatus } from '../ports/harness.ts'
import { manualTimers } from '../replay/manual-timers.ts'
import { scriptedHarness } from '../replay/scripted-harness.ts'
import { createEngineRoom, FRESH_MS, RETRIES_MS } from './engines.ts'

/** Let the looks a timer started run to their end. */
const settled = async () => {
  for (let turn = 0; turn < 10; turn++) await Promise.resolve()
}

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

  it('never looks at one harness twice at once: a look asked for while one is under way waits for it', async () => {
    const harness = scriptedHarness()
    let answer: (status: HarnessStatus) => void = () => undefined
    const status = vi.spyOn(harness, 'status').mockImplementation(() => new Promise((resolve) => (answer = resolve)))
    const room = createEngineRoom([harness])

    const starting = room.active()
    const refreshing = room.read(true)
    for (let turn = 0; turn < 5; turn++) await Promise.resolve()
    answer({ installed: true, signedIn: true })

    expect((await refreshing).active).toBe('scripted')
    expect((await starting)?.id).toBe('scripted')
    expect(status).toHaveBeenCalledOnce()
  })

  it('looks again at a harness that gave no answer before running on another, and keeps it when it answers', async () => {
    const preferred = scriptedHarness({ id: 'preferred' })
    const other = scriptedHarness({ id: 'other' })
    vi.spyOn(preferred, 'status')
      .mockResolvedValueOnce({ installed: true, signedIn: false, problem: 'It did not finish within 15 seconds.', unanswered: true })
      .mockResolvedValue({ installed: true, signedIn: true })
    const room = createEngineRoom([preferred, other], { preferred: () => 'preferred', model: () => undefined, effort: () => undefined })

    expect((await room.active())?.id).toBe('preferred')
    expect((await room.read()).active).toBe('preferred')
  })

  it('runs on another at once when the one it would rather run on answered that it cannot be used', async () => {
    const signedOut = scriptedHarness({ id: 'signed-out', status: { installed: true, signedIn: false, problem: 'Not signed in.' } })
    const status = vi.spyOn(signedOut, 'status')
    const ready = scriptedHarness({ id: 'ready' })
    const room = createEngineRoom([signedOut, ready])

    expect((await room.active())?.id).toBe('ready')
    expect((await room.active())?.id).toBe('ready')
    expect(status).toHaveBeenCalledOnce()
  })

  it('looks again at one it would rather run on once its look is old: the person may have signed in since', async () => {
    let time = 0
    const first = scriptedHarness({ id: 'first', status: { installed: true, signedIn: false, problem: 'Not signed in.' } })
    const second = scriptedHarness({ id: 'second' })
    const room = createEngineRoom([first, second], undefined, { now: () => time })

    expect((await room.active())?.id).toBe('second')
    first.stand({ installed: true, signedIn: true })
    time += FRESH_MS - 1
    expect((await room.active())?.id).toBe('second')
    time += 2
    expect((await room.active())?.id).toBe('first')
  })

  it('asks a harness that gave no answer again on its own, a while later, and tells its listeners when it comes back', async () => {
    const timers = manualTimers()
    const slow = scriptedHarness({ id: 'slow' })
    const status = vi
      .spyOn(slow, 'status')
      .mockResolvedValue({ installed: true, signedIn: false, problem: 'It did not finish within 15 seconds.', unanswered: true })
    const room = createEngineRoom([slow], undefined, { timers })
    const heard = vi.fn()
    room.onChange(heard)

    expect((await room.read()).active).toBeUndefined()
    expect(timers.next()).toBe(RETRIES_MS[0])
    timers.advance(RETRIES_MS[0])
    await settled()
    expect(status).toHaveBeenCalledTimes(2)

    status.mockResolvedValue({ installed: true, signedIn: true })
    timers.advance(RETRIES_MS[1])
    await settled()
    expect(heard).toHaveBeenLastCalledWith(expect.objectContaining({ active: 'slow' }))
    // Once it answered, it is left alone.
    expect(timers.next()).toBeUndefined()
  })

  it('gives up asking on its own after the last wait, and stops when closed', async () => {
    const timers = manualTimers()
    const slow = scriptedHarness({ id: 'slow' })
    const status = vi.spyOn(slow, 'status').mockRejectedValue(new Error('It could not start.'))
    const room = createEngineRoom([slow], undefined, { timers })

    await room.read()
    for (const wait of RETRIES_MS) {
      timers.advance(wait)
      await settled()
    }
    expect(status).toHaveBeenCalledTimes(RETRIES_MS.length + 1)
    expect(timers.next()).toBeUndefined()

    const other = createEngineRoom([slow], undefined, { timers })
    await other.read()
    expect(timers.next()).toBe(RETRIES_MS[0])
    other.close()
    expect(timers.next()).toBeUndefined()
  })

  it('shows how each harness reaches files on this computer, found beside its status', async () => {
    const held = scriptedHarness({ id: 'held' })
    const unheld = {
      ...scriptedHarness({ id: 'unheld' }),
      computer: async () => ({ tools: 'shell', use: 'Use the shell.', write: 'apply_patch', confines: false, needs: 'computer' as const })
    }
    const room = createEngineRoom([held, unheld])

    const { harnesses } = await room.read()
    expect(harnesses[0]).not.toHaveProperty('files')
    expect(harnesses[1]?.files).toEqual({ confines: false, needs: 'computer' })
    expect(await (await room.active())?.computer?.()).toBeUndefined()
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
