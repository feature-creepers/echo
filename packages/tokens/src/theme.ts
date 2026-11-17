import { neutralAccent } from './accent.ts'
import { color } from './color.ts'
import { frame } from './frame.ts'
import { motion } from './motion.ts'
import { radius } from './radius.ts'
import { font, label } from './type.ts'

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

const declarations = (prefix: string, values: Record<string, string | number>, unit = '') =>
  Object.entries(values).map(([name, value]) => `  --${prefix}-${kebab(name)}: ${value}${unit};`)

/**
 * The design values as a Tailwind theme, which is how the web interface reads them: `bg-surface`,
 * `text-text-soft`, `rounded-md`, `font-mono`. The file this renders is `theme.generated.css`; a test fails
 * when the two differ, so the values here stay the single source.
 *
 * The accent is not a fixed colour: it is the `--accent` variable, set on any element to colour what is
 * inside it. That is why it sits in an `inline` theme block, which makes utilities read the variable
 * where they are used and not at the root.
 */
export function renderTheme(): string {
  return [
    '/* Generated from the values in @repo/tokens by `pnpm theme`. Do not edit. */',
    '',
    '@theme {',
    '  --color-*: initial;',
    ...declarations('color', color),
    '',
    ...declarations('font', font),
    '',
    '  --radius-*: initial;',
    ...declarations('radius', radius, 'px'),
    '',
    `  --text-label: ${label.size};`,
    `  --text-label--line-height: ${label.lineHeight};`,
    `  --text-label--letter-spacing: ${label.letterSpacing};`,
    '',
    `  --ease-soft: ${motion.ease};`,
    '}',
    '',
    '@theme inline {',
    '  --color-accent: var(--accent);',
    '  --color-accent-ink: var(--accent-ink);',
    '}',
    '',
    ':root {',
    `  --accent: ${neutralAccent.solid};`,
    `  --accent-ink: ${neutralAccent.ink};`,
    ...declarations('duration', motion.duration, 'ms'),
    ...declarations('frame', frame, 'px'),
    '}',
    ''
  ].join('\n')
}
