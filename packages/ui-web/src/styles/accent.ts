import { type AccentName, accents, neutralAccent } from '@repo/tokens'
import type { CSSProperties } from 'react'

/** The style that makes an element, and everything inside it, show an accent. Left out, the neutral one. */
export function accentStyle(accent: AccentName | undefined): CSSProperties {
  const { solid, ink } = accent ? accents[accent] : neutralAccent
  return { '--accent': solid, '--accent-ink': ink } as CSSProperties
}
