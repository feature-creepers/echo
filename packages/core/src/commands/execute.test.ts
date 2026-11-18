import { DEFAULT_ACCESS, DEFAULT_LANGUAGES, type LibraryView, type MemoryView, type Settings } from '@repo/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createExecutor, type Handlers } from './execute.ts'

const memory: MemoryView = { revision: 0, groups: [], sleep: { when: 'quiet', quietMinutes: 10, time: '03:00' } }

const library: LibraryView = { revision: 0, widgets: [] }

const settings: Settings = {
  revision: 0,
  personas: { available: [{ id: 'first', name: 'Ada', stance: 'accommodating', accent: 'cyan', look: 'hud' }], active: 'first', confirmed: false },
  engines: { models: {} },
  access: DEFAULT_ACCESS,
  languages: DEFAULT_LANGUAGES
}

function setup(overrides: Partial<Handlers> = {}) {
  const log = { error: vi.fn<(message: string) => void>() }
  const handlers: Handlers = {
    'settings.read': () => ({ ok: true, output: { settings } }),
    'personas.set': () => ({ ok: false, error: { code: 'name-taken', message: 'taken' } }),
    'utterance.send': () => ({ ok: true, output: { turn: 't1' } }),
    'turn.stop': () => ({ ok: true, output: {} }),
    'assistant.greet': () => ({ ok: true, output: {} }),
    'channel.read': () => ({ ok: true, output: { exchanges: [] } }),
    'engines.read': async () => ({ ok: true, output: { engines: { harnesses: [] } } }),
    'engines.sign-in': async () => ({ ok: true, output: {} }),
    'engines.prefer': async () => ({ ok: true, output: { settings } }),
    'engines.model.set': async () => ({ ok: true, output: { settings } }),
    'view.read': () => ({ ok: true, output: { margin: [], stream: [] } }),
    'view.clear': () => ({ ok: true, output: {} }),
    'shapes.read': () => ({ ok: true, output: { shapes: {} } }),
    'access.set': async () => ({ ok: true, output: { settings } }),
    'languages.set': () => ({ ok: true, output: { settings } }),
    'threads.read': () => ({ ok: true, output: { threads: [] } }),
    'thread.focus': () => ({ ok: true, output: {} }),
    'thread.read': () => ({ ok: false, error: { code: 'invalid-input', message: 'There is no such thread.' } }),
    'file.read': () => ({ ok: false, error: { code: 'invalid-input', message: 'none' } }),
    'memory.read': () => ({ ok: true, output: { memory, state: { asleep: false } } }),
    'memory.edit': () => ({ ok: true, output: { memory } }),
    'memory.forget': () => ({ ok: true, output: { memory } }),
    'memory.sleep-settings.set': () => ({ ok: true, output: { memory } }),
    'memory.sleep-now': () => ({ ok: true, output: {} }),
    'library.read': () => ({ ok: true, output: { library } }),
    'library.save': () => ({ ok: false, error: { code: 'unknown-widget', message: 'none' } }),
    'library.update': () => ({ ok: true, output: { library } }),
    'library.arrange': () => ({ ok: true, output: { library } }),
    'library.delete': () => ({ ok: true, output: { library } }),
    'library.show': () => ({ ok: true, output: {} }),
    ...overrides
  }
  return { execute: createExecutor(handlers, log), log }
}

describe('the executor', () => {
  it('answers a command with its output, under the same identifier', async () => {
    const { execute } = setup()
    expect(await execute({ type: 'command', id: 'c7', name: 'settings.read', input: {} })).toEqual({ type: 'result', id: 'c7', ok: true, output: { settings } })
  })

  it('passes on the refusal of a handler', async () => {
    const { execute } = setup()
    expect(await execute({ type: 'command', id: 'c1', name: 'personas.set', input: { names: [], active: 'first' } })).toEqual({
      type: 'result',
      id: 'c1',
      ok: false,
      error: { code: 'name-taken', message: 'taken' }
    })
  })

  it('gives the handler the input as the definition reads it', async () => {
    const handler = vi.fn<Handlers['personas.set']>(() => ({ ok: true, output: { settings } }))
    const { execute } = setup({ 'personas.set': handler })

    await execute({ type: 'command', id: 'c1', name: 'personas.set', input: { names: [], active: 'first', extra: true } })

    expect(handler).toHaveBeenCalledExactlyOnceWith({ names: [], active: 'first' })
  })

  it.each([
    ['a command it does not have', { type: 'command', id: 'c1', name: 'settings.erase', input: {} }, 'unknown-command'],
    ['a name every object has', { type: 'command', id: 'c1', name: 'constructor', input: {} }, 'unknown-command'],
    ['an input the command does not take', { type: 'command', id: 'c1', name: 'personas.set', input: { names: 'Ada' } }, 'invalid-input'],
    ['no input at all', { type: 'command', id: 'c1', name: 'personas.set' }, 'invalid-input']
  ])('refuses %s', async (_what, message, code) => {
    const { execute } = setup()
    expect(await execute(message)).toMatchObject({ type: 'result', id: 'c1', ok: false, error: { code } })
  })

  it.each([undefined, null, 'settings.read', [], {}, { type: 'hello' }, { type: 'command', name: 'settings.read', input: {} }])(
    'gives nothing for what is not a command (%j)',
    async (message) => {
      const { execute } = setup()
      expect(await execute(message)).toBeUndefined()
    }
  )

  it('answers and reports when a handler throws, instead of taking the core down', async () => {
    const { execute, log } = setup({
      'settings.read': () => {
        throw new Error('the disk is full')
      }
    })

    expect(await execute({ type: 'command', id: 'c1', name: 'settings.read', input: {} })).toEqual({
      type: 'result',
      id: 'c1',
      ok: false,
      error: { code: 'failed', message: 'the disk is full' }
    })
    expect(log.error).toHaveBeenCalledExactlyOnceWith('The command "settings.read" failed: the disk is full')
  })

  it('waits for a handler that answers later', async () => {
    const { execute } = setup({ 'engines.read': async () => ({ ok: true, output: { engines: { harnesses: [], active: 'later' } } }) })
    expect(await execute({ type: 'command', id: 'c1', name: 'engines.read', input: {} })).toMatchObject({ ok: true, output: { engines: { active: 'later' } } })
  })

  it('answers when a handler that answers later rejects', async () => {
    const { execute } = setup({ 'engines.read': () => Promise.reject(new Error('no answer')) })
    expect(await execute({ type: 'command', id: 'c1', name: 'engines.read', input: {} })).toMatchObject({
      ok: false,
      error: { code: 'failed', message: 'no answer' }
    })
  })
})
