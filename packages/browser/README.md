# @repo/browser

The adapter that drives a web browser for the core: the Chromium-based browser installed on the computer (Microsoft Edge, Google Chrome, Chromium), through `playwright-core`. It implements the `Browser` port of `@repo/core`. It downloads no browser.

What the assistant may do in the browser, and what is asked or refused first, is decided by the core (`core/src/browser/`), never here: this package opens, reads, outlines, pictures and acts, and says what an element is when asked.

- **Runs in:** Node (the core's process; in the desktop app, an Electron utility process)
- **May import:** `@repo/core`
- **Entry points:** `@repo/browser`

The import rule is enforced by `biome.jsonc` and explained in [docs/SPEC.md](../../docs/SPEC.md), section 14.3.

## Use

```ts
import { createBrowser } from '@repo/browser'

const browser = createBrowser({ profile: join(data, 'browser'), downloads: join(workspace, 'downloads'), log })
await browser.go('https://example.org', 'current')
const { outline } = await browser.snapshot(12_000) // "- link "More information" [ref=e6]"
const element = await browser.inspect('e6') // what the core decides from
await browser.click('e6') // where the tab is now, and what is new on the page
await browser.close()
```

| Option       | Meaning                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| `profile`    | The browser's own profile folder, kept between launches: the person's sign-ins stay there.                    |
| `downloads`  | Where downloads are saved, under their own names. Made at the first download.                                 |
| `log`        | Where the adapter reports what the model is not told: a browser that could not start, a download that failed. |
| `executable` | The browser's program, in place of the one found. Left out, `ASSISTANT_BROWSER`, then the system's.           |
| `headless`   | No window. For tests only: the person always sees the browser.                                                |
| `sandbox`    | Whether the browser sandboxes its pages. Left out, it does, unless `ASSISTANT_BROWSER_SANDBOX` is `off`.      |
| `idleMs`     | How long the browser stays open with nothing done in it. Left out, fifteen minutes.                           |

## What it promises

- **Which browser.** Windows: Microsoft Edge, then Google Chrome, for all users or for this one. macOS: Google Chrome, then Microsoft Edge, then Chromium, in either Applications folder. Linux: Google Chrome, then Chromium, the Snap last. `find()` looks without starting anything.
- **Its lifetime.** Started at the first call, with its window. Closed after `idleMs` with nothing done in it (a page the person opens or follows counts) and by `close()`. Closed by the person, it starts again at the next call. Calls are carried out one at a time, in order.
- **References.** `snapshot` keeps what can be used (links, buttons, fields, lists, options, tabs) and the headings and landmarks around it, from Playwright's snapshot for AI (`page.ariaSnapshot({ mode: 'ai' })`), whose references Playwright resolves again (`page.getByRef`). An action takes a new snapshot, so its references are the ones to use next; a reference the latest snapshot of the tab does not have is refused.
- **Reading.** The main content: the marked main region or article holding the most text, or the whole page when that is less than a third of it; without navigation, side columns, banners, footers and what is hidden.
- **Errors** reject with a message written for a model ("There is no element e12 on the page now. Take a new browser_snapshot…"), never Playwright's call log.
- **Launch.** Headed, sandboxed, the page following the window's size. Playwright's switches that would stop Widevine, mark the browser as automated, refuse extensions or keep sign-ins under a known key are left out: `src/launch.ts` says which and why. Playwright's own handling of SIGINT, SIGTERM and SIGHUP is off: the core closes the browser when it stops.

## Layout

```
src/
├── index.ts
├── browser.ts      the adapter
├── launch.ts       how the browser is started
├── outline.ts      the outline of a page, and what an action changed
├── page/           functions run inside the page, so they stand alone
│   ├── readable.ts the main content as text
│   └── element.ts  what an element is
└── find/           which browser this computer has, per system
test/
├── real.test.ts    against a real browser and a local page
└── pages/
```

## Tests

```
pnpm --filter @repo/browser test
ASSISTANT_BROWSER=/path/to/chrome ASSISTANT_BROWSER_SANDBOX=off pnpm --filter @repo/browser test
```

The tests of `src/` run anywhere. `test/real.test.ts` runs where a browser is found, with no window: it reads a local page, outlines it, checks that a password field, a card number field and a "Buy now" button read as the core needs them to, clicks, types a search and presses Enter, saves a download and starts again after a close. It is skipped where there is none. A Linux that refuses a downloaded browser the means to sandbox itself (Ubuntu 23.10 and later, with Chrome for Testing) needs `ASSISTANT_BROWSER_SANDBOX=off`; CI sets it on its Linux runner.

A browser for development, where none is installed: `node packages/browser/node_modules/playwright-core/cli.js install chromium`, then point `ASSISTANT_BROWSER` at it.
