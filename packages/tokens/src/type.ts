/**
 * Typefaces, both shipped with the app so it looks the same on every system. Sentences are set in the
 * proportional face. The monospace face is kept for what signals the system: labels, values, keys, the input line.
 */
export const font = {
  sans: '"Geist Variable", "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", sans-serif',
  mono: '"Geist Mono Variable", "Cascadia Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace'
} as const

/**
 * The small capitals of the interface: section names, field labels, states. Smaller than any sentence,
 * spaced out, always in the monospace face.
 */
export const label = { size: '0.6875rem', lineHeight: '1rem', letterSpacing: '0.12em' } as const
