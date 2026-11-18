import type { USE_REASONS } from '@repo/protocol'
import { z } from 'zod'
import type { AccessControl } from '../access/access.ts'
import type { Answer, Approvals } from '../access/approvals.ts'
import type { ActionOutcome, Browser, ElementFacts, PageFacts } from '../ports/browser.ts'
import type { Computer } from '../ports/computer.ts'
import type { Records } from '../ports/records.ts'
import type { ToolResult } from '../ports/tools.ts'
import type { UserSettings } from '../settings/settings.ts'
import type { Tool } from '../tools/tools.ts'
import type { Showing } from '../views/screen.ts'
import { BROWSER_ACTION, type BrowserAction } from './log.ts'
import { decidePageAct, type PageAct } from './policy.ts'
import { labelOf, questionFor, SECRET_REFUSAL, siteOf } from './questions.ts'
import { fenced } from './untrusted.ts'

/** How much of a page's text one read gives, in characters: enough for an article's opening, small enough for a context. */
const READ_LENGTH = 8_000
/** The longest outline a snapshot gives, in characters. */
const OUTLINE_LENGTH = 12_000
/** The longest a wait lasts, in seconds. */
/** Why a use was decided as it was, as the activity keeps it. */
type AccessUseReason = (typeof USE_REASONS)[number]

const WAIT_SECONDS = 30
/** How many lines of what changed an action reports. The rest is in a new snapshot. */
const CHANGES_SHOWN = 30

export interface BrowserToolsOptions {
  browser: Browser
  /** The browser's name, as the person knows it. */
  name: string
  settings: UserSettings
  ask: Approvals['ask']
  records: Records
  /** The activity of the computer, where each action on a page is kept beside the uses of files and commands. */
  uses?: Pick<AccessControl, 'record' | 'report'> | undefined
  computer?: Computer | undefined
  showing: () => Showing
  /** Whether the browser may be used now: the person can turn it off during a turn. */
  usable: () => boolean
}

const ref = z
  .string()
  .trim()
  .regex(/^[a-z]*\d+(?:[a-z]+\d+)*$/i, 'a reference from the latest snapshot, such as e12')
const openInput = z.object({ url: z.string().trim().min(1).max(4096), tab: z.enum(['current', 'new']).default('current') })
const readInput = z.object({ from: z.number().int().nonnegative().default(0) })
const scrollInput = z.object({ direction: z.enum(['up', 'down']).default('down'), screens: z.number().min(0.2).max(10).default(1), ref: ref.optional() })
const tabsInput = z.object({ action: z.enum(['list', 'select', 'close']).default('list'), index: z.number().int().nonnegative().optional() })
const waitInput = z.object({ text: z.string().trim().min(1).max(500).optional(), seconds: z.number().positive().max(WAIT_SECONDS).optional() })
const clickInput = z.object({ ref })
const typeInput = z.object({ ref, text: z.string().max(10_000), submit: z.boolean().default(false) })
const selectInput = z.object({ ref, values: z.array(z.string().max(500)).min(1).max(50) })
const pressInput = z.object({ key: z.string().trim().min(1).max(60), ref: ref.optional() })
const uploadInput = z.object({ ref, paths: z.array(z.string().trim().min(1).max(4096)).min(1).max(20) })

/** What the model is told when the person did not say yes. */
const NOT_DONE: Record<Exclude<Answer, 'yes' | 'session'>, string> = {
  no: 'The person said no, so it was not done. Do not try it again unless they ask.',
  'moved-on': 'The person moved on to something else without answering, so it was not done.',
  stopped: 'The turn was stopped, so it was not done.',
  unanswered: 'No answer came, so it was not done. Ask again if it still matters.'
}

const failed = (error: unknown): ToolResult => ({ ok: false, text: error instanceof Error ? error.message : String(error) })
const refused = (text: string): ToolResult => ({ ok: false, text })

/** Only addresses of the web: a page opened from a file or from the browser's own pages would reach past what was granted. */
function webAddress(url: string): string | undefined {
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`
  return /^https?:\/\/[^\s/?#]+/i.test(withScheme) ? withScheme : undefined
}

/** A page, fenced, with what the tool says before and after it. */
const told = (before: string, page: PageFacts | undefined, body: string, after?: string): string =>
  [before, fenced(page, body), ...(after ? [after] : [])].join('\n')

/** What an action did, told to the model: where the tab is now and what is new there. */
function outcomeText(done: string, outcome: ActionOutcome): string {
  const shown = outcome.changes.slice(0, CHANGES_SHOWN)
  const more = outcome.changes.length - shown.length
  const body = shown.length > 0 ? `What is new on the page:\n${shown.join('\n')}${more > 0 ? `\n(${more} more lines: take a browser_snapshot)` : ''}` : ''
  return told(done, outcome, body, shown.length === 0 ? 'Nothing new appeared among the elements you can use.' : undefined)
}

/** Whether a path is a place or inside it, by its words. Both are as the system names them, links followed. */
const inside = (path: string, place: string) => {
  const trim = (value: string) => value.replace(/[\\/]+$/, '')
  const [one, other] = [trim(path), trim(place)]
  return one === other || one.startsWith(`${other}/`) || one.startsWith(`${other}\\`)
}

/**
 * The browser's tools (docs/SPEC.md, section 12.1). Those that look go ahead; those that act are decided by
 * `decidePageAct`, asked on a card when it says so, and recorded (`browser.action`), whatever the outcome.
 */
export function browserTools(options: BrowserToolsOptions): Tool[] {
  const { browser, settings, records, uses, computer, showing, usable } = options

  const record = (action: BrowserAction) => void records.append([{ type: BROWSER_ACTION, payload: action }])

  /** Run a tool only while the browser may be used, turning what the adapter throws into a result the model reads. */
  const guarded =
    (run: (input: unknown) => Promise<ToolResult>) =>
    async (input: unknown): Promise<ToolResult> => {
      if (!usable()) return refused('The person turned the browser off. Tell them, if it matters for what they asked.')
      try {
        return await run(input)
      } catch (error) {
        return failed(error)
      }
    }

  const element = (reference: string | undefined): Promise<ElementFacts | undefined> => browser.inspect(reference)

  /**
   * An action on a page: decided, asked when it must be, carried out, and recorded. `perform` runs only once it
   * may go ahead.
   */
  const act = async (tool: string, request: PageAct, detail: string, done: string, perform: () => Promise<ActionOutcome>): Promise<ToolResult> => {
    const page = request.element?.page ?? (await browser.tabs()).find((tab) => tab.current) ?? { url: '', title: '' }
    const base: BrowserAction = {
      tool,
      act: request.kind,
      site: siteOf(page.url),
      page: { url: page.url, title: page.title },
      ...(request.element ? { element: { ref: request.element.ref, role: request.element.role, name: labelOf(request.element) } } : {}),
      detail,
      decision: 'allowed'
    }
    const verdict = decidePageAct(request, settings.read().access.approvals)
    // Kept in the activity too, as a line the person reads: what was done, on which site.
    const line = `${detail}${base.site ? ` on ${base.site}` : ''}`
    const { thread, turn } = showing()
    const use = (decision: 'ran' | 'approved' | 'refused', reason: AccessUseReason, refusal?: string) =>
      uses?.record({
        ...(thread === undefined ? {} : { thread }),
        ...(turn === undefined ? {} : { turn }),
        tool,
        action: 'run',
        command: line,
        paths: [],
        decision,
        reason,
        ...(refusal === undefined ? {} : { detail: refusal })
      })
    if (verdict.verdict === 'refuse') {
      record({ ...base, decision: 'refused', because: verdict.secret })
      use('refused', 'protected', SECRET_REFUSAL[verdict.secret])
      return refused(SECRET_REFUSAL[verdict.secret])
    }
    let decision: BrowserAction['decision'] = 'allowed'
    let kept: string | undefined
    if (verdict.verdict === 'ask') {
      // Paying, and sending or publishing as the person, reach beyond this computer.
      const outward = verdict.because === 'pays' || verdict.because === 'sends' || verdict.because === 'upload'
      const { answer, pressed } = await options.ask({ ...questionFor(request, verdict.because), ...(outward ? { outward } : {}) }, showing())
      // A page's card offers no yes for the session; said aloud, it is a yes for this action.
      if (answer !== 'yes' && answer !== 'session') {
        record({ ...base, decision: 'declined', answer, ...(verdict.because ? { because: verdict.because } : {}) })
        use('refused', answer === 'no' ? 'declined' : answer === 'stopped' ? 'stopped' : 'unanswered', NOT_DONE[answer])
        return refused(NOT_DONE[answer])
      }
      decision = 'approved'
      kept = use('approved', pressed ? 'pressed' : 'said')
    } else {
      kept = use('ran', 'level')
    }
    const because = verdict.verdict === 'ask' && verdict.because ? { because: verdict.because } : {}
    try {
      const outcome = await perform()
      record({ ...base, decision, ...because, outcome: 'done', after: { url: outcome.url, title: outcome.title } })
      if (kept !== undefined) uses?.report(kept, { ok: true })
      return { ok: true, text: outcomeText(done, outcome) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      record({ ...base, decision, ...because, outcome: 'failed', error: message })
      if (kept !== undefined) uses?.report(kept, { ok: false, error: message })
      return failed(error)
    }
  }

  /** The element an action names, or the reason it cannot be found. */
  const target = async (reference: string): Promise<ElementFacts | ToolResult> =>
    (await element(reference)) ?? refused(`There is no element ${reference} on the page now. Take a new browser_snapshot and use its references.`)
  const isResult = (value: ElementFacts | ToolResult): value is ToolResult => 'ok' in value

  /** Files a page may be given: in the assistant's own folder, or in a place the person granted, or anywhere they let it read. */
  const givable = async (paths: readonly string[]): Promise<{ ok: true; files: string[] } | { ok: false; text: string }> => {
    if (!computer) return { ok: false, text: 'This assistant cannot reach files here.' }
    const { workspace, places, computer: reach } = settings.read().access
    const home = workspace ? await computer.locate(computer.workspace) : undefined
    const allowed = [...(home ? [home.path] : []), ...places.map((place) => place.path)]
    const files: string[] = []
    for (const path of paths) {
      const found = await computer.locate(path)
      if (found?.kind !== 'file') return { ok: false, text: `There is no file at ${path}.` }
      if (reach === 'off' && !allowed.some((place) => inside(found.path, place))) {
        return {
          ok: false,
          text: `${found.path} is outside what the person granted. A page can only be given files from your own folder or from places they gave you; they can grant more in Settings, Access.`
        }
      }
      files.push(found.path)
    }
    return { ok: true, files }
  }

  return [
    {
      definition: {
        name: 'browser_open',
        description: `Open a web address in the person's browser (${options.name}), in a window they see, in the tab in front or in a new tab. For a site that needs JavaScript or the person to be signed in, or to act on a page. To look something up, web_search and web_read are faster.`,
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The address: https://…' },
            tab: { type: 'string', enum: ['current', 'new'], description: 'The tab in front (the default), or a new one.' }
          },
          required: ['url']
        }
      },
      run: guarded(async (input) => {
        const asked = openInput.safeParse(input)
        if (!asked.success) return refused('browser_open takes a web address as "url", and "tab": current or new.')
        const url = webAddress(asked.data.url)
        if (!url) return refused('Only web addresses (http or https) can be opened.')
        const page = await browser.go(url, asked.data.tab)
        record({ tool: 'browser_open', act: 'open', site: siteOf(page.url), page, detail: url, decision: 'allowed', outcome: 'done' })
        return {
          ok: true,
          text: told('Opened.', page, '', 'Read its text with browser_read, see it with browser_screenshot, or take a browser_snapshot to act on it.')
        }
      })
    },
    {
      definition: {
        name: 'browser_read',
        description: `The main content of the page in front, as text, ${READ_LENGTH} characters at a time. Give "from" to read further.`,
        inputSchema: { type: 'object', properties: { from: { type: 'number', description: 'The character to start from: 0, or where the last read said.' } } }
      },
      run: guarded(async (input) => {
        const asked = readInput.safeParse(input ?? {})
        if (!asked.success) return refused('browser_read takes "from", a number of characters.')
        const page = await browser.read(asked.data.from, READ_LENGTH)
        const end = page.from + page.text.length
        const rest = page.total - end
        return {
          ok: true,
          text: told(
            `The page's text, characters ${page.from} to ${end} of ${page.total}:`,
            page,
            page.text || '(no text)',
            rest > 0 ? `${rest} more characters: call browser_read with from: ${end}.` : undefined
          )
        }
      })
    },
    {
      definition: {
        name: 'browser_snapshot',
        description:
          'The elements you can use on the page in front (links, buttons, fields, lists), as an outline with a reference for each, such as e12, and the headings around them. Take one before acting: browser_click, browser_type, browser_select and browser_press name elements by these references.',
        inputSchema: { type: 'object', properties: {} }
      },
      run: guarded(async () => {
        const page = await browser.snapshot(OUTLINE_LENGTH)
        return {
          ok: true,
          text: told(
            'What you can use on the page, each with its reference:',
            page,
            page.outline || '(nothing to use)',
            page.cut ? 'The outline was cut: scroll or read to find what is not in it.' : undefined
          )
        }
      })
    },
    {
      definition: {
        name: 'browser_screenshot',
        description:
          'See the page in front as the window shows it, as a picture: for what its text does not say, such as a layout, a picture, or a video playing.',
        inputSchema: { type: 'object', properties: {} }
      },
      run: guarded(async () => {
        const picture = await browser.screenshot()
        return {
          ok: true,
          text: told('The page as the window shows it is in the picture below.', picture, ''),
          images: [{ data: picture.data, mime: picture.mime }]
        }
      })
    },
    {
      definition: {
        name: 'browser_scroll',
        description: 'Scroll the page in front by screens, up or down, or bring an element into view by its reference.',
        inputSchema: {
          type: 'object',
          properties: {
            direction: { type: 'string', enum: ['up', 'down'] },
            screens: { type: 'number', description: 'How far, in screens: 1 by default.' },
            ref: { type: 'string', description: 'An element to bring into view, instead.' }
          }
        }
      },
      run: guarded(async (input) => {
        const asked = scrollInput.safeParse(input ?? {})
        if (!asked.success) return refused('browser_scroll takes "direction" (up or down) and "screens", or the "ref" of an element.')
        const page = await browser.scroll(asked.data.ref ? { ref: asked.data.ref } : { direction: asked.data.direction, screens: asked.data.screens })
        return { ok: true, text: told('Scrolled.', page, '') }
      })
    },
    {
      definition: {
        name: 'browser_back',
        description: 'Go back to the previous page of the tab in front.',
        inputSchema: { type: 'object', properties: {} }
      },
      run: guarded(async () => {
        const page = await browser.back()
        record({ tool: 'browser_back', act: 'back', site: siteOf(page.url), page, detail: '', decision: 'allowed', outcome: 'done' })
        return { ok: true, text: told('Went back.', page, '') }
      })
    },
    {
      definition: {
        name: 'browser_tabs',
        description: 'List the open tabs, bring one to the front, or close one, by its number in the list.',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['list', 'select', 'close'] },
            index: { type: 'number', description: 'The tab, by its number in the list.' }
          }
        }
      },
      run: guarded(async (input) => {
        const asked = tabsInput.safeParse(input ?? {})
        if (!asked.success || (asked.data.action !== 'list' && asked.data.index === undefined)) {
          return refused('browser_tabs takes "action" (list, select or close) and, to select or close, the tab\'s "index".')
        }
        if (asked.data.action !== 'list') await browser.tab(asked.data.index as number, asked.data.action)
        const tabs = await browser.tabs()
        const list = tabs.map((tab, index) => `[${index}]${tab.current ? ' (in front)' : ''} ${tab.title || '(no title)'}, ${tab.url}`).join('\n')
        const done = asked.data.action === 'select' ? 'Brought to the front.' : asked.data.action === 'close' ? 'Closed.' : 'The open tabs:'
        return { ok: true, text: told(done, undefined, list || '(no tab)') }
      })
    },
    {
      definition: {
        name: 'browser_wait',
        description: `Wait for a text to appear on the page in front, or for a number of seconds, ${WAIT_SECONDS} at most: for a page that is still loading or changing.`,
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'A text to wait for.' },
            seconds: { type: 'number', description: `How long, at most ${WAIT_SECONDS}.` }
          }
        }
      },
      run: guarded(async (input) => {
        const asked = waitInput.safeParse(input ?? {})
        if (!asked.success || (asked.data.text === undefined && asked.data.seconds === undefined)) {
          return refused(`browser_wait takes a "text" to wait for, or "seconds", ${WAIT_SECONDS} at most.`)
        }
        const ms = (asked.data.seconds ?? (asked.data.text ? 10 : 1)) * 1000
        const page = await browser.wait(asked.data.text !== undefined ? { text: asked.data.text, ms } : { ms })
        return { ok: true, text: told(asked.data.text !== undefined ? 'The text is on the page.' : 'Waited.', page, '') }
      })
    },
    {
      definition: {
        name: 'browser_click',
        description: 'Click an element of the page in front, by its reference from the latest snapshot. Gives back what changed.',
        inputSchema: { type: 'object', properties: { ref: { type: 'string', description: 'Its reference: e12.' } }, required: ['ref'] }
      },
      run: guarded(async (input) => {
        const asked = clickInput.safeParse(input)
        if (!asked.success) return refused('browser_click takes the "ref" of an element from the latest snapshot.')
        const found = await target(asked.data.ref)
        if (isResult(found)) return found
        return act('browser_click', { kind: 'click', element: found }, '', `Clicked “${labelOf(found)}”.`, () => browser.click(found.ref))
      })
    },
    {
      definition: {
        name: 'browser_type',
        description:
          'Type into a field of the page in front, by its reference, replacing what it holds; "submit" then presses Enter, as for a search. Never for a password or card details: the person types those themselves.',
        inputSchema: {
          type: 'object',
          properties: {
            ref: { type: 'string', description: 'The field: e12.' },
            text: { type: 'string' },
            submit: { type: 'boolean', description: 'Press Enter after typing.' }
          },
          required: ['ref', 'text']
        }
      },
      run: guarded(async (input) => {
        const asked = typeInput.safeParse(input)
        if (!asked.success) return refused('browser_type takes the "ref" of a field, the "text" to type, and "submit" to press Enter after.')
        const found = await target(asked.data.ref)
        if (isResult(found)) return found
        const { text, submit } = asked.data
        return act(
          'browser_type',
          { kind: 'type', element: found, text, submit },
          `${text}${submit ? ' ⏎' : ''}`,
          `Typed in “${labelOf(found)}”${submit ? ' and pressed Enter' : ''}.`,
          () => browser.type(found.ref, text, submit)
        )
      })
    },
    {
      definition: {
        name: 'browser_select',
        description: "Choose options of a list on the page in front, by the list's reference and the options' labels.",
        inputSchema: {
          type: 'object',
          properties: {
            ref: { type: 'string', description: 'The list: e12.' },
            values: { type: 'array', items: { type: 'string' }, description: 'The options to choose.' }
          },
          required: ['ref', 'values']
        }
      },
      run: guarded(async (input) => {
        const asked = selectInput.safeParse(input)
        if (!asked.success) return refused('browser_select takes the "ref" of a list and the "values" to choose.')
        const found = await target(asked.data.ref)
        if (isResult(found)) return found
        const { values } = asked.data
        return act('browser_select', { kind: 'select', element: found, values }, values.join(', '), `Chose ${values.join(', ')} in “${labelOf(found)}”.`, () =>
          browser.select(found.ref, values)
        )
      })
    },
    {
      definition: {
        name: 'browser_press',
        description:
          'Press a key or a combination on the page in front ("Enter", "Escape", "ArrowDown", "Control+A", "Space" to play or pause a video), on an element by its reference or wherever the focus is.',
        inputSchema: {
          type: 'object',
          properties: { key: { type: 'string' }, ref: { type: 'string', description: 'The element to press it on. Left out, where the focus is.' } },
          required: ['key']
        }
      },
      run: guarded(async (input) => {
        const asked = pressInput.safeParse(input)
        if (!asked.success) return refused('browser_press takes the "key" to press, and the "ref" of an element when it matters.')
        const { key } = asked.data
        let focused: ElementFacts | undefined
        if (asked.data.ref !== undefined) {
          const found = await target(asked.data.ref)
          if (isResult(found)) return found
          focused = found
        } else {
          focused = await element(undefined)
        }
        return act('browser_press', { kind: 'press', key, element: focused }, key, `Pressed ${key}.`, () => browser.press(key, asked.data.ref))
      })
    },
    {
      definition: {
        name: 'browser_upload',
        description:
          "Give files to a file field of the page in front, by the field's reference: files from your own folder or from places the person granted, by absolute path or by name in your folder. The person approves each time.",
        inputSchema: {
          type: 'object',
          properties: {
            ref: { type: 'string', description: 'The file field, or the button that opens it: e12.' },
            paths: { type: 'array', items: { type: 'string' } }
          },
          required: ['ref', 'paths']
        }
      },
      run: guarded(async (input) => {
        const asked = uploadInput.safeParse(input)
        if (!asked.success) return refused('browser_upload takes the "ref" of a file field and the "paths" of the files.')
        const files = await givable(asked.data.paths)
        if (!files.ok) return refused(files.text)
        const found = await target(asked.data.ref)
        if (isResult(found)) return found
        return act('browser_upload', { kind: 'upload', element: found, files: files.files }, files.files.join(', '), 'Gave the page the files.', () =>
          browser.upload(found.ref, files.files)
        )
      })
    }
  ]
}
