import type { ReactNode } from 'react'
import { type InlineStep, inlineSteps, picturesOnly, tableCells } from './markdown-inline.ts'

/** What shows a picture a text names, `![words](address)`, alone on its line (`block`) or within a line. */
export type MarkdownFigure = (address: string, alt: string, block: boolean) => ReactNode

/**
 * A small Markdown reader for what a model writes in Prose and in its full answers: headings, paragraphs,
 * lists, tables, quotes, code, emphasis, struck text and links shown as text. It builds React elements, never
 * HTML, so nothing written can run. A picture is shown only by the `figure` given, which knows what its address
 * names; without one, its words show.
 */
export function Markdown({ text, figure }: { text: string; figure?: MarkdownFigure | undefined }) {
  const inline = (line: string) => drawn(inlineSteps(line), figure)
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
        <Tag key={key()} className={`${style} mt-1.5 leading-snug [overflow-wrap:anywhere]`}>
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
          className={`grid grid-cols-1 gap-1 pl-5 [overflow-wrap:anywhere] ${ordered ? 'list-decimal marker:font-mono marker:text-text-faint marker:text-xs' : 'list-disc marker:text-text-faint'}`}
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
      const head = tableCells(line)
      index += 2
      const rows: string[][] = []
      while (index < lines.length && isRow(lines[index] ?? '')) rows.push(tableCells(lines[index++] ?? ''))
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
        <blockquote key={key()} className="border-line-strong border-l-2 pl-3.5 text-text-soft [overflow-wrap:anywhere]">
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
    // Lines of pictures alone are figures, each as wide as the column lets it be.
    const steps = paragraph.map(inlineSteps)
    if (figure && steps.every(picturesOnly)) {
      blocks.push(
        <div key={key()} className="flex min-w-0 flex-wrap items-start gap-3">
          {steps.flat().map((step, at) =>
            step.type === 'picture' ? (
              <span key={at} className="contents">
                {figure(step.address, step.alt, true)}
              </span>
            ) : null
          )}
        </div>
      )
      continue
    }
    // A line break inside a paragraph is kept, as in a letter's address block or a poem.
    blocks.push(
      <p key={key()} className="text-pretty leading-relaxed [overflow-wrap:anywhere]">
        {steps.flatMap((line, at) => (at === 0 ? drawn(line, figure) : [<br key={`br-${at}`} />, ...drawn(line, figure)]))}
      </p>
    )
  }

  // One column that is never wider than where it is drawn: a long word, an address or a path in the prose breaks
  // anywhere rather than widening it, code wraps in its box, and a table wider than the column scrolls in its own.
  return <div className="grid min-w-0 max-w-[68ch] grid-cols-1 gap-3 text-sm">{blocks}</div>
}

/** A line of a table: it starts and ends with a pipe. */
const isRow = (line: string) => /^\s*\|.*\|\s*$/.test(line)

/** The steps of a line as elements: a link shows its words, and its address is not followed. */
function drawn(steps: readonly InlineStep[], figure: MarkdownFigure | undefined): ReactNode[] {
  return steps.map((step, key) => {
    switch (step.type) {
      case 'text':
        return step.text
      case 'strong':
        return (
          <strong key={key} className="font-semibold">
            {drawn(step.steps, figure)}
          </strong>
        )
      case 'emphasis':
        return <em key={key}>{drawn(step.steps, figure)}</em>
      case 'struck':
        return (
          <s key={key} className="decoration-text-faint">
            {drawn(step.steps, figure)}
          </s>
        )
      case 'code':
        return (
          <code key={key} className="rounded-xs bg-white/[0.06] px-1 py-px font-mono text-[0.85em]">
            {step.text}
          </code>
        )
      case 'link':
        return (
          <span key={key} className="text-accent">
            {drawn(step.steps, figure)}
          </span>
        )
    }
    // A picture: shown by the figure given, else its words.
    return figure ? (
      <span key={key} className="contents">
        {figure(step.address, step.alt, false)}
      </span>
    ) : (
      step.alt
    )
  })
}
