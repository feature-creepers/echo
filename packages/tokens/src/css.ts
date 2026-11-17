import { accents, neutralAccent, type AccentName } from './accent.ts'
import { color } from './color.ts'
import { frame } from './frame.ts'
import { motion } from './motion.ts'
import { radius, space } from './space.ts'
import { font, size } from './type.ts'

/** CSS custom properties, by name. */
export type CssVariables = Record<`--${string}`, string>

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)

function group(prefix: string, values: Record<string, string | number>, unit = ''): CssVariables {
  const out: CssVariables = {}
  for (const [name, value] of Object.entries(values)) out[`--${prefix}-${kebab(name)}`] = `${value}${unit}`
  return out
}

/** Every design value as a CSS custom property, for a web renderer to set once at its root. */
export function themeVariables(): CssVariables {
  return {
    ...group('color', color),
    ...group('space', space, 'px'),
    ...group('radius', radius, 'px'),
    ...group('frame', frame, 'px'),
    ...group('font', font),
    ...group('size', size, 'px'),
    ...group('motion', motion, 'ms'),
    ...accentVariables(undefined)
  }
}

/** The accent in use, as CSS custom properties. Set on any element, it colours what is inside. */
export function accentVariables(accent: AccentName | undefined): CssVariables {
  const { solid, soft, glow, ink } = accent ? accents[accent] : neutralAccent
  return { '--accent': solid, '--accent-soft': soft, '--accent-glow': glow, '--accent-ink': ink }
}
