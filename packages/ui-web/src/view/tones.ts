import type { TONES } from '@repo/catalog'

type Tone = (typeof TONES)[number]

/** A tone as a CSS colour, for drawings and maps. */
export const TONE_COLOR: Record<Tone | 'none', string> = {
  normal: 'var(--color-text)',
  soft: 'var(--color-text-soft)',
  faint: 'var(--color-text-faint)',
  accent: 'var(--accent)',
  ok: 'var(--color-ok)',
  warn: 'var(--color-warn)',
  danger: 'var(--color-danger)',
  none: 'none'
}

/**
 * A tone as the colour of a mark: a bar, a square, a point on a chart or a map. What matters is said in the full ink:
 * the persona's accent is kept for what plays, and a mark in it would read as a state.
 */
export const markColor = (tone: Tone): string => (tone === 'accent' ? TONE_COLOR.normal : TONE_COLOR[tone])

/** A tone as a text colour class. The accent reads as the full ink, for the same reason as a mark's. */
export const TONE_TEXT: Record<Tone, string> = {
  normal: 'text-text',
  soft: 'text-text-soft',
  faint: 'text-text-faint',
  accent: 'text-text',
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger'
}
