import type { ReactNode } from 'react'

/**
 * A small Markdown reader for what a model writes in Prose and in its full answers: headings, paragraphs,
 * lists, tables, quotes, code, emphasis and links shown as text. It builds React elements, never HTML, so
 * nothing written can run.
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
          className="whitespace-pre-wrap rounded-md border border-line bg-ground px-3.5 py-3 font-mono text-text-soft text-xs leading-relaxed [overflow-wrap:anywhere]"
        >
          {code.join('\n')}
        </pre>
      )
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1]?.length ?? 1
      const style = level === 1 ? 'text-lg font-medium tracking-[-0.015em]' : level === 2 ? 'text-base font-medium tracking-[-0.01em]' : 'text-sm font-medium'
      const Tag = level === 1 ? 'h3' : level === 2 ? 'h4' : 'h5'
      blocks.push(
        <Tag key={key()} className={`${style} mt-1.5 leading-snug`}>
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
          className={`grid gap-1 pl-5 ${ordered ? 'list-decimal marker:font-mono marker:text-text-faint marker:text-xs' : 'list-disc marker:text-text-faint'}`}
        >
          {items.map((item, at) => {
            // A task of a checklist ("- [ ] passport", "- [x] tickets") shows its box in place of the bullet.
            const task = /^\[([ xX])\]\s+/.exec(item)
            if (!task)
              return (
                <li key={at} className="pl-1 leading-relaxed">
                  {inline(item)}
                </li>
              )
            const done = task[1] !== ' '
            return (
              <li key={at} className="-ml-5 flex list-none items-baseline gap-2.5 leading-relaxed">
                <span
                  aria-hidden="true"
                  className={`relative top-[0.1875rem] size-3 shrink-0 rounded-xs border ${done ? 'border-accent bg-accent/80' : 'border-line-strong'}`}
                />
                <span className={done ? 'text-text-faint line-through decoration-text-faint/60' : undefined}>{inline(item.slice(task[0].length))}</span>
              </li>
            )
          })}
        </List>
      )
      continue
    }
    // A table: a row of cells between pipes, then the line of dashes under its header.
    if (isRow(line) && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[index + 1] ?? '')) {
      const head = cells(line)
      index += 2
      const rows: string[][] = []
      while (index < lines.length && isRow(lines[index] ?? '')) rows.push(cells(lines[index++] ?? ''))
      blocks.push(
        <div key={key()} className="scroll-quiet overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-left text-[0.875rem]">
            <thead className="bg-raised/60">
              <tr>
                {head.map((cell, at) => (
                  <th key={at} className="px-3 py-1.5 font-medium text-text-soft">
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, at) => (
                <tr key={at} className="border-line border-t">
                  {head.map((_, column) => (
                    <td key={column} className="px-3 py-1.5 tabular-nums">
                      {inline(row[column] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }
    if (line.startsWith('>')) {
      const quote: string[] = []
      while (index < lines.length && (lines[index] ?? '').startsWith('>')) quote.push((lines[index++] ?? '').replace(/^>\s?/, ''))
      blocks.push(
        <blockquote key={key()} className="border-line-strong border-l-2 pl-3.5 text-text-soft">
          {inline(quote.join(' '))}
        </blockquote>
      )
      continue
    }
    const paragraph: string[] = []
    while (
      index < lines.length &&
      (lines[index] ?? '').trim() !== '' &&
      !/^(#{1,4}\s|```|>|\s*([-*+]|\d+[.)])\s)/.test(lines[index] ?? '') &&
      !isRow(lines[index] ?? '')
    )
      paragraph.push(lines[index++] ?? '')
    // A line break inside a paragraph is kept, as in a letter's address block or a poem.
    blocks.push(
      <p key={key()} className="text-pretty leading-relaxed">
        {paragraph.flatMap((line, at) => (at === 0 ? inline(line) : [<br key={`br-${at}`} />, ...inline(line)]))}
      </p>
    )
  }

  return <div className="grid max-w-[68ch] gap-3 text-sm">{blocks}</div>
}

/** A line of a table: it starts and ends with a pipe. */
const isRow = (line: string) => /^\s*\|.*\|\s*$/.test(line)

/** The cells of a table's line, trimmed. */
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim())

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
        <code key={key} className="rounded-xs bg-white/[0.06] px-1 py-px font-mono text-[0.85em]">
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
