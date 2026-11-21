import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The product is generic (docs/SPEC.md, section 12.1): only the modules of `src/providers/` name a provider's hosts,
 * scopes or calls, and no app registration is ever in the repository: it is the build's configuration.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url))
// The repository's files, those not committed yet included, and none it ignores.
const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
const read = (path: string) => readFileSync(`${root}${path}`, 'utf8')
/** This file, which writes the patterns down. */
const itself = 'packages/accounts/test/generic.test.ts'

/** What only a provider's module may name. */
const PROVIDER_NAMES = [
  /(oauth2|www|gmail)\.googleapis\.com/,
  /accounts\.google\.com/,
  /login\.microsoftonline\.com/,
  /graph\.microsoft\.com/,
  /auth\/(calendar|gmail)\./,
  /\b(Calendars|Mail|User)\.Read\b/,
  /\busers\/me\//,
  /calendarView|mailFolders|historyId/
]

/** What an app registration looks like, written down. */
const REGISTRATIONS = [/\.apps\.googleusercontent\.com/, /GOCSPX-/, /ECHO_(GOOGLE|MICROSOFT)_CLIENT_(ID|SECRET)\s*[=:]\s*['"]?[\w.-]{6,}/]

/** Both read every file of the repository, which takes longer than a test's default while the whole check runs at once. */
const READS_EVERYTHING_MS = 30_000

describe('the product', () => {
  it('names no provider’s hosts, scopes or calls outside the providers’ own modules', () => {
    const product = tracked.filter((path) => /^(apps|packages)\/[^/]+\/src\/.*\.tsx?$/.test(path) && !path.startsWith('packages/accounts/src/providers/'))
    expect(product.length).toBeGreaterThan(100)
    const naming = product.filter((path) => PROVIDER_NAMES.some((name) => name.test(read(path))))
    expect(naming).toEqual([])
  }, READS_EVERYTHING_MS)

  it('holds no app registration', () => {
    const holding = tracked.filter(
      (path) => path !== itself && !/\.(png|ico|icns|woff2?|ttf|onnx|bin)$/.test(path) && REGISTRATIONS.some((pattern) => pattern.test(read(path)))
    )
    expect(holding).toEqual([])
  }, READS_EVERYTHING_MS)
})
