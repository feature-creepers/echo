import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The system's shortcuts, as Electron reaches them: which app holds which keys. */
const system = vi.hoisted(() => ({
  ours: new Map<string, () => void>(),
  /** Keys another app holds: asked for, they are refused. */
  others: new Set<string>()
}))

vi.mock('electron', () => ({
  globalShortcut: {
    register: (accelerator: string, onPress: () => void) => {
      if (system.others.has(accelerator) || system.ours.has(accelerator)) return false
      system.ours.set(accelerator, onPress)
      return true
    },
    unregister: (accelerator: string) => void system.ours.delete(accelerator)
  }
}))

const { createGlobalShortcuts } = await import('./global-shortcut.ts')

const press = (accelerator: string) => system.ours.get(accelerator)?.()

function setup() {
  const pressed: string[] = []
  const shortcuts = createGlobalShortcuts({ talk: () => pressed.push('talk'), stopEverything: () => pressed.push('stop') })
  return { shortcuts, pressed }
}

describe('the shortcuts taken from the whole system', () => {
  beforeEach(() => {
    system.ours.clear()
    system.others.clear()
  })

  it('hold each action on its own keys, and run that action when they are pressed', () => {
    const { shortcuts, pressed } = setup()
    expect(shortcuts.take('talk', 'Alt+Space')).toEqual({ ok: true })
    expect(shortcuts.take('stopEverything', 'Control+Alt+Shift+Escape')).toEqual({ ok: true })
    press('Control+Alt+Shift+Escape')
    press('Alt+Space')
    expect(pressed).toEqual(['stop', 'talk'])
    expect(shortcuts.current('talk')).toBe('Alt+Space')
    expect(shortcuts.current('stopEverything')).toBe('Control+Alt+Shift+Escape')
  })

  it('keep the keys an action had when the system refuses new ones, and say so', () => {
    const { shortcuts } = setup()
    system.others.add('Control+Alt+Delete')
    shortcuts.take('stopEverything', 'Alt+F12')
    const refused = shortcuts.take('stopEverything', 'Control+Alt+Delete')
    expect(refused.ok).toBe(false)
    expect(shortcuts.current('stopEverything')).toBe('Alt+F12')
    expect([...system.ours.keys()]).toEqual(['Alt+F12'])
  })

  it('refuse what cannot be a shortcut without asking the system', () => {
    const { shortcuts } = setup()
    expect(shortcuts.take('talk', 'Hyper+K')).toEqual({ ok: false, problem: 'These keys cannot be used as a shortcut.' })
    expect(system.ours.size).toBe(0)
  })

  it('let go of an action’s keys when given none, and leave the other action’s', () => {
    const { shortcuts } = setup()
    shortcuts.take('talk', 'Alt+Space')
    shortcuts.take('stopEverything', 'Alt+F12')
    shortcuts.take('talk', '')
    expect(shortcuts.current('talk')).toBe('')
    expect([...system.ours.keys()]).toEqual(['Alt+F12'])
  })

  it('let go of every action’s keys while the user records new ones, and take them back after', () => {
    const { shortcuts, pressed } = setup()
    shortcuts.take('talk', 'Alt+Space')
    shortcuts.take('stopEverything', 'Alt+F12')
    shortcuts.suspend(true)
    expect(system.ours.size).toBe(0)
    // Recorded while suspended: the system is asked, so a refusal is heard at once, and the keys let go again.
    expect(shortcuts.take('stopEverything', 'Alt+F11')).toEqual({ ok: true })
    expect(system.ours.size).toBe(0)
    shortcuts.suspend(false)
    press('Alt+F11')
    expect(pressed).toEqual(['stop'])
    expect([...system.ours.keys()].sort()).toEqual(['Alt+F11', 'Alt+Space'])
  })

  it('give every key back to the system when the app quits', () => {
    const { shortcuts } = setup()
    shortcuts.take('talk', 'Alt+Space')
    shortcuts.take('stopEverything', 'Alt+F12')
    shortcuts.release()
    expect(system.ours.size).toBe(0)
  })
})
