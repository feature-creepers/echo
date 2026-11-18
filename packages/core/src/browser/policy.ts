import type { Access } from '@repo/protocol'
import type { ElementFacts } from '../ports/browser.ts'
import { type Consequence, consequenceOfAct, type Secret, secretOf } from './sensitive.ts'

/** An action on a page, as the core decides about it. */
export type PageAct =
  | { kind: 'click'; element: ElementFacts }
  | { kind: 'type'; element: ElementFacts; text: string; submit: boolean }
  | { kind: 'select'; element: ElementFacts; values: readonly string[] }
  /** A key, on an element or wherever the focus is: `element` is then the focused one, or nothing for the page itself. */
  | { kind: 'press'; key: string; element: ElementFacts | undefined }
  /** Files, by absolute path, given to a file field. */
  | { kind: 'upload'; element: ElementFacts; files: readonly string[] }

/**
 * What the core does with an action: carry it out, ask the person first, or refuse it with the reason the model
 * reads. `always` says the question is asked at every level of trust, and `because` why, for the card.
 */
export type PageVerdict =
  | { verdict: 'go' }
  | { verdict: 'ask'; always: boolean; because?: Consequence | 'upload' | undefined }
  | { verdict: 'refuse'; secret: Secret }

/** Keys that only move around a page or out of a field, and send nothing: they go ahead like scrolling. */
const MOVING_KEYS = new Set(['tab', 'shift+tab', 'escape', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'pageup', 'pagedown', 'home', 'end'])

/** Keys that leave a field without typing into it or sending it. */
const LEAVING_KEYS = new Set(['tab', 'shift+tab', 'escape'])

const isEnter = (key: string) => key.toLowerCase() === 'enter'

/**
 * Whether an action on a page goes ahead, is asked first, or is refused. The one place this is decided, for
 * every level of trust the person can choose (docs/SPEC.md, section 12.2):
 *
 * 1. A password or a payment card's details are never typed, and their form is never sent from them by a key:
 *    the person signs in and pays themselves, in the browser window.
 * 2. Giving a file to a page, and an action that reads as paying, sending or deleting, is asked first at
 *    every level.
 * 3. Keys that only move about the page go ahead, as scrolling does.
 * 4. Anything else follows the person's choice: asked first (`ask`), or carried out (`trust` and `auto`).
 */
export function decidePageAct(act: PageAct, approvals: Access['approvals']): PageVerdict {
  const key = act.kind === 'press' ? act.key.toLowerCase().replace(/\s+/g, '') : ''
  if (act.kind === 'type' || act.kind === 'select' || (act.kind === 'press' && !LEAVING_KEYS.has(key))) {
    const secret = act.element ? secretOf(act.element) : undefined
    if (secret) return { verdict: 'refuse', secret }
  }
  if (act.kind === 'upload') return { verdict: 'ask', always: true, because: 'upload' }
  if (act.kind === 'press' && MOVING_KEYS.has(key)) return { verdict: 'go' }

  const consequence =
    act.kind === 'click' || act.kind === 'select'
      ? consequenceOfAct(act.element, { kind: act.kind })
      : (act.kind === 'type' && act.submit) || (act.kind === 'press' && isEnter(act.key))
        ? act.element && consequenceOfAct(act.element, { kind: 'enter' })
        : undefined
  if (consequence) return { verdict: 'ask', always: true, because: consequence }

  // Trusted, or trusted with everything: an ordinary action goes ahead; what pays, sends or deletes was asked above.
  return approvals === 'ask' ? { verdict: 'ask', always: false } : { verdict: 'go' }
}
