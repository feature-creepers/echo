import type { Event, Settings } from '@repo/protocol'
import { describe, expect, it, vi } from 'vitest'
import { CommandFailed, type Session } from '../session.ts'
import { followSettings } from './settings.ts'

function at(revision: number): Settings {
  return {
    revision,
    personas: { available: [{ id: 'first', name: 'Ada', stance: 'accommodating', accent: 'cyan' }], active: 'first', confirmed: revision > 0 }
  }
}

/** A session whose core is the test: it answers the read when told to, and announces what it is given. */
function fakeSession() {
  const listeners = new Set<(event: Event) => void>()
  let answer: (settings: Settings) => void = () => undefined
  let refuse: (error: unknown) => void = () => undefined
  const session: Session = {
    run: () =>
      new Promise<never>((resolve, reject) => {
        answer = (settings) => resolve({ settings } as never)
        refuse = reject
      }),
    onEvent: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    close: () => undefined
  }
  const announce = (settings: Settings) => {
    for (const listener of listeners) listener({ type: 'event', name: 'settings.changed', settings })
  }
  return { session, announce, answer: (settings: Settings) => answer(settings), refuse: (error: unknown) => refuse(error), listening: () => listeners.size }
}

/** Lets the promise of the read settle. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve()
}

describe('followSettings', () => {
  it('is loading until the core answers, then ready', async () => {
    const core = fakeSession()
    const state = followSettings(core.session)
    const changed = vi.fn()
    state.subscribe(changed)
    expect(state.current()).toEqual({ state: 'loading' })

    core.answer(at(0))
    await settled()

    expect(state.current()).toEqual({ state: 'ready', settings: at(0) })
    expect(changed).toHaveBeenCalledOnce()
  })

  it('follows what the core announces', async () => {
    const core = fakeSession()
    const state = followSettings(core.session)
    core.answer(at(0))
    await settled()

    core.announce(at(1))

    expect(state.current()).toEqual({ state: 'ready', settings: at(1) })
  })

  it('keeps the later revision when an announcement overtakes the read', async () => {
    const core = fakeSession()
    const state = followSettings(core.session)

    core.announce(at(2))
    core.answer(at(1))
    await settled()

    expect(state.current()).toEqual({ state: 'ready', settings: at(2) })
  })

  it('hands back the same object until something changes', async () => {
    const core = fakeSession()
    const state = followSettings(core.session)
    core.answer(at(1))
    await settled()
    const before = state.current()
    const changed = vi.fn()
    state.subscribe(changed)

    core.announce(at(1))

    expect(state.current()).toBe(before)
    expect(changed).not.toHaveBeenCalled()
  })

  it('says why when the settings cannot be read', async () => {
    const core = fakeSession()
    const state = followSettings(core.session)

    core.refuse(new CommandFailed('settings.read', 'failed', 'the disk is full'))
    await settled()

    expect(state.current()).toEqual({ state: 'failed', reason: 'The command "settings.read" failed: the disk is full' })
  })

  it('is ready all the same when an announcement arrived and the read then failed', async () => {
    const core = fakeSession()
    const state = followSettings(core.session)

    core.announce(at(1))
    core.refuse(new CommandFailed('settings.read', 'closed'))
    await settled()

    expect(state.current()).toEqual({ state: 'ready', settings: at(1) })
  })

  it('hears nothing more once stopped', async () => {
    const core = fakeSession()
    const state = followSettings(core.session)
    const changed = vi.fn()
    state.subscribe(changed)

    state.stop()
    core.announce(at(1))
    core.answer(at(2))
    await settled()

    expect(state.current()).toEqual({ state: 'loading' })
    expect(changed).not.toHaveBeenCalled()
    expect(core.listening()).toBe(0)
  })
})
