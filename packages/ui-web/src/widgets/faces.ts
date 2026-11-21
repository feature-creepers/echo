import pixel from '@fontsource/geist-pixel/files/geist-pixel-latin-400-normal.woff2?inline'
import display from '@fontsource-variable/big-shoulders/files/big-shoulders-latin-wght-normal.woff2?inline'
import mono from '@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?inline'
import sans from '@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2?inline'
import { font } from '@repo/tokens'
import type { Face } from './page.ts'

/** The face a stack of the tokens names first: the one the app ships. */
const first = (stack: string) => /^"([^"]+)"/.exec(stack)?.[1] ?? stack

/**
 * The app's four faces for a widget's page (docs/SPEC.md, section 9.9), their Latin letters only, written into the
 * page: its frame's policy loads a font from no address, and the window's own files are not reachable from it. About
 * 140 KB, so this module is loaded with the first widget app drawn.
 */
export const FACES: readonly Face[] = [
  { family: first(font.sans), weight: '400 700', source: sans },
  { family: first(font.display), weight: '100 900', source: display },
  { family: first(font.pixel), weight: '400', source: pixel },
  { family: first(font.mono), weight: '100 900', source: mono }
]
