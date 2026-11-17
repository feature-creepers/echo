import type { ReactNode } from 'react'

/**
 * A small Markdown reader for what a model writes in Prose: headings, paragraphs, lists, quotes, code,
 * emphasis and links shown as text. It builds React elements, never HTML, so nothing written can run.
 */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let index = 0
  const key = () => blocks.length

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim() === '') {
      index++
      continue
    }
    if (line.startsWith('```')) {
      const code: string[] = []
      index++
      while (index < lines.length && !(lines[index] ?? '').startsWith('```')) code.push(lines[index++] ?? '')
      index++
      blocks.push(
        <pre
          key={key()}
          className="scroll-quiet overflow-x-auto rounded-md border border-line bg-ground p-4 font-mono text-[0.8125rem] text-text-soft leading-relaxed"
        >
          {code.join('\n')}
        </pre>
      )
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1]?.length ?? 1
      const style = level === 1 ? 'text-2xl font-medium tracking-tight' : level === 2 ? 'text-xl font-medium tracking-tight' : 'text-base font-medium'
      const Tag = level === 1 ? 'h3' : level === 2 ? 'h4' : 'h5'
      blocks.push(
        <Tag key={key()} className={`${style} mt-2`}>
          {inline(heading[2] ?? '')}
        </Tag>
      )
      index++
      continue
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line)
      const items: string[] = []
      while (index < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[index] ?? '')) items.push((lines[index++] ?? '').replace(/^\s*([-*+]|\d+[.)])\s+/, ''))
      const List = ordered ? 'ol' : 'ul'
      blocks.push(
        <List
          key={key()}
          className={`grid gap-1.5 pl-5 ${ordered ? 'list-decimal marker:font-mono marker:text-accent marker:text-xs' : 'list-disc marker:text-accent'}`}
        >
          {items.map((item, at) => (
            <li key={at} className="pl-1 leading-relaxed">
              {inline(item)}
            </li>
          ))}
        </List>
      )
      continue
    }
    if (line.startsWith('>')) {
      const quote: string[] = []
      while (index < lines.length && (lines[index] ?? '').startsWith('>')) quote.push((lines[index++] ?? '').replace(/^>\s?/, ''))
      blocks.push(
        <blockquote key={key()} className="border-accent/60 border-l-2 pl-4 text-text-soft italic">
          {inline(quote.join(' '))}
        </blockquote>
      )
      continue
    }
    const paragraph: string[] = []
    while (index < lines.length && (lines[index] ?? '').trim() !== '' && !/^(#{1,4}\s|```|>|\s*([-*+]|\d+[.)])\s)/.test(lines[index] ?? ''))
      paragraph.push(lines[index++] ?? '')
    // A line break inside a paragraph is kept, as in a letter's address block or a poem.
    blocks.push(
      <p key={key()} className="text-pretty leading-relaxed">
        {paragraph.flatMap((line, at) => (at === 0 ? inline(line) : [<br key={`br-${at}`} />, ...inline(line)]))}
      </p>
    )
  }

  return <div className="grid max-w-[68ch] gap-3.5 text-[0.9375rem]">{blocks}</div>
}

/** Emphasis, strong text, code and links inside a line. A link shows its words; the address is not followed. */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0
    if (at > last) parts.push(text.slice(last, at))
    const token = match[0]
    const key = parts.length
    if (token.startsWith('**') || token.startsWith('__'))
      parts.push(
        <strong key={key} className="font-semibold">
          {token.slice(2, -2)}
        </strong>
      )
    else if (token.startsWith('`'))
      parts.push(
        <code key={key} className="rounded-sm bg-raised px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>
      )
    else if (token.startsWith('['))
      parts.push(
        <span key={key} className="text-accent">
          {token.slice(1, token.indexOf(']'))}
        </span>
      )
    else parts.push(<em key={key}>{token.slice(1, -1)}</em>)
    last = at + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}
