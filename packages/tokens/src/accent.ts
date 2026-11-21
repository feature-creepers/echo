/**
 * Accents: the colour a persona shows, by name. Each is the colour itself and the ink that reads on top of it.
 * Washes are that colour made more transparent, where they are used.
 */
export const accents = {
  blue: { solid: '#6b85f5', ink: '#0f0f0d' },
  red: { solid: '#f0603c', ink: '#0f0f0d' }
} as const

export type AccentName = keyof typeof accents

/** What stands in for an accent before any persona is known. */
export const neutralAccent = { solid: '#a09b8e', ink: '#0f0f0d' } as const
