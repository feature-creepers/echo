/**
 * Typefaces. Sentences are set in the system's proportional face. The monospace face is kept for what
 * signals the system: labels, values, keys, the input line.
 */
export const font = {
  sans: '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", "Noto Sans", sans-serif',
  mono: '"Cascadia Mono", "JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, "DejaVu Sans Mono", monospace'
} as const

/** Text sizes, in pixels. */
export const size = { label: 11, small: 13, body: 15, lead: 18, title: 30, display: 40 } as const

export type SizeName = keyof typeof size
