import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderTheme } from '../packages/tokens/src/theme.ts'

/**
 * Writes the Tailwind theme the web interface imports, from the design values in `@repo/tokens`.
 * Run it after changing a value; a test in that package fails while the file is out of date.
 *
 *   pnpm theme
 */
writeFileSync(fileURLToPath(new URL('../packages/tokens/src/theme.generated.css', import.meta.url)), renderTheme())
