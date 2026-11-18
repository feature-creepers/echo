import { DEFAULT_ACCESS, DEFAULT_LANGUAGES, type LibraryView, type MemoryView, type ScheduleView, type Settings } from '@repo/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createExecutor, type Handlers } from './execute.ts'

const memory: MemoryView = { revision: 0, groups: [], sleep: { when: 'quiet', quietMinutes: 10, time: '03:00' }, retentionDays: null }

const library: LibraryView = { revision: 0, widgets: [] }

const schedule: ScheduleView = { revision: 0, jobs: [], quiet: { on: true, from: '23:00', until: '07:30' }, held: false, timeZone: 'Europe/Paris' }

const settings: Settings = {
  revision: 0,
  personas: { available: [{ id: 'first', name: 'Ada', stance: 'accommodating', accent: 'cyan', look: 'hud' }], active: 'first', confirmed: false },
  engines: { models: {}, efforts: {} },
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
    'engines.effort.set': async () => ({ ok: true, output: { settings } }),
    'view.read': () => ({ ok: true, output: { margin: [], stream: [] } }),
    'view.clear': () => ({ ok: true, output: {} }),
    'view.act': async () => ({ ok: true, output: {} }),
    'shapes.read': () => ({ ok: true, output: { shapes: {} } }),
    'feed.read': () => ({ ok: true, output: { document: {} } }),
    'access.set': async () => ({ ok: true, output: { settings } }),
    'access.read': () => ({ ok: true, output: { allowances: [], protected: [] } }),
    'access.forget': () => ({ ok: true, output: { allowances: [], protected: [] } }),
    'activity.read': () => ({ ok: true, output: { uses: [], more: false } }),
    'activity.check': () => ({ ok: true, output: { state: 'empty', sealed: 0, unsealed: 0, head: null } }),
    'activity.export': () => ({ ok: true, output: { name: 'activity.json', text: '{}' } }),
    'activity.undo': async () => ({ ok: true, output: { outcome: 'gone' } }),
    'activity.diff': async () => ({ ok: true, output: { files: [] } }),
    'activity.changes': async () => ({ ok: true, output: { turns: [] } }),
    'everything.stop': () => ({ ok: true, output: {} }),
    'languages.set': () => ({ ok: true, output: { settings } }),
    'browser.read': () => ({ ok: true, output: { browser: { found: false, problem: 'none', running: false } } }),
    'browser.show': () => ({ ok: false, error: { code: 'invalid-input', message: 'none' } }),
    'desktop.read': () => ({ ok: true, output: { desktop: { available: false, problem: 'none', open: [] } } }),
    'threads.read': () => ({ ok: true, output: { threads: [] } }),
    'thread.focus': () => ({ ok: true, output: {} }),
    'threads.stop': () => ({ ok: true, output: { stopped: false } }),
    'thread.read': () => ({ ok: false, error: { code: 'invalid-input', message: 'There is no such thread.' } }),
    'file.read': () => ({ ok: false, error: { code: 'invalid-input', message: 'none' } }),
    'memory.read': () => ({ ok: true, output: { memory, state: { asleep: false } } }),
    'memory.edit': () => ({ ok: true, output: { memory } }),
    'memory.forget': () => ({ ok: true, output: { memory } }),
    'memory.sleep-settings.set': () => ({ ok: true, output: { memory } }),
    'memory.retention.set': () => ({ ok: true, output: { memory } }),
    'memory.sleep-now': () => ({ ok: true, output: {} }),
    'library.read': () => ({ ok: true, output: { library } }),
    'library.save': () => ({ ok: false, error: { code: 'unknown-widget', message: 'none' } }),
    'library.update': () => ({ ok: true, output: { library } }),
    'library.arrange': () => ({ ok: true, output: { library } }),
    'library.delete': () => ({ ok: true, output: { library } }),
    'library.show': () => ({ ok: true, output: {} }),
    'schedule.read': () => ({ ok: true, output: { schedule } }),
    'schedule.pause': () => ({ ok: true, output: { schedule } }),
    'schedule.delete': () => ({ ok: true, output: { schedule } }),
    'schedule.quiet.set': () => ({ ok: true, output: { schedule } }),
    'schedule.hold': () => ({ ok: true, output: { schedule } }),
    'attachment.open': () => ({ ok: true, output: { attachment: 'a1' } }),
    'attachment.write': () => ({ ok: true, output: { received: 0 } }),
    'attachment.close': () => ({ ok: false, error: { code: 'invalid-input', message: 'none' } }),
    'attachment.discard': () => ({ ok: true, output: {} }),
    'workspace.list': () => ({ ok: false, error: { code: 'invalid-input', message: 'none' } }),
    'workspace.read': () => ({ ok: false, error: { code: 'invalid-input', message: 'none' } }),
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
