import type { Question } from '../access/approvals.ts'
import type { ElementFacts, PageFacts } from '../ports/browser.ts'
import type { PageAct, PageVerdict } from './policy.ts'
import type { Secret } from './sensitive.ts'

/** The longest a page's words are shown on a card, in characters. A button's name can be a paragraph. */
const SHOWN = 60

const shortened = (text: string, length = SHOWN) => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > length ? `${one.slice(0, length - 1).trimEnd()}…` : one
}

/** The site a page is on, as the person reads it: "amazon.fr", or the address itself when it has no host. */
export function siteOf(url: string): string {
  const host = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i.exec(url)?.[1]
  return host ? host.replace(/^www\./i, '').toLowerCase() : shortened(url)
}

/** What an element is called on a card: its name, else its text, else what it is. */
export function labelOf(element: ElementFacts): string {
  return shortened(element.name || element.text || element.hints[0] || element.role || element.tag)
}

/** Why a card is shown whatever the person's choice of trust, said for them. */
const WHY: Record<NonNullable<Extract<PageVerdict, { verdict: 'ask' }>['because']>, string> = {
  pays: 'It may pay for something',
  sends: 'It may send or publish something as you',
  deletes: 'It may delete something',
  upload: 'Your file goes to this site'
}

/** The fact that says where an action happens: the page's title, or its address when it has none. */
const pageFact = (page: PageFacts) => ({ label: 'Page', value: shortened(page.title || page.url, 80) })

/**
 * The card that asks before an action on a page: what it would do, in the page's own words, the site as its
 * subject, and the page and the reason it is asked as facts. A click reads `Click “Add to cart”?`.
 */
export function questionFor(act: PageAct, because: Extract<PageVerdict, { verdict: 'ask' }>['because']): Question {
  const page = act.element?.page ?? { url: '', title: '' }
  const facts = [pageFact(page), ...(because ? [{ label: 'Why I ask', value: WHY[because] }] : [])]
  const subject = siteOf(page.url)
  switch (act.kind) {
    case 'click':
      return { heading: `Click “${labelOf(act.element)}”?`, subject, facts, allow: 'Click it' }
    case 'type':
      return {
        heading: `Type in “${labelOf(act.element)}”?`,
        subject,
        facts: [{ label: 'Text', value: shortened(act.text, 200) }, ...(act.submit ? [{ label: 'Then', value: 'Press Enter' }] : []), ...facts],
        allow: 'Type it'
      }
    case 'select':
      return {
        heading: `Choose in “${labelOf(act.element)}”?`,
        subject,
        facts: [{ label: 'Choice', value: shortened(act.values.join(', '), 200) }, ...facts],
        allow: 'Choose it'
      }
    case 'press':
      return {
        heading: `Press ${act.key}?`,
        subject,
        facts: [...(act.element ? [{ label: 'On', value: labelOf(act.element) }] : []), ...facts],
        allow: 'Press it'
      }
    case 'upload':
      return {
        heading: act.files.length > 1 ? `Give these ${act.files.length} files to the page?` : 'Give this file to the page?',
        subject,
        facts: [...act.files.map((file) => ({ label: 'File', value: file })), ...facts],
        allow: 'Upload it'
      }
  }
}

/** What the model is told when the core refuses to type into a field, whatever the person's trust. */
export const SECRET_REFUSAL: Record<Secret, string> = {
  password:
    'Refused: this is a password field, and you never type passwords. The person signs in themselves, in the browser window. Tell them so in one short sentence, and do nothing more on this page, not even send its form, until they say it is done.',
  card: 'Refused: this field takes payment card details, and you never enter them. The person pays themselves, in the browser window. Tell them so in one short sentence, and do nothing more on this page, not even send its form, until they say it is done.'
}
