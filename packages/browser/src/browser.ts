import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { ActionOutcome, Browser, BrowserFound, ElementFacts, Log, PageFacts } from '@repo/core'
import { type BrowserContext, chromium, type Download, type Locator, type Page } from 'playwright-core'
import { BROWSER_VARIABLE, findBrowser, SANDBOX_VARIABLE } from './find/find.ts'
import { systemBrowsers } from './find/index.ts'
import { launchOptions } from './launch.ts'
import { changesBetween, type Outline, outlineOf, outlineText } from './outline.ts'
import { readElement } from './page/element.ts'
import { readPage } from './page/readable.ts'

/** How long the browser stays open with nothing done in it, by the assistant or the person. */
const IDLE_MS = 15 * 60 * 1000

/** How long an action on an element waits for it to be ready (visible, enabled, still). */
const ACTION_TIMEOUT_MS = 10_000
/** How long opening an address waits for the page to be there. */
const NAVIGATION_TIMEOUT_MS = 30_000
/** How long a page is given to settle after it is there or after an action: its loading, then its network falling quiet. */
const SETTLE_LOAD_MS = 5_000
const SETTLE_QUIET_MS = 1_500
/** How long the outline or the picture of a page may take. */
const CAPTURE_TIMEOUT_MS = 15_000

export interface BrowserOptions {
  /** The browser's profile: a folder of its own, kept between launches, where the person's sign-ins stay. */
  profile: string
  /** Where downloads are saved: in the assistant's own folder. Made at the first download. */
  downloads: string
  log: Log
  /** The browser's program, in place of the one found on the system: for development and tests. Left out, `ASSISTANT_BROWSER`, then the system's. */
  executable?: string | undefined
  /** No window: for tests only. The person always sees the browser. */
  headless?: boolean
  /** Whether the browser sandboxes its pages. Left out, it does, unless `ASSISTANT_BROWSER_SANDBOX` is `off`. */
  sandbox?: boolean
  /** How long the browser stays open unused. Left out, fifteen minutes. */
  idleMs?: number
}

/** A reference the latest outline of the tab does not have: said to the model as it is. */
class UnknownReference extends Error {}

/** The first line of a message from Playwright, without the name of the call it comes from ("page.goto: "). */
const firstLine = (message: string) => (message.split('\n')[0] ?? '').replace(/^[a-zA-Z]+\.[a-zA-Z]+: /, '').trim()

/** An error from Playwright, said for a model: its first line, without the name of the call. */
function explained(error: unknown, what?: string): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/has been closed|Target closed|browser has disconnected/i.test(message)) {
    return new Error('The browser window was closed while this was done. Try again: it opens again.')
  }
  if (/Timeout \d+ms exceeded/i.test(message) && what) {
    return new Error(`${what} did not work in time: the element may be hidden, covered or disabled. Take a new browser_snapshot, or scroll to it first.`)
  }
  return new Error(what ? `${what} did not work: ${firstLine(message)}` : firstLine(message))
}

/** A file name for a download that does not replace one already there: "report (2).pdf". */
function freeName(folder: string, suggested: string): string {
  const name = basename(suggested).replace(/[<>:"/\\|?*]/g, '_') || 'download'
  const extension = extname(name)
  const stem = name.slice(0, name.length - extension.length)
  let candidate = join(folder, name)
  for (let count = 2; existsSync(candidate); count++) candidate = join(folder, `${stem} (${count})${extension}`)
  return candidate
}

/**
 * The browser the assistant drives, through Playwright: the Chromium-based browser installed on the computer
 * (Microsoft Edge, Google Chrome, Chromium), with a window the person sees and a profile of its own.
 *
 * It starts at its first use, and closes after fifteen minutes with nothing done in it and when the core stops.
 * Closed by the person, it opens again at the next use. Calls are carried out one at a time, in order: two
 * threads of the assistant never act on a page at once.
 */
export function createBrowser(options: BrowserOptions): Browser {
  const idleMs = options.idleMs ?? IDLE_MS
  let context: BrowserContext | undefined
  let starting: Promise<BrowserContext> | undefined
  /** The tab the assistant works in: the last one opened or brought forward. */
  let current: Page | undefined
  /** The latest outline of each page: its references are the ones that page's actions take. */
  const outlines = new WeakMap<Page, Outline>()
  /** Downloads started since this was last read, by where they are saved. */
  let downloading: string[] = []
  let idle: ReturnType<typeof setTimeout> | undefined
  let queue: Promise<unknown> = Promise.resolve()

  const find = (): Promise<BrowserFound> => {
    const { candidates, missing } = systemBrowsers()
    return findBrowser({ candidates, missing, override: options.executable ?? process.env[BROWSER_VARIABLE] })
  }

  /** Something happened in the browser: the idle time starts again. */
  const touch = () => {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => void close(), idleMs)
    idle.unref?.()
  }

  const close = async () => {
    if (idle) clearTimeout(idle)
    idle = undefined
    const closing = context ?? (await starting?.catch(() => undefined))
    context = undefined
    current = undefined
    await closing?.close().catch((error: unknown) => options.log.error(`The browser did not close cleanly: ${String(error)}`))
  }

  const save = async (download: Download) => {
    const target = freeName(options.downloads, download.suggestedFilename())
    downloading.push(target)
    try {
      await mkdir(options.downloads, { recursive: true })
      await download.saveAs(target)
    } catch (error) {
      options.log.error(`A download to ${target} failed: ${String(error)}`)
    }
  }

  const follow = (page: Page) => {
    page.on('download', (download) => void save(download))
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) touch()
    })
    page.on('close', () => {
      if (current === page) current = context?.pages().at(-1)
    })
  }

  const start = async (): Promise<BrowserContext> => {
    const found = await find()
    if (!found.found) throw new Error(found.problem)
    await mkdir(options.profile, { recursive: true })
    let launched: BrowserContext
    try {
      launched = await chromium.launchPersistentContext(options.profile, {
        ...launchOptions({
          executablePath: found.path,
          headless: options.headless ?? false,
          sandbox: options.sandbox ?? process.env[SANDBOX_VARIABLE] !== 'off'
        }),
        // The core stops the browser itself when it is told to stop: Playwright's own handling would end the process first.
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      options.log.error(`${found.name} could not start: ${message}`)
      if (/ProcessSingleton|profile.*in use|SingletonLock/i.test(message)) {
        throw new Error(`${found.name} could not start: its profile is in use by another window of it. Close that window and try again.`)
      }
      throw new Error(`${found.name} could not start. ${firstLine(message)}`)
    }
    // Closed by the person (its last window) or ended for any reason: the next use starts it again.
    launched.on('close', () => {
      if (context === launched) {
        context = undefined
        current = undefined
      }
    })
    launched.on('page', (page) => {
      follow(page)
      // A tab the page opened (a link to a new tab, a sign-in window) is where the work goes on.
      current = page
      touch()
    })
    for (const page of launched.pages()) follow(page)
    return launched
  }

  /** The running browser, started when it is not. */
  const running = async (): Promise<BrowserContext> => {
    if (context) return context
    starting ??= start().finally(() => {
      starting = undefined
    })
    context = await starting
    return context
  }

  /** The tab to work in, with a window to show it: one is opened when the person closed them all. */
  const page = async (): Promise<Page> => {
    const browser = await running()
    if (current && !current.isClosed()) return current
    current = browser.pages().at(-1) ?? (await browser.newPage())
    return current
  }

  /** Run one call after the others, keeping the browser awake around it. */
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      touch()
      try {
        return await work()
      } finally {
        touch()
      }
    })
    queue = run.catch(() => undefined)
    return run
  }

  const facts = async (of: Page): Promise<PageFacts> => ({ url: of.url(), title: await of.title().catch(() => '') })

  const settle = async (of: Page) => {
    await of.waitForLoadState('load', { timeout: SETTLE_LOAD_MS }).catch(() => undefined)
    await of.waitForLoadState('networkidle', { timeout: SETTLE_QUIET_MS }).catch(() => undefined)
  }

  /** A new outline of a page, which becomes the one its references are read against. */
  const outline = async (of: Page): Promise<Outline> => {
    const snapshot = await of.ariaSnapshot({ mode: 'ai', timeout: CAPTURE_TIMEOUT_MS })
    const read = outlineOf(snapshot)
    outlines.set(of, read)
    return read
  }

  /** An element of the latest outline of the tab in front. Rejects when the outline has no such reference. */
  const element = (of: Page, ref: string): Locator => {
    if (!outlines.get(of)?.refs.has(ref))
      throw new UnknownReference(`There is no element ${ref} on the page now. Take a new browser_snapshot and use its references.`)
    return of.getByRef(ref)
  }

  /**
   * Carry out an action, then tell what it changed: where the tab in front is, and the elements of a new outline
   * that the one before did not have. An action that opened a tab reports that tab.
   */
  const act = (what: string, work: (of: Page) => Promise<void>): Promise<ActionOutcome> =>
    serial(async () => {
      const before = await page()
      const had = outlines.get(before)?.lines ?? []
      downloading = []
      try {
        await work(before)
      } catch (error) {
        throw error instanceof UnknownReference ? error : explained(error, what)
      }
      const after = await page()
      await settle(after)
      const now = await outline(after).catch(() => undefined)
      const changes = now ? changesBetween(after === before ? had : [], now.lines) : []
      const saved = downloading.map((path) => `- download: saved to ${path}`)
      if (after !== before) changes.unshift('- (a new tab opened, and is now in front)')
      return { ...(await facts(after)), changes: [...saved, ...changes] }
    })

  return {
    find,

    running: () => context !== undefined,

    show: () =>
      serial(async () => {
        const shown = await page()
        await shown.bringToFront()
        return facts(shown)
      }),

    go: (url, tab) =>
      serial(async () => {
        const browser = await running()
        const front = await page()
        // The empty tab a browser starts with is used rather than left behind.
        const target = tab === 'new' && front.url() !== 'about:blank' ? await browser.newPage() : front
        current = target
        try {
          await target.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS })
        } catch (error) {
          throw explained(error, `Opening ${url}`)
        }
        await settle(target)
        await target.bringToFront()
        return facts(target)
      }),

    read: (from, length) =>
      serial(async () => {
        const shown = await page()
        const text = await shown.evaluate(readPage)
        return { ...(await facts(shown)), text: text.slice(from, from + length), from: Math.min(from, text.length), total: text.length }
      }),

    snapshot: (length) =>
      serial(async () => {
        const shown = await page()
        const read = await outline(shown).catch((error: unknown) => {
          throw explained(error, 'Taking the outline')
        })
        const { text, cut } = outlineText(read, length)
        return { ...(await facts(shown)), outline: text, cut }
      }),

    screenshot: () =>
      serial(async () => {
        const shown = await page()
        const picture = await shown.screenshot({ type: 'jpeg', quality: 70, timeout: CAPTURE_TIMEOUT_MS }).catch((error: unknown) => {
          throw explained(error, 'Taking the picture')
        })
        return { ...(await facts(shown)), data: picture.toString('base64'), mime: 'image/jpeg' as const }
      }),

    scroll: (how) =>
      serial(async () => {
        const shown = await page()
        if ('ref' in how) {
          await element(shown, how.ref)
            .scrollIntoViewIfNeeded({ timeout: ACTION_TIMEOUT_MS })
            .catch((error: unknown) => {
              throw explained(error, `Scrolling to ${how.ref}`)
            })
        } else {
          // The wheel, in the middle of the window: it scrolls what is under it, as the person's would, inner panes included.
          const size = await shown.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
          await shown.mouse.move(size.width / 2, size.height / 2)
          await shown.mouse.wheel(0, (how.direction === 'down' ? 1 : -1) * size.height * 0.85 * how.screens)
          await shown.waitForTimeout(400)
        }
        return facts(shown)
      }),

    back: () =>
      serial(async () => {
        const shown = await page()
        const was = shown.url()
        await shown.goBack({ waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS }).catch((error: unknown) => {
          throw explained(error, 'Going back')
        })
        if (shown.url() === was) throw new Error('There is no earlier page in this tab.')
        await settle(shown)
        return facts(shown)
      }),

    tabs: () =>
      serial(async () => {
        const browser = await running()
        const front = await page()
        return Promise.all(browser.pages().map(async (tab) => ({ ...(await facts(tab)), current: tab === front })))
      }),

    tab: (index, change) =>
      serial(async () => {
        const browser = await running()
        const tab = browser.pages()[index]
        if (!tab) throw new Error(`There is no tab ${index}: list them with browser_tabs.`)
        if (change === 'close') {
          await tab.close()
        } else {
          current = tab
          await tab.bringToFront()
        }
        return facts(await page())
      }),

    wait: (until) =>
      serial(async () => {
        const shown = await page()
        if ('text' in until) {
          await shown
            .getByText(until.text)
            .first()
            .waitFor({ state: 'visible', timeout: until.ms })
            .catch(() => {
              throw new Error(`“${until.text}” did not appear within ${Math.round(until.ms / 1000)} seconds.`)
            })
        } else {
          await shown.waitForTimeout(until.ms)
        }
        return facts(shown)
      }),

    inspect: (ref) =>
      serial(async (): Promise<ElementFacts | undefined> => {
        const shown = await page()
        const where = await facts(shown)
        if (ref === undefined) {
          const focused = await shown.evaluateHandle(() => document.activeElement)
          const reading = await focused.asElement()?.evaluate(readElement)
          // The page would otherwise keep the element for the handle until it navigates.
          await focused.dispose()
          if (!reading || reading.tag === 'body' || reading.tag === 'html') return undefined
          const { fileField: _, ...rest } = reading
          return { ref: '', ...rest, page: where }
        }
        const known = outlines.get(shown)?.refs.get(ref)
        if (!known) return undefined
        const reading = await shown
          .getByRef(ref)
          .evaluate(readElement, undefined, { timeout: 5_000 })
          .catch(() => undefined)
        if (!reading) return undefined
        const { fileField: _, ...rest } = reading
        return { ...rest, ref, role: known.role || reading.role, name: known.name || reading.name, page: where }
      }),

    click: (ref) => act(`Clicking ${ref}`, (of) => element(of, ref).click({ timeout: ACTION_TIMEOUT_MS })),

    type: (ref, text, submit) =>
      act(`Typing in ${ref}`, async (of) => {
        const field = element(of, ref)
        await field.fill(text, { timeout: ACTION_TIMEOUT_MS })
        if (submit) await field.press('Enter', { timeout: ACTION_TIMEOUT_MS })
      }),

    select: (ref, values) =>
      act(`Choosing in ${ref}`, async (of) => {
        await element(of, ref).selectOption([...values], { timeout: ACTION_TIMEOUT_MS })
      }),

    press: (key, ref) =>
      act(`Pressing ${key}`, async (of) => {
        if (ref === undefined) await of.keyboard.press(key)
        else await element(of, ref).press(key, { timeout: ACTION_TIMEOUT_MS })
      }),

    upload: (ref, paths) =>
      act(`Giving files to ${ref}`, async (of) => {
        const field = element(of, ref)
        if ((await field.evaluate(readElement)).fileField) {
          await field.setInputFiles([...paths], { timeout: ACTION_TIMEOUT_MS })
          return
        }
        // A button that opens the system's picker: the picker is answered with the files instead of being shown.
        const [chooser] = await Promise.all([of.waitForEvent('filechooser', { timeout: ACTION_TIMEOUT_MS }), field.click({ timeout: ACTION_TIMEOUT_MS })])
        await chooser.setFiles([...paths])
      }),

    close
  }
}
