import type { Desktop, DesktopElement, WindowFacts } from '@repo/core'
import { readKey } from './keys.ts'
import { outlineOf, seekIn } from './outline.ts'
import { system as thisSystem } from './system/index.ts'
import type { Helper, RawWindow, ScreenSystem } from './system/system.ts'

/** What a system's helper does for a widget's buttons, or why not, in words for the person who pressed one. */
const actsOf = (system: ScreenSystem) => {
  if (!system.acts) throw new Error('Buttons that act on the computer work on Windows only, for now.')
  return system.acts
}

/** How many elements of a window are read at most: a large app's tree has thousands, most of them never used. */
const ELEMENT_LIMIT = 1_500

/**
 * Input the system saw this soon after the adapter's own last act was the act itself, in milliseconds: keys and
 * clicks take a moment to be delivered.
 */
const OWN_INPUT_MS = 600

export interface DesktopOptions {
  /** Where the helper keeps its files. */
  folder: string
  /** Programs whose windows are never listed: the assistant's own app. In lower case, without an extension. */
  own?: readonly string[] | undefined
  /** The system to drive. Left out, this one. */
  system?: ScreenSystem | undefined
}

/**
 * The other apps of this computer (docs/SPEC.md, section 12.1, `device.screen`), through the helper of its system.
 * References are given here, so they read the same on every system; each stands for the helper's own key until the
 * next look at the same window.
 */
export function createDesktop({ folder, own = [], system = thisSystem }: DesktopOptions): Desktop {
  let helper: Helper | undefined
  const ask: Helper['ask'] = (name, input) => {
    helper ??= system.helper(folder)
    return helper.ask(name, input)
  }
  /** Each reference given, the helper's key and its window. */
  const references = new Map<string, { key: string; window: string }>()
  let next = 1
  /** When the adapter last pressed, clicked or typed itself, by the clock. */
  let lastOwn: number | undefined

  const facts = (window: RawWindow): WindowFacts => ({ ...window })
  const listed = async () => (await ask('windows', {})).filter((window) => !own.includes(window.program))
  const windowFacts = async (id: string): Promise<WindowFacts> => {
    const found = (await ask('windows', {})).find((window) => window.id === id)
    if (!found) throw new Error(`There is no window ${id} open now. Call desktop_windows for the windows open and their identifiers.`)
    return facts(found)
  }
  const keyOf = (ref: string) => {
    const known = references.get(ref)
    if (!known) throw new Error(`There is no element ${ref} now. Look at the window again with desktop_look and use its references.`)
    return known
  }
  const acted = async <T>(work: Promise<T>): Promise<T> => {
    try {
      return await work
    } finally {
      lastOwn = Date.now()
    }
  }

  return {
    find: () => system.find(),
    windows: async () => (await listed()).map(facts),

    async look(window, length) {
      const facts = await windowFacts(window)
      const nodes = await ask('tree', { window, limit: ELEMENT_LIMIT })
      const outline = outlineOf(nodes, length, next)
      for (const [ref, known] of references) if (known.window === window) references.delete(ref)
      for (const [ref, key] of outline.keys) references.set(ref, { key, window })
      next += outline.keys.size
      return { window: facts, outline: outline.text, cut: outline.cut }
    },

    async screenshot(window) {
      const facts = await windowFacts(window)
      const picture = await ask('screenshot', { window })
      return { window: facts, ...picture }
    },

    async inspect(ref) {
      const known = references.get(ref)
      if (!known) return undefined
      const raw = await ask('inspect', { key: known.key })
      if (!raw) return undefined
      const element: DesktopElement = {
        ref,
        role: raw.role
          .replace(/^ControlType\./, '')
          .replace(/^AX/, '')
          .toLowerCase(),
        name: raw.name,
        ...(raw.value === undefined || raw.password ? {} : { value: raw.value }),
        password: raw.password,
        enabled: raw.enabled,
        hints: raw.hints,
        window: await windowFacts(raw.window)
      }
      return element
    },

    focus: (window) => acted(ask('focus', { window }).then(facts)),

    async click(ref) {
      await acted(ask('click', { key: keyOf(ref).key }))
    },

    async type(ref, text, submit) {
      await acted(ask('type', { key: keyOf(ref).key, text, submit }))
    },

    async press(window, key, ref) {
      const combination = readKey(key)
      if ('problem' in combination) throw new Error(combination.problem)
      await acted(ask('press', { window, keys: system.keys(combination), key: ref === undefined ? undefined : keyOf(ref).key }))
    },

    async scroll(window, direction, screens, ref) {
      await acted(ask('scroll', { window, direction, screens, key: ref === undefined ? undefined : keyOf(ref).key }))
    },

    async seek(window, name, role) {
      const key = seekIn(await ask('tree', { window, limit: ELEMENT_LIMIT }), name, role)
      if (key === undefined) return undefined
      const ref = `e${next++}`
      references.set(ref, { key, window })
      return ref
    },

    async systemKey(key, times) {
      await acted(ask('systemKey', { key: actsOf(system).systemKeys[key], times }))
    },

    async open(link) {
      actsOf(system)
      await ask('open', { link })
    },

    async idle() {
      const ms = await ask('idle', {}).catch(() => null)
      if (ms === null) return undefined
      // The latest input was the adapter's own: the person has not touched anything since.
      if (lastOwn !== undefined && Date.now() - ms <= lastOwn + OWN_INPUT_MS) return undefined
      return ms
    },

    async close() {
      references.clear()
      const running = helper
      helper = undefined
      await running?.close()
    }
  }
}
