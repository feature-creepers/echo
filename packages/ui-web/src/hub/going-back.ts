/** A key press, as the hub reads it to know whether the person asks to go back. */
export interface BackPress {
  key: string
  code: string
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

/**
 * Whether a key press asks to go back, as it does in a browser and in native apps: Alt and Left on Windows and
 * Linux, Command and [ on a Mac. Escape is the hub's own, heard apart, since a dialog or a recording takes it first.
 */
export function asksToGoBack(press: BackPress, mac: boolean): boolean {
  if (press.shift || press.ctrl) return false
  if (mac) return press.meta && !press.alt && (press.key === '[' || press.code === 'BracketLeft')
  return press.alt && !press.meta && press.key === 'ArrowLeft'
}

/** The mouse's back button, as a page is told of it: the fourth button, numbered from nought. */
export const BACK_BUTTON = 3
