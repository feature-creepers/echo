import type { ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

/** Headings start small: the prose sits inside a view or a sheet that has a title of its own. */
const HEADING = 'mt-1.5 leading-snug [overflow-wrap:anywhere]'

/**
 * How each element of the Markdown is drawn. Links show their words and are not followed, pictures show their
 * words, since an address in a model's text is not one the window should load, and HTML is not read at all.
 */
const COMPONENTS: Components = {
  h1: ({ children }) => <h3 className={`${HEADING} font-medium text-lg tracking-[-0.015em]`}>{children}</h3>,
  h2: ({ children }) => <h4 className={`${HEADING} font-medium text-base tracking-[-0.01em]`}>{children}</h4>,
  h3: ({ children }) => <h5 className={`${HEADING} font-medium text-sm`}>{children}</h5>,
  h4: ({ children }) => <h5 className={`${HEADING} font-medium text-sm`}>{children}</h5>,
  h5: ({ children }) => <h6 className={`${HEADING} font-medium text-sm`}>{children}</h6>,
  h6: ({ children }) => <h6 className={`${HEADING} font-medium text-sm`}>{children}</h6>,
  p: ({ children }) => <p className="text-pretty leading-relaxed [overflow-wrap:anywhere]">{children}</p>,
  ul: ({ children, className }) => (
    <ul
      className={`grid grid-cols-1 gap-1 pl-5 [overflow-wrap:anywhere] ${className === 'contains-task-list' ? 'list-none' : 'list-disc marker:text-text-faint'}`}
    >
      {children}
    </ul>
  ),
  ol: ({ children, start }) => (
    <ol start={start} className="grid grid-cols-1 gap-1 pl-5 [overflow-wrap:anywhere] list-decimal marker:font-mono marker:text-text-faint marker:text-xs">
      {children}
    </ol>
  ),
  li: ({ children, className }) =>
    className === 'task-list-item' ? (
      <li className="-ml-5 flex items-baseline gap-2.5 leading-relaxed">{children}</li>
    ) : (
      <li className="pl-1 leading-relaxed">{children}</li>
    ),
  // A checklist's box ("- [ ] passport", "- [x] tickets"), drawn in the app's own look rather than the system's.
  input: ({ checked }) => (
    <span
      aria-hidden="true"
      className={`relative top-[0.1875rem] size-3 shrink-0 rounded-xs border ${checked ? 'border-accent bg-accent/80' : 'border-line-strong'}`}
    />
  ),
  blockquote: ({ children }) => <blockquote className="border-line-strong border-l-2 pl-3.5 text-text-soft [overflow-wrap:anywhere]">{children}</blockquote>,
  pre: ({ children }) => (
    <pre className="whitespace-pre-wrap rounded-md border border-line bg-ground px-3.5 py-3 font-mono text-text-soft text-xs leading-relaxed [overflow-wrap:anywhere] [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[1em]">
      {children}
    </pre>
  ),
  code: ({ children }) => <code className="rounded-xs bg-white/[0.06] px-1 py-px font-mono text-[0.85em]">{children}</code>,
  table: ({ children }) => (
    <div className="scroll-quiet overflow-x-auto rounded-md border border-line">
      <table className="w-full border-collapse text-left text-[0.875rem]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-raised/60">{children}</thead>,
  tr: ({ children }) => <tr className="border-line border-t first:border-t-0">{children}</tr>,
  th: ({ children }) => <th className="px-3 py-1.5 font-medium text-text-soft">{children}</th>,
  td: ({ children }) => <td className="px-3 py-1.5 tabular-nums">{children}</td>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  del: ({ children }) => <s className="decoration-text-faint">{children}</s>,
  a: ({ children }) => <span className="text-accent">{children}</span>,
  img: ({ alt }) => alt ?? null,
  hr: () => <hr className="border-line" />
}

const PLUGINS = [remarkGfm, remarkBreaks]

/**
 * Markdown as a model writes it in Prose and in its full answers, and as a Markdown file holds it: CommonMark with
 * GitHub's tables, checklists and struck text, a line break kept where it was written. It builds React elements,
 * never HTML, so nothing written can run.
 */
export function Markdown({ text }: { text: string }): ReactNode {
  // One column that is never wider than where it is drawn: a long word, an address or a path in the prose breaks
  // anywhere rather than widening it, code wraps in its box, and a table wider than the column scrolls in its own.
  return (
    <div className="grid min-w-0 max-w-[68ch] grid-cols-1 gap-3 text-sm">
      <ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTS} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  )
}
