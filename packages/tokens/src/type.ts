/**
 * Typefaces, all shipped with the app so it reads the same on every system. Sentences and controls are set in
 * Instrument Sans. Short titles and large figures are set in Big Shoulders: condensed, heavy, in capitals. Small
 * labels are set in Geist Pixel, in capitals. The monospace face is kept for what is technical: values, code, paths.
 */
export const font = {
  sans: '"Instrument Sans Variable", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
  display: '"Big Shoulders Variable", Bahnschrift, "Arial Narrow", sans-serif',
  pixel: '"Geist Pixel", "Geist Mono Variable", ui-monospace, monospace',
  mono: '"Geist Mono Variable", ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace'
} as const

/**
 * The small labels of the interface: a group's name, a field's label, a time, a state. In capitals in the pixel
 * face, spaced a little, smaller than body text.
 */
export const label = { size: '0.6875rem', lineHeight: '1rem', letterSpacing: '0.04em' } as const
