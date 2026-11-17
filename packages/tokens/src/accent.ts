/**
 * Accents: the one glowing colour on screen at a time. A persona shows one, by name.
 *
 * Each has four values: the colour itself, a faint wash of it behind things, its glow, and the ink
 * that reads on top of the colour.
 */
export const accents = {
  cyan: { solid: '#4cc2ff', soft: 'rgba(76, 194, 255, 0.12)', glow: 'rgba(76, 194, 255, 0.42)', ink: '#031018' },
  red: { solid: '#ff5a52', soft: 'rgba(255, 90, 82, 0.12)', glow: 'rgba(255, 90, 82, 0.42)', ink: '#190403' }
} as const

export type AccentName = keyof typeof accents

/** What stands in for an accent before any persona is known. */
export const neutralAccent = { solid: '#a3afbf', soft: 'rgba(163, 175, 191, 0.10)', glow: 'rgba(163, 175, 191, 0.25)', ink: '#07090c' } as const
