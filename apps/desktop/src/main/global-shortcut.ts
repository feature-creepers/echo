import { describeShortcut, isShortcut } from '@repo/client'
import { globalShortcut } from 'electron'

export type ShortcutTry = { ok: true } | { ok: false; problem: string }

/**
 * The shortcuts the app takes from the whole system, each for one action: talking from any app, stopping
 * everything. The system gives keys to the first app that asks; when another app or the system holds them,
 * Electron is refused, and so is the user.
 *
 * Under Wayland on Linux an app cannot take a global shortcut at all: talking stays on the key inside the
 * window, and the user can bind a desktop shortcut to the app's options (docs/SPEC.md, section 8.3).
 */
export interface GlobalShortcuts<Name extends string> {
  /** The keys an action holds now, empty when none. */
  current(name: Name): string
  /** Give an action these keys in place of its current ones. Refused, the current ones are kept. An empty text lets go of them. */
  take(name: Name, accelerator: string): ShortcutTry
  /** Let go of every action's keys for a while, so that a key press reaches the window: while the user records a new shortcut. */
  suspend(suspended: boolean): void
  release(): void
}

export function createGlobalShortcuts<Name extends string>(actions: Record<Name, () => void>): GlobalShortcuts<Name> {
  const held = new Map<Name, string>()
  let suspended = false
  const mac = process.platform === 'darwin'

  const register = (name: Name, accelerator: string) => {
    try {
      return globalShortcut.register(accelerator, actions[name])
    } catch {
      // Electron throws on keys it cannot read.
      return false
    }
  }
  const current = (name: Name) => held.get(name) ?? ''

  return {
    current,
    take(name, accelerator) {
      if (accelerator !== '' && !isShortcut(accelerator)) return { ok: false, problem: 'These keys cannot be used as a shortcut.' }
      const before = current(name)
      if (accelerator === before) return { ok: true }
      if (before !== '' && !suspended) globalShortcut.unregister(before)
      // Asked of the system even while suspended, so that the user hears at once that the keys are taken.
      const taken = accelerator === '' || register(name, accelerator)
      if (taken) {
        if (suspended && accelerator !== '') globalShortcut.unregister(accelerator)
        held.set(name, accelerator)
        return { ok: true }
      }
      if (before !== '' && !suspended) register(name, before)
      return { ok: false, problem: `${describeShortcut(accelerator, mac)} is taken by the system or by another app. Try other keys.` }
    },
    suspend(next) {
      if (next === suspended) return
      suspended = next
      for (const [name, accelerator] of held) {
        if (accelerator === '') continue
        if (next) globalShortcut.unregister(accelerator)
        else register(name, accelerator)
      }
    },
    release() {
      if (suspended) return
      for (const accelerator of held.values()) if (accelerator !== '') globalShortcut.unregister(accelerator)
    }
  }
}
