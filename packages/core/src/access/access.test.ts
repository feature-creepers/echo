import { validateView } from '@repo/catalog'
import { describe, expect, it } from 'vitest'
import type { Computer } from '../ports/computer.ts'
import type { ComputerUse, Reach, Signal } from '../ports/harness.ts'
import { memoryRecords } from '../records/memory.ts'
import { manualTimers } from '../replay/manual-timers.ts'
import { ACCESS_SET, createUserSettings } from '../settings/settings.ts'
import { createScreen } from '../views/screen.ts'
import { createAccess } from './access.ts'

const WORKSPACE = '/data/workspace'

/** A computer with a few places on it, and nothing else. */
const computer: Computer = {
  workspace: WORKSPACE,
  async locate(path) {
    const known: Record<string, 'folder' | 'file'> = { '/home/ada/Documents': 'folder', '/home/ada/notes.txt': 'file', [WORKSPACE]: 'folder' }
    const absolute = path.replace(/^~/, '/home/ada')
    return known[absolute] ? { path: absolute, kind: known[absolute] } : undefined
  }
}

function setup(withComputer = true) {
  const records = memoryRecords()
  let ids = 0
  const screen = createScreen({ records, newId: () => `v${++ids}` })
  const settings = createUserSettings(records, undefined, withComputer ? WORKSPACE : undefined)
  const timers = manualTimers()
  const access = createAccess({ settings, screen, computer: withComputer ? computer : undefined, timers })
  const showing = () => ({ thread: 't', turn: 'turn', slot: 'stage' as const, focused: true })
  const reach = access.reach(showing) as Reach
  const [grant] = access.tools(showing)
  return { access, reach, grant, settings, screen, records, timers }
}

/** A signal of the kind a harness passes, here made by hand: the core runs where AbortController may not exist. */
function stoppable() {
  const listeners = new Set<() => void>()
  const state = { aborted: false }
  const signal: Signal = {
    get aborted() {
      return state.aborted
    },
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener)
  }
  return {
    signal,
    stop() {
      state.aborted = true
      for (const listener of listeners) listener()
    }
  }
}
const signal = () => stoppable().signal
const create: ComputerUse = { action: 'create', tool: 'Write', paths: [`${WORKSPACE}/list.md`] }
const run: ComputerUse = { action: 'run', tool: 'Bash', paths: [WORKSPACE], command: 'ls -la' }

describe('access to the computer', () => {
  it('starts with the assistant’s own folder and nothing else, every change asked first', () => {
    const { reach, settings } = setup()
    expect(reach.scope()).toEqual({ places: [{ path: WORKSPACE, kind: 'folder', write: true }], computer: 'off', home: WORKSPACE })
    expect(settings.read().access).toEqual({ workspace: true, places: [], computer: 'off', approvals: 'ask', folder: WORKSPACE })
  })

  it('reaches nothing on a core with no computer of its own', () => {
    const { access } = setup(false)
    expect(access.reach(() => ({ thread: 't', turn: undefined, slot: 'stage', focused: true }))).toBeUndefined()
    expect(access.tools(() => ({ thread: 't', turn: undefined, slot: 'stage', focused: true }))).toEqual([])
  })

  it('lets a read go ahead without a question', async () => {
    const { reach, screen } = setup()
    expect(await reach.approve({ action: 'read', tool: 'Read', paths: [`${WORKSPACE}/a.md`] }, signal())).toEqual({ allow: true })
    expect(screen.current()).toBeUndefined()
  })

  it('asks before a change with a card from the catalogue, and goes ahead when the person presses yes', async () => {
    const { reach, access, screen } = setup()
    const verdict = reach.approve(create, signal())
    const card = screen.current()
    expect(card?.title).toBe('Waiting for you')
    expect(validateView(card?.spec).ok).toBe(true)
    expect(JSON.stringify(card?.spec)).toContain('Create this file?')
    expect(JSON.stringify(card?.spec)).toContain("The assistant's folder")

    expect(access.hear('Allow')).toBe(true)
    expect(await verdict).toEqual({ allow: true })
    // The card goes once answered.
    expect(screen.current()).toBeUndefined()
  })

  it('hears a spoken no, and tells the model not to try again', async () => {
    const { reach, access } = setup()
    const verdict = reach.approve(create, signal())
    expect(access.hear('Non, annule')).toBe(true)
    expect(await verdict).toEqual({ allow: false, reason: expect.stringContaining('said no') })
  })

  it('lets the person move on: something else said withdraws the question, and is not taken as an answer', async () => {
    const { reach, access } = setup()
    const verdict = reach.approve(create, signal())
    expect(access.hear('What is the weather tomorrow?')).toBe(false)
    expect(await verdict).toEqual({ allow: false, reason: expect.stringContaining('moved on') })
    expect(access.hear('yes')).toBe(false)
  })

  it('withdraws the question when the turn stops, and when nobody answers', async () => {
    const { reach, screen, timers } = setup()
    const stopping = stoppable()
    const stopped = reach.approve(create, stopping.signal)
    stopping.stop()
    expect(await stopped).toEqual({ allow: false, reason: expect.stringContaining('stopped') })
    expect(screen.current()).toBeUndefined()

    const waiting = reach.approve(create, signal())
    timers.advance(10 * 60 * 1000)
    expect(await waiting).toEqual({ allow: false, reason: expect.stringContaining('No answer came') })
  })

  it('shows a command as it would run, and asks for it even when changes are trusted', async () => {
    const { reach, access, screen, settings } = setup()
    settings.setAccess({ approvals: 'trust' })
    expect(await reach.approve(create, signal())).toEqual({ allow: true })

    const verdict = reach.approve(run, signal())
    expect(JSON.stringify(screen.current()?.spec)).toContain('```\\nls -la\\n```')
    access.hear('yes')
    expect(await verdict).toEqual({ allow: true })

    // Trusted with the whole computer to change, a command runs without a question.
    settings.setAccess({ computer: 'write' })
    expect(await reach.approve(run, signal())).toEqual({ allow: true })
  })

  it('gives a folder named by voice once the person confirms, and says so to the model', async () => {
    const { grant, access, settings, records } = setup()
    if (!grant) throw new Error('The grant tool is expected.')
    const result = grant.run({ path: '~/Documents' })
    await Promise.resolve()
    await Promise.resolve()
    // Read aloud, the button's own words are a yes.
    expect(access.hear('Give access')).toBe(true)
    expect(await result).toEqual({ ok: true, text: expect.stringContaining('Granted: /home/ada/Documents, read only') })
    expect(settings.read().access.places).toEqual([{ path: '/home/ada/Documents', kind: 'folder', write: false }])
    expect(records.read([ACCESS_SET])).toHaveLength(1)
    // Asked again, it is already granted, and nothing is asked.
    expect(await grant.run({ path: '/home/ada/Documents' })).toEqual({ ok: true, text: expect.stringContaining('already within your reach') })
  })

  it('refuses a place that does not exist', async () => {
    const { grant, access } = setup()
    expect(await grant?.run({ path: '/nowhere' })).toEqual({ ok: false, text: expect.stringContaining('There is nothing at /nowhere') })
    expect(await access.set({ places: [{ path: '/nowhere', kind: 'folder', write: true }] })).toMatchObject({ ok: false, error: { code: 'invalid-input' } })
  })

  it('keeps places as the system names them, once each', async () => {
    const { access } = setup()
    const change = await access.set({
      places: [
        { path: '~/notes.txt', kind: 'file', write: true },
        { path: '/home/ada/notes.txt', kind: 'file', write: false }
      ]
    })
    expect(change.ok && change.settings.access.places).toEqual([{ path: '/home/ada/notes.txt', kind: 'file', write: true }])
  })

  it('tells a thread what it may reach, and changes its version when that changes', () => {
    const { access, settings } = setup()
    const before = access.version()
    expect(access.standing()).toContain(`Your own folder, ${WORKSPACE}: read and write`)
    expect(access.standing()).toContain('Every change and every command waits for their approval')
    settings.setAccess({ places: [{ path: '/home/ada/Documents', kind: 'folder', write: false }], workspace: false })
    expect(access.standing()).toContain('- /home/ada/Documents (folder): read only.')
    expect(access.version()).not.toBe(before)
    settings.setAccess({ places: [] })
    expect(access.standing()).toContain('You have no access')
  })
})
