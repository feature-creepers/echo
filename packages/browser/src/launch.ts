/**
 * How the browser is started: as the person's own browser would be, with the few changes driving it needs.
 *
 * Playwright starts a browser for tests, with switches that suit a test and not a person. Most are harmless
 * here; these are dropped:
 *
 * - `--disable-component-update` keeps the browser from fetching its components, Widevine among them: the
 *   module protected video needs, which is fetched on a profile's first use. Without it Netflix, Disney+ and
 *   the like refuse to play.
 * - `--disable-background-networking` stops that fetching too, along with the safe-browsing lists.
 * - `--enable-automation` shows a bar saying the browser is controlled by test software and tells pages they
 *   are driven by a robot, which some sites refuse to serve. Playwright no longer passes it; it is listed so a
 *   version that does again changes nothing here.
 * - `--disable-extensions`, so the person can add the extensions they rely on, a password manager above all,
 *   to sign in themselves.
 * - `--password-store=basic` and `--use-mock-keychain` would keep the profile's sign-ins encrypted with a key
 *   any program can know. The system's own store protects them, as it does the person's own browser.
 *
 * The sandbox stays on (Playwright turns it off unless told): the pages are the open web.
 */
export const IGNORED_DEFAULT_ARGUMENTS = [
  '--disable-component-update',
  '--disable-background-networking',
  '--enable-automation',
  '--disable-extensions',
  '--password-store=basic',
  '--use-mock-keychain'
]

/** Switches added: no question about restoring pages after a crash, and no first-run screens. */
const ADDED_ARGUMENTS = ['--hide-crash-restore-bubble', '--no-first-run', '--no-default-browser-check']

interface LaunchSettings {
  /** The browser's program. */
  executablePath: string
  /** Whether to run with no window: for tests only. The person always sees the browser. */
  headless: boolean
  /** Whether the browser sandboxes its pages: always, but in development where the system refuses it. */
  sandbox: boolean
}

/** The options Playwright is given to start the browser on the assistant's profile. */
export function launchOptions({ executablePath, headless, sandbox }: LaunchSettings) {
  return {
    executablePath,
    headless,
    // The page follows the window's size, as in the person's own browser, rather than a fixed test viewport.
    viewport: null,
    chromiumSandbox: sandbox,
    // Downloads land in a folder of Playwright's while they run, and are then saved, under their own names, in the assistant's.
    acceptDownloads: true,
    ignoreDefaultArgs: IGNORED_DEFAULT_ARGUMENTS,
    args: ADDED_ARGUMENTS
  }
}
