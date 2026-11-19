/**
 * What a line of Markdown holds, read as steps the Markdown block draws: text, strong text, emphasis, struck text,
 * code, links and pictures, nested as written. A mark escaped with a backslash (`\*`, `\|`) is the mark itself, as
 * CommonMark has it, so a document's text written with its marks escaped shows as it is.
 */

export type InlineStep =
  | { type: 'text'; text: string }
  | { type: 'strong' | 'emphasis' | 'struck'; steps: InlineStep[] }
  | { type: 'code'; text: string }
  | { type: 'link'; steps: InlineStep[]; address: string }
  | { type: 'picture'; alt: string; address: string }

/** What may follow a backslash to stand for itself: the ASCII marks. */
const ESCAPABLE = '[!-/:-@[-`{-~]'
/** What a span holds up to its closing mark: anything escaped, or any character but the mark and a backslash. */
const within = (mark: string) => `(?:\\\\.|[^${mark}\\\\])`

const PATTERN = new RegExp(
  [
    `\\\\(${ESCAPABLE})`,
    '`([^`]+)`',
    `!\\[(${within('\\]')}*)\\]\\(([^()\\s]+)\\)`,
    `\\[(${within('\\]')}+)\\]\\(([^()\\s]+)\\)`,
    // Strong and emphasis at once, as `***both***`.
    `\\*\\*\\*(?![\\s*])(${within('*')}+?)\\*\\*\\*`,
    // Strong text may hold emphasis written with single stars.
    `\\*\\*(?![\\s*])((?:\\\\.|\\*(?!\\*)|[^*\\\\])+?)\\*\\*`,
    `__(?![\\s_])(${within('_')}+?)__`,
    `~~(?![\\s~])(${within('~')}+?)~~`,
    `\\*(?![\\s*])(${within('*')}+?)\\*`,
    // Underscores inside a word, as in a name written snake_case, are the word's own.
    `(?<![\\p{L}\\p{N}_\\\\])_(?![\\s_])(${within('_')}+?)_(?![\\p{L}\\p{N}])`
  ].join('|'),
  'gu'
)

/** The characters a backslash escapes, read as themselves: for a picture's words and a code's address. */
const unescaped = (text: string) => text.replace(new RegExp(`\\\\(${ESCAPABLE})`, 'g'), '$1')

/** A line of Markdown as the steps it holds. */
export function inlineSteps(text: string): InlineStep[] {
  const steps: InlineStep[] = []
  const add = (added: string) => {
    const last = steps.at(-1)
    if (last?.type === 'text') last.text += added
    else steps.push({ type: 'text', text: added })
  }
  let last = 0
  for (const match of text.matchAll(PATTERN)) {
    const at = match.index
    if (at > last) add(text.slice(last, at))
    last = at + match[0].length
    const [, escaped, code, alt, picture, words, address, both, strong, strongToo, struck, emphasis, emphasisToo] = match
    if (escaped !== undefined) add(escaped)
    else if (code !== undefined) steps.push({ type: 'code', text: code })
    else if (picture !== undefined) steps.push({ type: 'picture', alt: unescaped(alt ?? ''), address: picture })
    else if (address !== undefined) steps.push({ type: 'link', steps: inlineSteps(words ?? ''), address })
    else if (both !== undefined) steps.push({ type: 'strong', steps: [{ type: 'emphasis', steps: inlineSteps(both) }] })
    else if (strong !== undefined || strongToo !== undefined) steps.push({ type: 'strong', steps: inlineSteps(strong ?? strongToo ?? '') })
    else if (struck !== undefined) steps.push({ type: 'struck', steps: inlineSteps(struck) })
    else steps.push({ type: 'emphasis', steps: inlineSteps(emphasis ?? emphasisToo ?? '') })
  }
  if (last < text.length) add(text.slice(last))
  return steps
}

/** Whether a line holds only pictures, and the space between them: it then shows as figures, not as a paragraph. */
export const picturesOnly = (steps: readonly InlineStep[]): boolean =>
  steps.some((step) => step.type === 'picture') && steps.every((step) => step.type === 'picture' || (step.type === 'text' && step.text.trim() === ''))

/** The cells of a table's line, trimmed: a pipe escaped with a backslash is part of its cell. */
export const tableCells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim())
