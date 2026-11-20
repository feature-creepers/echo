import type { Access } from '@repo/protocol'
import { keyOf, LEAVING_KEYS, MOVING_KEYS } from '../browser/policy.ts'
import { type Consequence, consequenceOf, type Secret, secretOfWords, wordsOf } from '../browser/sensitive.ts'
import type { DesktopElement, WindowFacts } from '../ports/desktop.ts'

/** An act on another app's window, as the core decides about it. Looking and scrolling are not acts: they change nothing. */
export type DesktopAct =
  | { kind: 'click'; element: DesktopElement }
  | { kind: 'type'; element: DesktopElement; text: string; submit: boolean }
  /** A key, in a window, on an element or wherever the focus is: `element` is then the one named, or nothing. */
  | { kind: 'press'; key: string; element: DesktopElement | undefined; window: WindowFacts }

/** What the core does with an act: carry it out, ask the person first, or refuse it with the reason the model reads. */
type DesktopVerdict = { verdict: 'go' } | { verdict: 'ask'; always: boolean; because?: Consequence | undefined } | { verdict: 'refuse'; secret: Secret }

/** Keys that act on their own, whatever has the focus: in a file manager, Delete deletes; in a mail or chat app, Control+Enter sends. */
const KEY_CONSEQUENCES: Record<string, Consequence> = {
  delete: 'deletes',
  'shift+delete': 'deletes',
  'meta+backspace': 'deletes',
  'control+enter': 'sends',
  'meta+enter': 'sends',
  'alt+s': 'sends'
}

/**
 * Words that name a field whose Enter sends what it holds to others: a chat's or a mail's box. An app has no form
 * to read, as a page does, so the field's own words say it.
 */
const MESSAGE_WORDS = ['message', 'reply', 'comment', 'compose', 'chat', 'post', 'tweet', 'repondre', 'ecrire', 'nachricht', 'mensaje', 'messaggio'].map(
  wordsOf
)

/** Whether Enter in this element would send it to others. */
const sendsOnEnter = (element: DesktopElement | undefined) =>
  element !== undefined && [element.name, ...element.hints].map(wordsOf).some((text) => MESSAGE_WORDS.some((word) => text.includes(word)))

/** Roles that take typing. A button that says "Forgot your password?" is no secret. */
const FIELD_ROLES = /\b(edit|text|entry|field|combo|search|password|document)\b/i

/** Whether a field takes a secret, marked by the system or named so. */
function secretIn(element: DesktopElement | undefined): Secret | undefined {
  if (!element) return undefined
  if (element.password) return 'password'
  return FIELD_ROLES.test(element.role) ? secretOfWords([element.name, ...element.hints]) : undefined
}

/**
 * Whether an act on another app goes ahead, is asked first, or is refused. The one place this is decided, for
 * every level of trust the person can choose (docs/SPEC.md, section 12.2):
 *
 * 1. A password or a payment card's details are never typed: the person signs in and pays themselves.
 * 2. An act that reads as paying, sending or deleting is asked first at every level: a button so named, Enter on
 *    one, or a key that deletes or sends by itself.
 * 3. Keys that only move about a window go ahead, as scrolling does.
 * 4. Anything else follows the person's choice: asked first (`ask`), or carried out (`trust` and `auto`).
 */
export function decideDesktopAct(act: DesktopAct, approvals: Access['approvals']): DesktopVerdict {
  const key = act.kind === 'press' ? keyOf(act.key) : ''
  if (act.kind === 'type' || (act.kind === 'press' && !LEAVING_KEYS.has(key))) {
    const secret = secretIn(act.element)
    if (secret) return { verdict: 'refuse', secret }
  }
  if (act.kind === 'press' && MOVING_KEYS.has(key)) return { verdict: 'go' }

  const named = (element: DesktopElement | undefined) => (element ? consequenceOf([element.name, ...element.hints]) : undefined)
  const entered = (element: DesktopElement | undefined) => (sendsOnEnter(element) ? 'sends' : named(element))
  const consequence =
    act.kind === 'click'
      ? named(act.element)
      : act.kind === 'press'
        ? (KEY_CONSEQUENCES[key] ?? (key === 'enter' ? entered(act.element) : undefined))
        : act.submit
          ? entered(act.element)
          : undefined
  if (consequence) return { verdict: 'ask', always: true, because: consequence }

  return approvals === 'ask' ? { verdict: 'ask', always: false } : { verdict: 'go' }
}
