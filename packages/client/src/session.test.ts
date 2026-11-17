import { DEFAULT_ACCESS, DEFAULT_LANGUAGES, type Event, type Settings } from '@repo/protocol'
import { describe, expect, it, vi } from 'vitest'
import { CommandFailed, openSession, type SessionLink } from './session.ts'

const settings: Settings = {
  revision: 2,
  personas: { available: [{ id: 'first', name: 'Ada', stance: 'accommodating', accent: 'cyan' }], active: 'first', confirmed: true },
  engines: { models: {} },
  access: DEFAULT_ACCESS,
  languages: DEFAULT_LANGUAGES
}

/** A link whose other end is the test. */
function fakeLink() {
  let listener: (message: unknown) => void = () => undefined
  const sent: { type: string; id: string; name: string; input: unknown }[] = []
  const link: SessionLink = {
    send: (message) => sent.push(message as (typeof sent)[number]),
    onMessage: (next) => (listener = next)
  }
  return { link, sent, receive: (message: unknown) => listener(message) }
}

describe('a session', () => {
  it('sends a command and resolves with the output of its result', async () => {
    const { link, sent, receive } = fakeLink()
    const session = openSession(link)

    const running = session.run('settings.read', {})
    expect(sent).toMatchObject([{ type: 'command', name: 'settings.read', input: {} }])
    receive({ type: 'result', id: sent[0]?.id, ok: true, output: { settings } })

    expect(await running).toEqual({ settings })
  })

  it('matches each result to its command, whatever order they come back in', async () => {
    const { link, sent, receive } = fakeLink()
    const session = openSession(link)
    const read = session.run('settings.read', {})
    const set = session.run('personas.set', { names: [], active: 'first' })
    expect(sent[0]?.id).not.toBe(sent[1]?.id)

    receive({ type: 'result', id: sent[1]?.id, ok: true, output: { settings: { ...settings, revision: 3 } } })
    receive({ type: 'result', id: sent[0]?.id, ok: true, output: { settings } })

    expect((await set).settings.revision).toBe(3)
    expect((await read).settings.revision).toBe(2)
  })

  it('rejects with the code the core gave when it refuses', async () => {
    const { link, sent, receive } = fakeLink()
    const running = openSession(link).run('personas.set', { names: [], active: 'nobody' })

    receive({ type: 'result', id: sent[0]?.id, ok: false, error: { code: 'unknown-persona', message: 'There is no persona "nobody".' } })

    const error = await running.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CommandFailed)
    expect(error).toMatchObject({ code: 'unknown-persona' })
  })

  it('rejects when the output is not what the command gives', async () => {
    const { link, sent, receive } = fakeLink()
    const running = openSession(link).run('settings.read', {})

    receive({ type: 'result', id: sent[0]?.id, ok: true, output: { settings: 'not settings' } })

    await expect(running).rejects.toMatchObject({ code: 'unreadable' })
  })

  it('tells its listeners the events it knows, and ignores the rest', () => {
    const { link, receive } = fakeLink()
    const session = openSession(link)
    const heard = vi.fn<(event: Event) => void>()
    const stop = session.onEvent(heard)
    const changed: Event = { type: 'event', name: 'settings.changed', settings }

    receive({ type: 'event', name: 'something.new', data: 1 })
    receive({ type: 'result', id: 'never-sent', ok: true, output: {} })
    receive('noise')
    receive(changed)
    stop()
    receive(changed)

    expect(heard).toHaveBeenCalledExactlyOnceWith(changed)
  })

  it('fails the commands still waiting when it closes, and refuses new ones', async () => {
    const { link, sent, receive } = fakeLink()
    const session = openSession(link)
    const waiting = session.run('settings.read', {})
    const heard = vi.fn()
    session.onEvent(heard)

    session.close()
    receive({ type: 'result', id: sent[0]?.id, ok: true, output: { settings } })
    receive({ type: 'event', name: 'settings.changed', settings })

    await expect(waiting).rejects.toMatchObject({ code: 'closed' })
    await expect(session.run('settings.read', {})).rejects.toMatchObject({ code: 'closed' })
    expect(sent).toHaveLength(1)
    expect(heard).not.toHaveBeenCalled()
  })

  it('does not take a result meant for an earlier session on the same link', async () => {
    const { link, sent, receive } = fakeLink()
    openSession(link)
      .run('settings.read', {})
      .catch(() => undefined)
    const earlier = sent[0]?.id
    const later = openSession(link)
    const running = later.run('settings.read', {})

    receive({ type: 'result', id: earlier, ok: true, output: { settings: { ...settings, revision: 99 } } })
    receive({ type: 'result', id: sent[1]?.id, ok: true, output: { settings } })

    expect((await running).settings.revision).toBe(2)
  })
})
