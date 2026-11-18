import { describeShortcut, isShortcut } from '@repo/client'
import { globalShortcut } from 'electron'

export type ShortcutTry = { ok: true } | { ok: false; problem: string }

/**
 * The one shortcut the app takes from the whole system: talking from any app. The system gives it to the
 * first app that asks; when another app or the system holds it, Electron is refused, and so is the user.
 *
 * Under Wayland on Linux an app cannot take a global shortcut at all: talking stays on the key inside the
 * window, and the user can bind a desktop shortcut to the app (docs/SPEC.md, section 8.3).
 */
export interface GlobalShortcut {
  /** The shortcut held now, empty when none. */
  current(): string
  /** Take these keys in place of the current ones. Refused, the current ones are kept. An empty text lets go of them. */
  take(accelerator: string): ShortcutTry
  /** Let go of the keys for a while, so that a key press reaches the window: while the user records a new shortcut. */
  suspend(suspended: boolean): void
  release(): void
}

export function createGlobalShortcut(onPress: () => void): GlobalShortcut {
  let held = ''
  let suspended = false
  const mac = process.platform === 'darwin'

  const register = (accelerator: string) => {
    try {
      return globalShortcut.register(accelerator, onPress)
    } catch {
      // Electron throws on keys it cannot read.
      return false
    }
  }

  return {
    current: () => held,
    take(accelerator) {
      if (accelerator !== '' && !isShortcut(accelerator)) return { ok: false, problem: 'These keys cannot be used as a shortcut.' }
      if (accelerator === held) return { ok: true }
      if (held !== '' && !suspended) globalShortcut.unregister(held)
      // Asked of the system even while suspended, so that the user hears at once that the keys are taken.
      const taken = accelerator === '' || register(accelerator)
      if (taken) {
        if (suspended && accelerator !== '') globalShortcut.unregister(accelerator)
        held = accelerator
        return { ok: true }
      }
      if (held !== '' && !suspended) register(held)
      return { ok: false, problem: `${describeShortcut(accelerator, mac)} is taken by the system or by another app. Try other keys.` }
    },
    suspend(next) {
      if (next === suspended) return
      suspended = next
      if (held === '') return
      if (next) globalShortcut.unregister(held)
      else register(held)
    },
    release() {
      if (held !== '' && !suspended) globalShortcut.unregister(held)
    }
  }
}
