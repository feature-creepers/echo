import type { Look } from '@repo/protocol'
import { type AccentName, accents, neutralAccent } from '@repo/tokens'
import type { CSSProperties } from 'react'

/**
 * The style that makes an element, and everything inside it, show an accent. Left out, the neutral one. Given a
 * look, a core drawn inside takes it too; left out, the core takes the look around it.
 */
export function accentStyle(accent: AccentName | undefined, look?: Look): CSSProperties {
  const { solid, ink } = accent ? accents[accent] : neutralAccent
  return { '--accent': solid, '--accent-ink': ink, ...(look && { '--look': look }) } as CSSProperties
}
