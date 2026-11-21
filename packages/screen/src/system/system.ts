import type { DesktopFound } from '@repo/core'
import type { Combination } from '../keys.ts'
import type { TreeNode } from '../outline.ts'

/**
 * What differs from one system to the next about seeing and operating other apps: how the helper that reads the
 * accessibility tree is started, and how it presses a key. Every system's helper answers the same questions
 * (`Question`), so the adapter above it is the same everywhere.
 */
export interface ScreenSystem {
  /** Whether the system lets the assistant read and operate other apps, or what the person must do first. */
  find(): Promise<DesktopFound>
  /** Start the helper, its files kept in `folder`. */
  helper(folder: string): Helper
  /** A combination as this system's helper presses it. */
  keys(combination: Combination): unknown
}

/** The helper that reads and acts, on one system. */
export interface Helper {
  ask<Name extends keyof Questions>(name: Name, input: Questions[Name]['input']): Promise<Questions[Name]['output']>
  /** Stop it. The next question starts it again. */
  close(): Promise<void>
}

/** A window, as a helper reads it. */
export interface RawWindow {
  id: string
  program: string
  app: string
  title: string
  bounds: { x: number; y: number; width: number; height: number }
  focused: boolean
  minimized: boolean
}

/** An element, as a helper reads it to decide about it. */
export interface RawElement {
  role: string
  name: string
  value?: string | undefined
  password: boolean
  enabled: boolean
  hints: string[]
  /** The identifier of its window. */
  window: string
}

/** Every question a helper answers: its input and its output. Keys are the helper's own, from `tree`. */
export interface Questions {
  windows: { input: Record<string, never>; output: RawWindow[] }
  tree: { input: { window: string; limit: number }; output: TreeNode[] }
  inspect: { input: { key: string }; output: RawElement | null }
  /** The window brought to the front, read again; nothing when it closed meanwhile. */
  focus: { input: { window: string }; output: RawWindow | null }
  click: { input: { key: string }; output: null }
  type: { input: { key: string; text: string; submit: boolean }; output: null }
  press: { input: { window: string; keys: unknown; key?: string | undefined }; output: null }
  scroll: { input: { window: string; direction: 'up' | 'down'; screens: number; key?: string | undefined }; output: null }
  screenshot: { input: { window: string }; output: { data: string; mime: 'image/png' | 'image/jpeg' } }
  /** Milliseconds since the last input of the mouse or the keyboard, by anyone; `null` when the system does not say. */
  idle: { input: Record<string, never>; output: number | null }
  /** Open a link with the app the system gives it. */
  open: { input: { link: string }; output: null }
}
