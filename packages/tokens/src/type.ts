/**
 * Typefaces. Sentences and controls are set in the system's own face, as native apps are: San Francisco on
 * macOS, Segoe UI on Windows. Linux has no single system face, so Geist, shipped with the app, stands in.
 * The monospace face is kept for what is technical: values, code, paths, the inspector. Keys are shown in the
 * sentence face, as the system shows them in its menus.
 */
export const font = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", "Geist Variable", system-ui, sans-serif',
  mono: 'ui-monospace, "SF Mono", "Cascadia Mono", "Geist Mono Variable", Menlo, Consolas, monospace'
} as const

/**
 * The small labels of the interface: a group's name, a field's label, a state. In sentence case and in the
 * sentence face, a little smaller than body text, as system settings label their groups.
 */
export const label = { size: '0.75rem', lineHeight: '1rem', letterSpacing: '0' } as const
