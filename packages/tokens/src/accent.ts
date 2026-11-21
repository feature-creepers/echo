/** How an eye is composed: the sight's triangle and line, or the orbit's arc and squares. */
export type EyeComposition = 'sight' | 'orbit'

/**
 * Accents: the colour a persona shows, by name. Each is the colour itself, the ink that reads on top of it, and how
 * the eye of a persona of that accent is composed. Washes are that colour made more transparent, where they are used.
 */
export const accents = {
  blue: { solid: '#7f9bff', ink: '#0f0f0d', eye: 'orbit' },
  red: { solid: '#f0603c', ink: '#0f0f0d', eye: 'sight' }
} as const satisfies Record<string, { solid: string; ink: string; eye: EyeComposition }>

export type AccentName = keyof typeof accents

/** What stands in for an accent before any persona is known. */
export const neutralAccent = { solid: '#a09b8e', ink: '#0f0f0d' } as const
