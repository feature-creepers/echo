import type { Bounds } from '@repo/protocol'

/**
 * The other apps of the computer, as the assistant sees and operates them (docs/SPEC.md, section 12.1,
 * `device.screen`): their windows, each window's elements as the system's accessibility tree names them, and
 * acts on those elements. UI Automation on Windows, the accessibility API on macOS, AT-SPI on Linux.
 *
 * The adapter only carries out. Which app may be used, what is asked first, and what is never done, such as typing
 * into a password field, is the core's to decide: it reads what an element is with `inspect` before acting on it.
 *
 * Elements are named by the references of the latest outline of a window (`look`), such as `e12`. A reference
 * outlives no new outline of the same window.
 *
 * A method rejects with an `Error` whose message is written for a model to act on: "There is no element e12:
 * look at the window again."
 */
export interface Desktop {
  /** Whether this computer lets the assistant read and operate other apps, found without acting on any. */
  find(): Promise<DesktopFound>
  /** The windows open now, in front first, the app's own windows left out. */
  windows(): Promise<WindowFacts[]>
  /** What can be read and used in a window, as an outline with a reference for each element, at most `length` characters. */
  look(window: string, length: number): Promise<WindowOutline>
  /** What a window shows now, as a picture. */
  screenshot(window: string): Promise<WindowImage>
  /** What an element of the latest outline is, for the core to decide whether to act on it. Nothing when it is gone. */
  inspect(ref: string): Promise<DesktopElement | undefined>
  /** Bring a window to the front, restored if it was minimised. */
  focus(window: string): Promise<WindowFacts>
  /** Use an element: press a button, follow a link, toggle a box, pick an item. */
  click(ref: string): Promise<void>
  /** Type into a field, replacing what it holds, then press Enter when `submit`. */
  type(ref: string, text: string, submit: boolean): Promise<void>
  /** Press a key or a combination ("Enter", "Control+S"), in the window, on an element when given. */
  press(window: string, key: string, ref?: string): Promise<void>
  /** Scroll a window, or the element given, by about a screenful. */
  scroll(window: string, direction: 'up' | 'down', screens: number, ref?: string): Promise<void>
  /**
   * How long ago the person last used the mouse or the keyboard themselves, in milliseconds, what the adapter did
   * itself left out. Nothing when the system does not say.
   */
  idle(): Promise<number | undefined>
  /** Let go of everything: the helper that reads the screen stops. The next use starts it again. */
  close(): Promise<void>
}

/** Whether the system lets the assistant use other apps, or why not, in words for the person. */
export type DesktopFound = { available: true } | { available: false; problem: string }

/** A window of another app. */
export interface WindowFacts {
  /** How the adapter finds it again, while it is open. */
  id: string
  /** The program, as the system names it, without its extension and in lower case: `notepad`, `textedit`. */
  program: string
  /** The app's name, as the person knows it: "Notepad". */
  app: string
  title: string
  bounds: Bounds
  /** Whether it is the window in front. */
  focused: boolean
  minimized: boolean
}

/** What can be read and used in a window, one element per line with its reference, indented as the window nests them. */
export interface WindowOutline {
  window: WindowFacts
  outline: string
  /** Whether the outline was cut to the length asked. */
  cut: boolean
}

export interface WindowImage {
  window: WindowFacts
  /** The picture, encoded in base 64. */
  data: string
  mime: 'image/png' | 'image/jpeg'
}

/** What an element of a window is, as far as deciding whether to act on it needs. Every text comes from the app. */
export interface DesktopElement {
  ref: string
  /** Its role, as the accessibility tree names it: button, edit, link, menu item, check box. */
  role: string
  /** Its accessible name: "Save", "File name". */
  name: string
  /** What it holds, for a field, shortened. Never a password field's. */
  value?: string | undefined
  /** Whether the system marks it as a field for a secret: a password box. */
  password: boolean
  enabled: boolean
  /** What else names it for the app and for the person: its identifier, its help text. */
  hints: string[]
  /** The window it is in. */
  window: WindowFacts
}
