/**
 * Accents: the one glowing colour on screen at a time. A persona shows one, by name.
 * Each is the colour itself and the ink that reads on top of it. Washes and glows are that colour made
 * more transparent, where they are used.
 */
export const accents = {
  cyan: { solid: '#5ac8ff', ink: '#04121a' },
  red: { solid: '#ff5f57', ink: '#1c0503' }
} as const

export type AccentName = keyof typeof accents

/** What stands in for an accent before any persona is known. */
export const neutralAccent = { solid: '#a4adbb', ink: '#05070a' } as const
