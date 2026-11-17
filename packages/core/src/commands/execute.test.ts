import type { Settings } from '@repo/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createExecutor, type Handlers } from './execute.ts'

const settings: Settings = {
  revision: 0,
  personas: { available: [{ id: 'first', name: 'Ada', stance: 'accommodating', accent: 'cyan' }], active: 'first', confirmed: false }
}

function setup(overrides: Partial<Handlers> = {}) {
  const log = { error: vi.fn<(message: string) => void>() }
  const handlers: Handlers = {
    'settings.read': () => ({ ok: true, output: { settings } }),
    'personas.set': () => ({ ok: false, error: { code: 'name-taken', message: 'taken' } }),
    ...overrides
  }
  return { execute: createExecutor(handlers, log), log }
}

describe('the executor', () => {
  it('answers a command with its output, under the same identifier', () => {
    const { execute } = setup()
    expect(execute({ type: 'command', id: 'c7', name: 'settings.read', input: {} })).toEqual({ type: 'result', id: 'c7', ok: true, output: { settings } })
  })

  it('passes on the refusal of a handler', () => {
    const { execute } = setup()
    expect(execute({ type: 'command', id: 'c1', name: 'personas.set', input: { names: [], active: 'first' } })).toEqual({
      type: 'result',
      id: 'c1',
      ok: false,
      error: { code: 'name-taken', message: 'taken' }
    })
  })

  it('gives the handler the input as the definition reads it', () => {
    const handler = vi.fn<Handlers['personas.set']>(() => ({ ok: true, output: { settings } }))
    const { execute } = setup({ 'personas.set': handler })

    execute({ type: 'command', id: 'c1', name: 'personas.set', input: { names: [], active: 'first', extra: true } })

    expect(handler).toHaveBeenCalledExactlyOnceWith({ names: [], active: 'first' })
  })

  it.each([
    ['a command it does not have', { type: 'command', id: 'c1', name: 'settings.erase', input: {} }, 'unknown-command'],
    ['a name every object has', { type: 'command', id: 'c1', name: 'constructor', input: {} }, 'unknown-command'],
    ['an input the command does not take', { type: 'command', id: 'c1', name: 'personas.set', input: { names: 'Ada' } }, 'invalid-input'],
    ['no input at all', { type: 'command', id: 'c1', name: 'personas.set' }, 'invalid-input']
  ])('refuses %s', (_what, message, code) => {
    const { execute } = setup()
    expect(execute(message)).toMatchObject({ type: 'result', id: 'c1', ok: false, error: { code } })
  })

  it.each([undefined, null, 'settings.read', [], {}, { type: 'hello' }, { type: 'command', name: 'settings.read', input: {} }])(
    'gives nothing for what is not a command (%j)',
    (message) => {
      const { execute } = setup()
      expect(execute(message)).toBeUndefined()
    }
  )

  it('answers and reports when a handler throws, instead of taking the core down', () => {
    const { execute, log } = setup({
      'settings.read': () => {
        throw new Error('the disk is full')
      }
    })

    expect(execute({ type: 'command', id: 'c1', name: 'settings.read', input: {} })).toEqual({
      type: 'result',
      id: 'c1',
      ok: false,
      error: { code: 'failed', message: 'the disk is full' }
    })
    expect(log.error).toHaveBeenCalledExactlyOnceWith('The command "settings.read" failed: the disk is full')
  })
})
