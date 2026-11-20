import type { TONES } from '@repo/catalog'

type Tone = (typeof TONES)[number]

/** A tone as a CSS colour, for drawings and charts. */
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

/** A tone as the colour of a mark on a chart or a timeline, where the normal one is the accent rather than the text. */
export const markColor = (tone: Tone): string => (tone === 'normal' ? 'var(--accent)' : TONE_COLOR[tone])

/** A tone as a text colour class. */
export const TONE_TEXT: Record<Tone, string> = {
  normal: 'text-text',
  soft: 'text-text-soft',
  faint: 'text-text-faint',
  accent: 'text-accent',
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger'
}
