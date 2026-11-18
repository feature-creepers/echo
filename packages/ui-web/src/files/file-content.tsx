import { type Client, readFile } from '@repo/client'
import { ATTACHMENT_MAX_BYTES } from '@repo/protocol'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { Markdown } from '../view/blocks/markdown.tsx'
import { badgeOf, extensionOf, kindOf, previewTypeOf } from './kinds.ts'
import { sizeWords, tableRows } from './words.ts'

/** How much of a text is read to show it: enough for any document a person reads in a pane. */
const TEXT_LIMIT = 1024 * 1024

export interface FileContentProps {
  client: Client
  /** The file: its path in the assistant's folder, or where it is on the computer. */
  path: string
  name: string
  size: number
  /** When it last changed: a newer version is read again. */
  modified?: string | undefined
  className?: string
}

type Reading = { is: 'reading' } | { is: 'failed' } | { is: 'read'; bytes: Uint8Array; size: number }

/**
 * A file's content, shown as what it is: Markdown as the Prose block shows it, text and code in the monospace
 * face, a table as a table, a picture, a PDF in the window's own viewer, and anything else as its kind and size.
 */
export function FileContent({ client, path, name, size, modified, className }: FileContentProps) {
  const kind = kindOf(name)
  const limit = kind.preview === 'image' || kind.preview === 'pdf' ? ATTACHMENT_MAX_BYTES : TEXT_LIMIT
  const shown = kind.preview !== 'none' && (kind.preview === 'markdown' || kind.preview === 'text' || kind.preview === 'csv' || size <= limit)
  const [reading, setReading] = useState<Reading>({ is: 'reading' })

  // Read again when the file changes: a newer version of the same file.
  useEffect(() => {
    if (!shown) return
    let current = true
    setReading({ is: 'reading' })
    readFile(client.session, path, limit).then(
      (read) => current && setReading({ is: 'read', bytes: read.bytes, size: read.size }),
      () => current && setReading({ is: 'failed' })
    )
    return () => {
      current = false
    }
  }, [client, path, limit, shown, modified])

  if (!shown) return <NoPreview name={name} size={size} className={className} note={kind.preview === 'none' ? undefined : 'Too large to show here.'} />
  if (reading.is === 'failed') return <NoPreview name={name} size={size} className={className} note="It could not be read." />
  if (reading.is === 'reading') return <Opening className={className} />
  return <Shown name={name} bytes={reading.bytes} size={reading.size} className={className} />
}

function Shown({ name, bytes, size, className }: { name: string; bytes: Uint8Array; size: number; className?: string | undefined }) {
  const kind = kindOf(name)
  const cut = bytes.length < size
  const text = useMemo(() => (kind.preview === 'image' || kind.preview === 'pdf' ? '' : new TextDecoder().decode(bytes)), [bytes, kind.preview])
  const url = useObjectUrl(kind.preview === 'image' || kind.preview === 'pdf' ? bytes : undefined, previewTypeOf(name))
  const note = cut ? (
    <p className="mt-4 text-text-faint text-xs">
      Showing the first {sizeWords(bytes.length)} of {sizeWords(size)}.
    </p>
  ) : null

  switch (kind.preview) {
    case 'image':
      return (
        <div className={cn('flex min-h-0 items-center justify-center p-6', className)}>
          {url && <img src={url} alt={name} className="max-h-full max-w-full rounded-xs object-contain shadow-[0_0_0_1px_rgb(255_255_255/0.07)]" />}
        </div>
      )
    case 'pdf':
      return <div className={cn('min-h-0', className)}>{url && <iframe src={url} title={name} className="h-full w-full border-0 bg-ground" />}</div>
    case 'markdown':
      return (
        <Scroll className={className}>
          <div className="mx-auto max-w-[44rem] text-[0.875rem]">
            <Markdown text={text} />
          </div>
          {note}
        </Scroll>
      )
    case 'csv':
      return (
        <Scroll className={className}>
          <Table rows={tableRows(text, extensionOf(name) === 'tsv' ? '\t' : ',')} />
          {note}
        </Scroll>
      )
    default:
      return (
        <Scroll className={className}>
          <pre className="whitespace-pre-wrap font-mono text-[0.75rem] text-text-soft leading-relaxed [overflow-wrap:anywhere]">{readable(name, text)}</pre>
          {note}
        </Scroll>
      )
  }
}

/** JSON laid out to be read, when it is whole; anything else as it is. */
function readable(name: string, text: string): string {
  if (extensionOf(name) !== 'json') return text
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function Table({ rows }: { rows: string[][] }) {
  const [head, ...body] = rows
  if (!head) return <p className="text-sm text-text-faint">This table is empty.</p>
  return (
    <div className="scroll-quiet overflow-x-auto rounded-md border border-line">
      <table className="w-full border-collapse text-[0.8125rem]">
        <thead>
          <tr className="border-line border-b bg-white/[0.02]">
            {head.map((value, column) => (
              <th key={column} className="h-8 whitespace-nowrap px-3 text-left font-normal text-[0.6875rem] text-text-faint">
                {value}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, index) => (
            <tr key={index} className="border-line border-b last:border-b-0">
              {head.map((_, column) => (
                <td key={column} className="px-3 py-1.5 align-top">
                  {row[column] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Scroll({ className, children }: { className?: string | undefined; children: ReactNode }) {
  return <div className={cn('scroll-quiet min-h-0 overflow-auto px-6 py-5', className)}>{children}</div>
}

function Opening({ className }: { className?: string | undefined }) {
  return (
    <div className={cn('flex items-center justify-center', className)} role="status">
      <Eyebrow>Opening…</Eyebrow>
    </div>
  )
}

/** A file shown as what it is, with no look inside: a large mark of its kind, its kind and its size. */
export function NoPreview({
  name,
  size,
  note,
  className
}: {
  name: string
  size?: number | undefined
  note?: string | undefined
  className?: string | undefined
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 text-center', className)}>
      <FileMark name={name} large />
      <div className="grid gap-1">
        <span className="text-sm text-text-soft">
          {kindOf(name).label}
          {size === undefined ? '' : ` · ${sizeWords(size)}`}
        </span>
        <span className="text-text-faint text-xs">{note ?? 'There is no preview for this kind of file. Open it with its app.'}</span>
      </div>
    </div>
  )
}

/** A file's mark: its outline, with its extension on it. */
export function FileMark({ name, large = false }: { name: string; large?: boolean }) {
  if (large)
    return (
      <span className="relative flex h-[4.5rem] w-14 items-end justify-center text-text-faint">
        <svg
          viewBox="0 0 56 72"
          className="absolute inset-0 size-full"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 1.5h30L54.5 20v48a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 68V4A2.5 2.5 0 0 1 6 1.5ZM36 1.5V20h18.5" />
        </svg>
        <span className="relative mb-3.5 font-mono text-[0.625rem] text-text-soft uppercase">{badgeOf(name)}</span>
      </span>
    )
  return (
    <span className="flex h-6 w-7 shrink-0 items-center justify-center rounded-xs border border-line-strong font-mono text-[0.5625rem] text-text-soft uppercase">
      {badgeOf(name)}
    </span>
  )
}

/** An address for bytes the window can show, made while they are shown and let go of after. */
function useObjectUrl(bytes: Uint8Array | undefined, type: string): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!bytes) return setUrl(undefined)
    const made = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }))
    setUrl(made)
    return () => URL.revokeObjectURL(made)
  }, [bytes, type])
  return url
}
