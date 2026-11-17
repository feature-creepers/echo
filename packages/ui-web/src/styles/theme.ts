import { accentVariables, themeVariables, type AccentName } from '@repo/tokens'
import type { CSSProperties } from 'react'
import './global.css'

/** Set every design value on the root of the page. Called once by the app, before the first draw. */
export function applyTheme(root: HTMLElement): void {
  for (const [name, value] of Object.entries(themeVariables())) root.style.setProperty(name, value)
}

/** The style that makes an element, and everything inside it, show an accent. Left out, the neutral one. */
export function accentStyle(accent: AccentName | undefined): CSSProperties {
  return accentVariables(accent) as CSSProperties
}
