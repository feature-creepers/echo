import type { DesktopControl as Marked } from '@repo/protocol'
import { describe, expect, it, vi } from 'vitest'
import { createAccess } from '../access/access.ts'
import type { Desktop, DesktopElement, DesktopFound, WindowFacts } from '../ports/desktop.ts'
import type { ToolResult } from '../ports/tools.ts'
import { memoryRecords } from '../records/memory.ts'
import { manualTimers } from '../replay/manual-timers.ts'
import { createUserSettings } from '../settings/settings.ts'
import { createScreen } from '../views/screen.ts'
import { createDesktopControl, HOLD_MS } from './desktop.ts'

const NOTEPAD: WindowFacts = {
  id: 'w1',
  program: 'notepad',
  app: 'Notepad',
  title: 'notes.txt - Notepad',
  bounds: { x: 10, y: 20, width: 800, height: 600 },
  focused: false,
  minimized: false
}
const VAULT: WindowFacts = { ...NOTEPAD, id: 'w2', program: 'vault', app: 'Vault', title: 'Sign in' }

/** The elements the stand-in shows, by reference. */
const ELEMENTS: Record<string, Partial<DesktopElement> & { window: WindowFacts }> = {
  e1: { role: 'button', name: 'Bold', window: NOTEPAD },
  e2: { role: 'edit', name: 'Text editor', window: NOTEPAD },
  e3: { role: 'button', name: 'Delete', window: NOTEPAD },
  e4: { role: 'edit', name: 'Master key', password: true, window: VAULT }
}

/** Other apps that do what they are told, and remember what they did. */
function standIn(found: DesktopFound = { available: true }) {
  const done: string[] = []
  let outline = '- edit "Text editor" [e2]\n- button "Bold" [e1]'
  let idle: number | undefined = 60_000
  const desktop: Desktop = {
    find: async () => found,
    windows: async () => [NOTEPAD, VAULT],
    look: async (window) => ({ window: window === 'w2' ? VAULT : NOTEPAD, outline, cut: false }),
    screenshot: async () => ({ window: NOTEPAD, data: 'AAAA', mime: 'image/png' }),
    inspect: async (ref) => {
      const facts = ELEMENTS[ref]
      return facts ? { ref, role: 'generic', name: '', password: false, enabled: true, hints: [], ...facts } : undefined
    },
    focus: async (window) => {
      done.push(`focus ${window}`)
      return { ...NOTEPAD, focused: true }
    },
    click: async (ref) => {
      done.push(`click ${ref}`)
      outline = `${outline}\n- dialog "Font" [e9]`
    },
    type: async (ref, text, submit) => void done.push(`type ${ref} ${text}${submit ? ' ⏎' : ''}`),
    press: async (window, key) => void done.push(`press ${window} ${key}`),
    scroll: async (window, direction) => void done.push(`scroll ${window} ${direction}`),
    idle: async () => idle,
    open: async (link) => void done.push(`open ${link}`),
    close: async () => void done.push('close')
  }
  return {
    desktop,
    done,
    touch: (ms: number | undefined) => {
      idle = ms
    }
  }
}

function setup({ found, on = true }: { found?: DesktopFound; on?: boolean } = {}) {
  const records = memoryRecords()
  let ids = 0
  const screen = createScreen({ records, newId: () => `v${++ids}` })
  const settings = createUserSettings(records, undefined, '/data/workspace')
  settings.setAccess({ desktop: on, approvals: 'trust' })
  const timers = manualTimers()
  const access = createAccess({ settings, screen, timers })
  const { desktop, done, touch } = standIn(found)
  const marks: Marked[] = []
  const control = createDesktopControl({
    desktop,
    settings,
    ask: access.ask,
    uses: access,
    timers,
    mark: (marked) => marks.push(marked),
    pause: async () => undefined
  })
  const showing = () => ({ thread: 't', turn: 'turn', focused: true })
  const ready = control.state()
  const call = async (name: string, input: unknown): Promise<ToolResult> => {
    // Whether the system allows it is found once, before any tool is given.
    await ready
    const tool = control.tools(showing).find((candidate) => candidate.definition.name === name)
    if (!tool) throw new Error(`No tool ${name}`)
    return tool.run(input)
  }
  const heading = () => (screen.current()?.spec as { elements: Record<string, { props: Record<string, unknown> }> } | undefined)?.elements.heading?.props.text
  const asked = () => vi.waitFor(() => expect(heading()).toBeDefined())
  return { control, settings, access, desktop, done, touch, call, heading, asked, marks, timers, ready }
}

const anywhere = () => ({ thread: 't', turn: undefined, focused: true })

describe('other apps', () => {
  it('gives a thread its tools only while the person lets it and the system allows it', async () => {
    const on = setup()
    await on.ready
    expect(on.control.tools(anywhere).map((tool) => tool.definition.name)).toEqual([
      'desktop_windows',
      'desktop_look',
      'desktop_screenshot',
      'desktop_focus',
      'desktop_scroll',
      'desktop_click',
      'desktop_type',
      'desktop_press'
    ])
    expect(on.control.standing()).toContain('They have not listed any app yet')

    const off = setup({ on: false })
    await off.ready
    expect(off.control.tools(anywhere)).toEqual([])
    expect(off.control.standing()).toBeUndefined()

    const unavailable = setup({ found: { available: false, problem: 'Give the app the Accessibility permission.' } })
    expect(await unavailable.ready).toEqual({ available: false, problem: 'Give the app the Accessibility permission.', open: [] })
    expect(unavailable.control.tools(anywhere)).toEqual([])
  })

  it('lists the windows open, and the apps open for the settings, each once', async () => {
    const { call, ready } = setup()
    expect((await ready).open).toEqual([
      { program: 'notepad', name: 'Notepad' },
      { program: 'vault', name: 'Vault' }
    ])
    const listed = await call('desktop_windows', {})
    expect(listed.text).toContain('[w1] Notepad: notes.txt - Notepad (asked first)')
  })

  it('asks before using an app not listed: always allowing it lists it in the settings', async () => {
    const { call, asked, access, heading, settings } = setup()
    const looking = call('desktop_look', { window: 'w1' })
    await asked()
    expect(heading()).toBe('Use Notepad?')
    access.hear('Allow for the session')
    const seen = await looking
    expect(seen.ok).toBe(true)
    expect(seen.text).toContain("This is what another app's window shows")
    expect(seen.text).toContain('- button "Bold" [e1]')
    expect(settings.read().access.apps).toEqual([{ program: 'notepad', name: 'Notepad' }])
    // Listed, it is not asked again.
    expect((await call('desktop_look', { window: 'w1' })).ok).toBe(true)
  })

  it('allows an app for now, until it is let go of, and refuses one the person declines', async () => {
    const { call, asked, access, control, settings } = setup()
    const looking = call('desktop_look', { window: 'w1' })
    await asked()
    access.hear('yes')
    expect((await looking).ok).toBe(true)
    expect(settings.read().access.apps).toEqual([])
    expect((await call('desktop_look', { window: 'w1' })).ok).toBe(true)

    control.letGo()
    const again = call('desktop_look', { window: 'w1' })
    await asked()
    access.hear('no')
    expect(await again).toMatchObject({ ok: false, text: expect.stringContaining('The person said no') })
  })

  it('acts, tells what is new in the window, marks it while held, and lets go after a while', async () => {
    const { call, settings, done, marks, timers } = setup()
    settings.setAccess({ apps: [{ program: 'notepad', name: 'Notepad' }] })
    await call('desktop_look', { window: 'w1' })
    const clicked = await call('desktop_click', { ref: 'e1' })
    expect(done).toEqual(['click e1'])
    expect(clicked.text).toContain('Clicked “Bold”.')
    expect(clicked.text).toContain('- dialog "Font" [e9]')
    expect(clicked.text).not.toContain('- button "Bold"')
    expect(marks).toEqual([{ app: 'Notepad', title: 'notes.txt - Notepad', bounds: NOTEPAD.bounds }])
    timers.advance(HOLD_MS)
    expect(marks.at(-1)).toBeNull()
  })

  it('asks for what deletes whatever the trust, and never types a password', async () => {
    const { call, settings, done, asked, access, heading } = setup()
    settings.setAccess({
      approvals: 'auto',
      apps: [
        { program: 'notepad', name: 'Notepad' },
        { program: 'vault', name: 'Vault' }
      ]
    })
    const deleting = call('desktop_click', { ref: 'e3' })
    await asked()
    expect(heading()).toBe('Click “Delete”?')
    access.hear('no')
    expect((await deleting).ok).toBe(false)

    const typed = await call('desktop_type', { ref: 'e4', text: 'hunter2' })
    expect(typed).toMatchObject({ ok: false, text: expect.stringContaining('you never type passwords') })
    expect(done).toEqual([])
    expect(access.activity(10).uses.map((use) => [use.decision, use.command])).toEqual([
      ['refused', 'Typed “hunter2” in Vault'],
      ['refused', 'Clicked “Delete” in Notepad']
    ])
  })

  it('stops at once while the person uses the mouse or the keyboard', async () => {
    const { call, settings, done, touch } = setup()
    settings.setAccess({ apps: [{ program: 'notepad', name: 'Notepad' }] })
    touch(300)
    expect(await call('desktop_type', { ref: 'e2', text: 'hello' })).toMatchObject({ ok: false, text: expect.stringContaining('Paused') })
    expect(await call('desktop_focus', { window: 'w1' })).toMatchObject({ ok: false, text: expect.stringContaining('Paused') })
    touch(5_000)
    expect((await call('desktop_type', { ref: 'e2', text: 'hello', submit: true })).ok).toBe(true)
    expect(done).toEqual(['type e2 hello ⏎'])
  })

  it('waits a moment for the person to let go of the mouse or the keyboard, then acts', async () => {
    const { call, settings, done, touch, desktop } = setup()
    settings.setAccess({ apps: [{ program: 'notepad', name: 'Notepad' }] })
    let looks = 0
    const idle = desktop.idle
    desktop.idle = async () => (++looks < 4 ? 300 : idle())
    touch(5_000)
    expect((await call('desktop_type', { ref: 'e2', text: 'hello' })).ok).toBe(true)
    expect(looks).toBeGreaterThanOrEqual(4)
    expect(done).toEqual(['type e2 hello'])
  })

  it('lets go when the person turns it off, and gives no tool after', async () => {
    const { call, settings, marks } = setup()
    settings.setAccess({ apps: [{ program: 'notepad', name: 'Notepad' }] })
    await call('desktop_click', { ref: 'e1' })
    settings.setAccess({ desktop: false })
    expect(marks.at(-1)).toBeNull()
    await expect(call('desktop_windows', {})).rejects.toThrow('No tool')
  })
})
