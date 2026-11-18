import type { Answer } from '../access/approvals.ts'
import type { PageFacts } from '../ports/browser.ts'
import type { Consequence, Secret } from './sensitive.ts'

/**
 * The type of the record written for each action of the assistant in its browser: every address it opened and
 * every action on a page, whatever was decided, so the person can see later what was done in their name. Its
 * payload is `BrowserAction`. Looking (reading, outlines, pictures, scrolling, waiting) is not recorded.
 */
export const BROWSER_ACTION = 'browser.action'

export interface BrowserAction {
  /** The tool called: browser_click. */
  tool: string
  act: 'open' | 'back' | 'click' | 'type' | 'select' | 'press' | 'upload'
  /** The site, as the card names it: "amazon.fr". */
  site: string
  /** The page it was done on. */
  page: PageFacts
  /** The element acted on, as the card names it. */
  element?: { ref: string; role: string; name: string } | undefined
  /** What was typed (with ⏎ when Enter followed), the key pressed, the options chosen, the files given, the address opened. */
  detail: string
  /**
   * `allowed`: it went ahead without a question, as the person's trust allows. `approved`: they said yes on the
   * card. `declined`: they did not (`answer` says how). `refused`: the core never does it (`because` says why).
   */
  decision: 'allowed' | 'approved' | 'declined' | 'refused'
  answer?: Exclude<Answer, 'yes'> | undefined
  /** Why it was asked whatever the trust, or why it was refused. */
  because?: Consequence | 'upload' | Secret | undefined
  /** Whether it was carried out, when it was to be. */
  outcome?: 'done' | 'failed' | undefined
  error?: string | undefined
  /** Where the tab in front was once it was done. */
  after?: PageFacts | undefined
}
