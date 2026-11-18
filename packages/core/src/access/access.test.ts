import { validateView } from '@repo/catalog'
import type { Event } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import type { Blobs } from '../ports/blobs.ts'
import type { Computer } from '../ports/computer.ts'
import type { ComputerUse, Reach, Signal } from '../ports/harness.ts'
import { memoryRecords } from '../records/memory.ts'
import { manualTimers } from '../replay/manual-timers.ts'
import { ACCESS_SET, createUserSettings } from '../settings/settings.ts'
import { createScreen } from '../views/screen.ts'
import { createAccess } from './access.ts'
import { ACCESS_USE, KEPT_MS } from './activity.ts'

const WORKSPACE = '/data/workspace'

const text = (value: string) => new TextEncoder().encode(value)
const read = (bytes: Uint8Array | undefined) => (bytes ? new TextDecoder().decode(bytes) : undefined)
/** A fingerprint of the content, as the computer would give one: the content itself does here. */
const print = (bytes: Uint8Array) => `#${read(bytes)}`

/** A computer with a few places on it, and files held in memory. */
function machine() {
  const files = new Map<string, Uint8Array>()
  const trashed: string[] = []
  const computer: Computer = {
    workspace: WORKSPACE,
    async locate(path) {
      const known: Record<string, 'folder' | 'file'> = {
        '/home/ada/Documents': 'folder',
        '/home/ada/notes.txt': 'file',
        '/home/ada/.ssh': 'folder',
        [WORKSPACE]: 'folder'
      }
      const absolute = path.replace(/^~/, '/home/ada')
      return known[absolute] ? { path: absolute, kind: known[absolute] } : undefined
    },
    protected: [
      { label: 'SSH keys', path: '/home/ada/.ssh' },
      { label: 'Password databases', ending: '.kdbx' }
    ],
    async read(path, limit) {
      const bytes = files.get(path)
      return bytes === undefined ? undefined : bytes.byteLength > limit ? 'too-large' : bytes
    },
    async write(path, bytes) {
      files.set(path, bytes)
    },
    async fingerprint(path) {
      const bytes = files.get(path)
      return bytes === undefined ? undefined : print(bytes)
    },
    async trash(path) {
      files.delete(path)
      trashed.push(path)
      return `/data/trash/today/${path.split('/').at(-1)}`
    }
  }
  return { computer, files, trashed }
}

/** Blobs keyed the way the computer prints fingerprints, so a kept version compares with a file's content. */
function versions(): Blobs & { held: Map<string, Uint8Array> } {
  const held = new Map<string, Uint8Array>()
  return {
    held,
    put(bytes) {
      held.set(print(bytes), bytes)
      return print(bytes)
    },
    get: (hash) => held.get(hash),
    remove: (hash) => void held.delete(hash)
  }
}

function setup({ withComputer = true, records = memoryRecords(), now = () => new Date('2026-11-18T10:00:00Z') } = {}) {
  let ids = 0
  const screen = createScreen({ records, newId: () => `v${++ids}` })
  const settings = createUserSettings(records, undefined, withComputer ? WORKSPACE : undefined)
  const timers = manualTimers()
  const { computer, files, trashed } = machine()
  const kept = versions()
  const access = createAccess({
    settings,
    screen,
    computer: withComputer ? computer : undefined,
    timers,
    records,
    versions: kept,
    now,
    newId: () => `id${++ids}`
  })
  const events: Event[] = []
  access.onEvent((event) => events.push(event))
  const showing = () => ({ thread: 't', turn: 'turn', slot: 'stage' as const, focused: true })
  const reach = access.reach(showing) as Reach
  const [grant] = access.tools(showing)
  return { access, reach, grant, settings, screen, records, timers, files, trashed, kept, events }
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
const change: ComputerUse = { action: 'change', tool: 'Edit', paths: [`${WORKSPACE}/list.md`] }
const command = (line: string, reach: 'read' | 'write' = 'write'): ComputerUse => ({ action: 'run', tool: 'Bash', paths: [WORKSPACE], command: line, reach })
const cardText = (screen: ReturnType<typeof setup>['screen']) => JSON.stringify(screen.current()?.spec)
/** Let the promises waiting on the in-memory computer settle. */
const settle = async () => {
  for (let round = 0; round < 6; round++) await Promise.resolve()
}

describe('access to the computer', () => {
  it('starts with the assistant’s own folder and nothing else, every change asked first', () => {
    const { reach, settings } = setup()
    expect(reach.scope()).toEqual({
      places: [{ path: WORKSPACE, kind: 'folder', write: true }],
      computer: 'off',
      home: WORKSPACE,
      protected: [
        { label: 'SSH keys', path: '/home/ada/.ssh' },
        { label: 'Password databases', ending: '.kdbx' }
      ]
    })
    expect(settings.read().access).toEqual({ workspace: true, places: [], computer: 'off', approvals: 'ask', browser: true, folder: WORKSPACE })
  })

  it('reaches nothing on a core with no computer of its own', () => {
    const { access } = setup({ withComputer: false })
    expect(access.reach(() => ({ thread: 't', turn: undefined, slot: 'stage', focused: true }))).toBeUndefined()
    expect(access.tools(() => ({ thread: 't', turn: undefined, slot: 'stage', focused: true }))).toEqual([])
  })

  it('lets a read, and a command that only reads, go ahead without a question', async () => {
    const { reach, screen } = setup()
    expect(await reach.approve({ action: 'read', tool: 'Read', paths: [`${WORKSPACE}/a.md`] }, signal())).toEqual({ allow: true, use: expect.any(String) })
    expect(await reach.approve(command('ls -la'), signal())).toMatchObject({ allow: true })
    expect(await reach.approve(command('git status && cat a.md | head'), signal())).toMatchObject({ allow: true })
    expect(screen.current()).toBeUndefined()
  })

  it('refuses what the adapter found outside or never reached, with its reason, before anyone is asked', async () => {
    const { reach, screen, access } = setup()
    const refused = await reach.approve({ ...command('ls ~'), refused: { why: 'outside', reason: '~ is outside what the person granted.' } }, signal())
    expect(refused).toEqual({ allow: false, reason: '~ is outside what the person granted.' })
    expect(screen.current()).toBeUndefined()
    expect(access.activity(10).uses[0]).toMatchObject({ decision: 'refused', reason: 'outside', command: 'ls ~' })
  })

  it('asks before a change with a card of three answers, and goes ahead when the person presses yes', async () => {
    const { reach, access, screen } = setup()
    const verdict = reach.approve(create, signal())
    await settle()
    const card = screen.current()
    expect(card?.title).toBe('Waiting for you')
    expect(validateView(card?.spec).ok).toBe(true)
    expect(cardText(screen)).toContain('Create this file?')
    expect(cardText(screen)).toContain("The assistant's folder")
    expect(cardText(screen)).toContain('Allow for this session')
    expect(cardText(screen)).toContain("Don't allow")

    expect(access.hear('Allow')).toBe(true)
    expect(await verdict).toEqual({ allow: true, use: expect.any(String) })
    // The card goes once answered, and the use is kept as approved by a press.
    expect(screen.current()).toBeUndefined()
    expect(access.activity(1).uses[0]).toMatchObject({ decision: 'approved', reason: 'pressed', action: 'create' })
  })

  it('hears a spoken no, and tells the model not to try again', async () => {
    const { reach, access } = setup()
    const verdict = reach.approve(create, signal())
    await settle()
    expect(access.hear('Non, annule')).toBe(true)
    expect(await verdict).toEqual({ allow: false, reason: expect.stringContaining('said no') })
    expect(access.activity(1).uses[0]).toMatchObject({ decision: 'refused', reason: 'declined' })
  })

  it('lets the person move on: something else said withdraws the question, and is not taken as an answer', async () => {
    const { reach, access } = setup()
    const verdict = reach.approve(create, signal())
    await settle()
    expect(access.hear('What is the weather tomorrow?')).toBe(false)
    expect(await verdict).toEqual({ allow: false, reason: expect.stringContaining('moved on') })
    expect(access.hear('yes')).toBe(false)
  })

  it('withdraws the question when the turn stops, and when nobody answers', async () => {
    const { reach, screen, timers } = setup()
    const stopping = stoppable()
    const stopped = reach.approve(create, stopping.signal)
    await settle()
    stopping.stop()
    expect(await stopped).toEqual({ allow: false, reason: expect.stringContaining('stopped') })
    expect(screen.current()).toBeUndefined()

    const waiting = reach.approve(create, signal())
    await settle()
    timers.advance(10 * 60 * 1000)
    expect(await waiting).toEqual({ allow: false, reason: expect.stringContaining('No answer came') })
  })
})

describe('the three levels', () => {
  const cases: [string, ComputerUse, 'ask' | 'trust' | 'auto', boolean][] = [
    ['a change, asking', change, 'ask', false],
    ['a change, trusting', change, 'trust', true],
    ['a change, not asking', change, 'auto', true],
    ['a command, asking', command('git commit -m x'), 'ask', false],
    ['a command, trusting', command('git commit -m x'), 'trust', false],
    ['a command, not asking', command('git commit -m x'), 'auto', true],
    ['a command naming a place only read, not asking', command('cp a ~/Documents/', 'read'), 'auto', false],
    ['a command that destroys, not asking', command('rm notes.txt'), 'auto', false],
    ['a command that only reads, asking', command('ls'), 'ask', true],
    ['a command using the network, not asking', command('curl -O https://example.com/a.zip'), 'auto', true],
    ['a push, not asking', command('git push origin main'), 'auto', false],
    ['a release, not asking', command('gh release create v1'), 'auto', false]
  ]

  it.each(cases)('%s', async (_name, use, level, runs) => {
    const { reach, settings, screen } = setup()
    settings.setAccess({ approvals: level })
    const verdict = reach.approve(use, signal())
    await settle()
    expect(screen.current() === undefined).toBe(runs)
    if (runs) expect(await verdict).toMatchObject({ allow: true })
  })

  it('always asks before what destroys, with a warning and no answer for the session', async () => {
    const { reach, access, settings, screen } = setup()
    settings.setAccess({ approvals: 'auto' })
    const verdict = reach.approve(command('rm -rf build'), signal())
    await settle()
    expect(cardText(screen)).toContain('always asked')
    expect(cardText(screen)).not.toContain('Allow for this session')
    access.hear('yes, for the session')
    expect(await verdict).toMatchObject({ allow: true })
    // Not covered afterwards either.
    reach.approve(command('rm -rf build'), signal())
    await settle()
    expect(screen.current()).toBeDefined()
    expect(access.standingRules().allowances).toEqual([])
  })

  it('asks before what publishes at every level, says why, and lets a yes for the session cover the next push', async () => {
    const { reach, access, settings, screen } = setup()
    settings.setAccess({ approvals: 'auto' })
    const first = reach.approve(command('git push origin main'), signal())
    await settle()
    expect(cardText(screen)).toContain('puts something before others')
    expect(cardText(screen)).toContain('git push')
    access.hear('yes, for the session')
    expect(await first).toMatchObject({ allow: true })
    expect(await reach.approve(command('git push'), signal())).toMatchObject({ allow: true })
    expect(access.activity(1).uses[0]).toMatchObject({ decision: 'ran', reason: 'session' })
  })

  it('reads an access recorded before the third level as it behaved then', () => {
    const records = memoryRecords()
    records.append([{ type: ACCESS_SET, payload: { workspace: true, places: [], computer: 'write', approvals: 'trust' } }])
    expect(createUserSettings(records).read().access.approvals).toBe('auto')

    const kept = memoryRecords()
    kept.append([{ type: ACCESS_SET, payload: { workspace: true, places: [], computer: 'read', approvals: 'trust' } }])
    expect(createUserSettings(kept).read().access.approvals).toBe('trust')

    // Chosen now, trusting with the whole computer stays what it says.
    const fresh = memoryRecords()
    createUserSettings(fresh).setAccess({ computer: 'write', approvals: 'trust' })
    expect(createUserSettings(fresh).read().access.approvals).toBe('trust')
  })
})

describe('approvals for the session', () => {
  it('covers the same program and subcommand, and nothing else', async () => {
    const { reach, access, screen, events } = setup()
    const first = reach.approve(command('git commit -m one'), signal())
    await settle()
    expect(cardText(screen)).toContain('Any “git commit” until you quit')
    access.hear('Allow for the session')
    expect(await first).toMatchObject({ allow: true })
    expect(access.standingRules().allowances).toEqual([{ id: expect.any(String), kind: 'command', subject: 'git commit', at: expect.any(String) }])
    expect(events.some((event) => event.name === 'allowances.changed')).toBe(true)

    expect(await reach.approve(command('git commit -am two'), signal())).toMatchObject({ allow: true })
    expect(access.activity(1).uses[0]).toMatchObject({ decision: 'ran', reason: 'session' })
    reach.approve(command('git push'), signal())
    await settle()
    expect(cardText(screen)).toContain('git push')
  })

  it('covers any change in the same folder', async () => {
    const { reach, access, screen } = setup()
    const first = reach.approve(create, signal())
    await settle()
    access.hear('Oui, pour la session')
    expect(await first).toMatchObject({ allow: true })
    expect(await reach.approve({ action: 'change', tool: 'Edit', paths: [`${WORKSPACE}/sub/other.md`] }, signal())).toMatchObject({ allow: true })
    reach.approve({ action: 'create', tool: 'Write', paths: ['/home/ada/Documents/a.md'] }, signal())
    await settle()
    expect(cardText(screen)).toContain('Create this file?')
  })

  it('ends when the access changes, when one is forgotten, and when everything stops', async () => {
    const { reach, access, settings } = setup()
    const allow = async (line: string) => {
      const verdict = reach.approve(command(line), signal())
      await settle()
      access.hear('Allow for the session')
      await verdict
    }
    await allow('git commit -m x')
    settings.setAccess({ approvals: 'trust' })
    expect(access.standingRules().allowances).toEqual([])

    await allow('npm run build')
    const [allowed] = access.standingRules().allowances
    expect(access.forget(allowed?.id ?? '')).toBe(true)
    expect(access.standingRules().allowances).toEqual([])

    await allow('npm run build')
    access.stopEverything()
    expect(access.standingRules().allowances).toEqual([])
  })
})

describe('places never reached', () => {
  it('lists them for the person', () => {
    expect(setup().access.standingRules().protected).toEqual([
      { label: 'SSH keys', path: '/home/ada/.ssh' },
      { label: 'Password databases', path: '*.kdbx' }
    ])
  })

  it('does not give one, even when the person is asked', async () => {
    const { grant } = setup()
    expect(await grant?.run({ path: '~/.ssh' })).toEqual({ ok: false, text: expect.stringContaining('never reached') })
  })
})

describe('the activity', () => {
  it('keeps the previous version of a changed file, and puts it back', async () => {
    const { reach, access, files, settings } = setup()
    settings.setAccess({ approvals: 'trust' })
    const path = `${WORKSPACE}/list.md`
    files.set(path, text('before'))
    const verdict = await reach.approve(change, signal())
    if (!verdict.allow || !verdict.use) throw new Error('The change is expected to go ahead.')
    files.set(path, text('after'))
    reach.report?.(verdict.use, { ok: true })
    await settle()

    expect(access.activity(1).uses[0]).toMatchObject({ decision: 'ran', reason: 'level', outcome: { ok: true }, undo: { kind: 'restore' } })
    expect(await access.undo(verdict.use, false)).toMatchObject({ outcome: 'done', use: { undo: { kind: 'restore', done: expect.any(String) } } })
    expect(read(files.get(path))).toBe('before')
    // Done once, it is not done again.
    expect((await access.undo(verdict.use, false)).outcome).toBe('gone')
  })

  it('says when the file changed since, and puts it back only when asked again', async () => {
    const { reach, access, files, settings } = setup()
    settings.setAccess({ approvals: 'trust' })
    const path = `${WORKSPACE}/list.md`
    files.set(path, text('before'))
    const verdict = await reach.approve(change, signal())
    if (!verdict.allow || !verdict.use) throw new Error('The change is expected to go ahead.')
    files.set(path, text('after'))
    reach.report?.(verdict.use, { ok: true })
    await settle()
    files.set(path, text('edited by the person since'))
    expect((await access.undo(verdict.use, false)).outcome).toBe('changed')
    expect(read(files.get(path))).toBe('edited by the person since')
    expect((await access.undo(verdict.use, true)).outcome).toBe('done')
    expect(read(files.get(path))).toBe('before')
  })

  it('moves a file the assistant created to the trash', async () => {
    const { reach, access, files, trashed, settings } = setup()
    settings.setAccess({ approvals: 'auto' })
    const verdict = await reach.approve(create, signal())
    if (!verdict.allow || !verdict.use) throw new Error('The file is expected to be created.')
    files.set(`${WORKSPACE}/list.md`, text('new'))
    reach.report?.(verdict.use, { ok: true })
    await settle()
    expect(access.activity(1).uses[0]?.undo).toEqual({ kind: 'trash' })
    expect((await access.undo(verdict.use, false)).outcome).toBe('done')
    expect(trashed).toEqual([`${WORKSPACE}/list.md`])
  })

  it('offers no undo for a command, a refusal, or a change that failed', async () => {
    const { reach, access, settings } = setup()
    settings.setAccess({ approvals: 'auto' })
    const ran = await reach.approve(command('git commit -m x'), signal())
    const failed = await reach.approve(change, signal())
    if (!failed.allow || !failed.use || !ran.allow) throw new Error('Both are expected to go ahead.')
    reach.report?.(failed.use, { ok: false, error: 'String not found in file.' })
    await settle()
    const [last, first] = access.activity(2).uses
    expect(last).toMatchObject({ outcome: { ok: false, error: 'String not found in file.' } })
    expect(last?.undo).toBeUndefined()
    expect(first?.undo).toBeUndefined()
  })

  it('keeps what a tool of the core reports, the same way', async () => {
    const { access, events } = setup()
    const id = access.record({ tool: 'browser_open', action: 'read', paths: [], command: 'https://example.com', decision: 'ran', reason: 'level' })
    access.report(id, { ok: true })
    await settle()
    expect(access.activity(5).uses[0]).toMatchObject({ id, tool: 'browser_open', outcome: { ok: true } })
    // Told once decided, and again once how it went is known.
    expect(events.filter((event) => event.name === 'activity.used')).toHaveLength(2)
  })

  it('reads the latest first, a page at a time', async () => {
    const { reach, access } = setup()
    for (let index = 0; index < 5; index++) await reach.approve({ action: 'read', tool: 'Read', paths: [`${WORKSPACE}/${index}.md`] }, signal())
    const page = access.activity(2)
    expect(page.uses.map((use) => use.paths[0])).toEqual([`${WORKSPACE}/4.md`, `${WORKSPACE}/3.md`])
    expect(page.more).toBe(true)
    const next = access.activity(10, page.uses[1]?.id)
    expect(next.uses.map((use) => use.paths[0])).toEqual([`${WORKSPACE}/2.md`, `${WORKSPACE}/1.md`, `${WORKSPACE}/0.md`])
    expect(next.more).toBe(false)
  })

  it('erases what is older than 30 days when the core starts, and the versions only it kept', async () => {
    let clock = new Date('2026-10-01T10:00:00Z')
    const records = memoryRecords({ now: () => clock })
    const first = setup({ records, now: () => clock })
    first.settings.setAccess({ approvals: 'trust' })
    first.files.set(`${WORKSPACE}/list.md`, text('old'))
    await first.reach.approve(change, signal())
    expect(first.kept.held.size).toBe(1)

    clock = new Date(clock.getTime() + KEPT_MS + 1000)
    const later = setup({ records, now: () => clock })
    expect(later.access.activity(10).uses).toEqual([])
    expect(records.read([ACCESS_USE]).every((record) => record.payload === null)).toBe(true)
  })
})

describe('stopping everything', () => {
  it('withdraws every question waiting, and tells whoever listens', async () => {
    const { reach, access, screen } = setup()
    let stopped = 0
    access.onStopEverything(() => stopped++)
    const verdict = reach.approve(create, signal())
    await settle()
    expect(access.hear('Stop everything')).toBe(true)
    expect(await verdict).toEqual({ allow: false, reason: expect.stringContaining('stopped') })
    expect(screen.current()).toBeUndefined()
    expect(stopped).toBe(1)
    expect(access.hear('arrête tout')).toBe(true)
    expect(stopped).toBe(2)
  })
})

describe('a folder named by voice', () => {
  it('is given once the person confirms, and the model is told', async () => {
    const { grant, access, settings, records } = setup()
    if (!grant) throw new Error('The grant tool is expected.')
    const result = grant.run({ path: '~/Documents' })
    await settle()
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
    const changed = await access.set({
      places: [
        { path: '~/notes.txt', kind: 'file', write: true },
        { path: '/home/ada/notes.txt', kind: 'file', write: false }
      ]
    })
    expect(changed.ok && changed.settings.access.places).toEqual([{ path: '/home/ada/notes.txt', kind: 'file', write: true }])
  })
})

describe('a project folder to work in', () => {
  it('asks to work in a folder not yet changeable, and grants it read and write', async () => {
    const { access, settings, screen } = setup()
    const showing = { thread: undefined, turn: 'turn', slot: 'stage' as const, focused: true }
    const granted = access.grant({ path: '~/Documents', write: true, purpose: 'work' }, showing)
    await settle()
    expect(cardText(screen)).toContain('Work in this folder?')
    expect(cardText(screen)).toContain('Read and change')
    access.hear('yes')
    expect(await granted).toEqual({ ok: true, path: '/home/ada/Documents', kind: 'folder', already: false })
    expect(settings.read().access.places).toEqual([{ path: '/home/ada/Documents', kind: 'folder', write: true }])
    expect(access.projects()).toEqual(['/home/ada/Documents'])
    // Already changeable: nothing is asked.
    expect(await access.grant({ path: '/home/ada/Documents', write: true, purpose: 'work' }, showing)).toMatchObject({ ok: true, already: true })
  })

  it('refuses a file, and a place never reached, before anyone is asked', async () => {
    const { access, screen } = setup()
    const showing = { thread: undefined, turn: 'turn', slot: 'stage' as const, focused: true }
    expect(await access.grant({ path: '~/notes.txt', write: true, purpose: 'work' }, showing)).toEqual({
      ok: false,
      text: expect.stringContaining('a project is a folder')
    })
    expect(await access.grant({ path: '~/.ssh', write: true, purpose: 'work' }, showing)).toEqual({ ok: false, text: expect.stringContaining('never reached') })
    expect(screen.current()).toBeUndefined()
  })
})

describe('what a thread did', () => {
  it('is told back to a new session: changes, commands and refusals, from its folder, and nothing of other threads', async () => {
    const { access, reach, settings } = setup()
    settings.setAccess({ approvals: 'auto' })
    const changed = await reach.approve(change, signal())
    if (changed.allow && changed.use) access.report(changed.use, { ok: true })
    const ran = await reach.approve(command('pnpm test'), signal())
    if (ran.allow && ran.use) access.report(ran.use, { ok: false, error: 'Exit code 1' })
    await reach.approve({ ...command('cat ~/.ssh/id_rsa'), refused: { why: 'protected', reason: 'It holds SSH keys, never reached.' } }, signal())
    await reach.approve({ action: 'read', tool: 'Read', paths: [`${WORKSPACE}/list.md`] }, signal())
    await settle()
    expect(access.worked('t', WORKSPACE)?.split('\n')).toEqual([
      '- changed list.md',
      '- ran `pnpm test` (it failed: Exit code 1)',
      '- not done, running `cat ~/.ssh/id_rsa`: It holds SSH keys, never reached.'
    ])
    expect(access.worked('another')).toBeUndefined()
  })
})

describe('what a thread is told', () => {
  it('says what it may reach and how each use is decided, and changes its version when what a session is given changes', () => {
    const { access, settings } = setup()
    const before = access.version()
    expect(access.standing()).toContain(`Your own folder, ${WORKSPACE}: read and write`)
    expect(access.standing()).toContain('Every change to a file, and every other command, waits for their approval')
    expect(access.standing()).toContain('never reached')
    expect(access.standing()).toContain('Commands may use the network when the task needs it')
    expect(access.standing()).toContain('a git push')
    expect(access.standing()).not.toContain('never use them to reach the web')
    settings.setAccess({ approvals: 'auto' })
    expect(access.standing()).toContain('Everything within what they granted runs at once')
    // A new level is told to a session with its next message: it is not opened again for it.
    expect(access.version()).toBe(before)
    settings.setAccess({ places: [{ path: '/home/ada/Documents', kind: 'folder', write: false }], workspace: false })
    expect(access.standing()).toContain('- /home/ada/Documents (folder): read only.')
    expect(access.version()).not.toBe(before)
    settings.setAccess({ places: [] })
    expect(access.standing()).toContain('You have no access')
  })
})
