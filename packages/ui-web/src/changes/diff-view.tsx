import type { FileChange, FileDiff } from '@repo/protocol'
import { Fragment, memo, type ReactNode, useMemo, useState } from 'react'
import { cn } from '../primitives/cn.ts'
import { FILE_CELLS, markChanges } from './inline.ts'
import { languageOf, paintHunk, type Role, textRuns } from './syntax.ts'
import { type DrawnLine, drawnLines, linesInWords, minus, numberWidth, plus, STATUS_WORDS, splitPath, unchangedAround } from './words.ts'

/** A path as the person reads it, relative to the folder the work is in. */
export type Relative = (path: string) => string

/** How many rows of a file are drawn at first: a long diff draws the rest when asked, so opening it stays quick. */
const FIRST_ROWS = 400

/**
 * What a change did to files, one block per file: a header with the file, what happened to it and the lines added
 * and removed, then its lines as a unified diff shows them, numbered in both versions, with the unchanged lines
 * between changes folded into one quiet row. A long line scrolls sideways inside its block, never the page.
 */
export function DiffView({ files, relative }: { files: readonly FileDiff[]; relative: Relative }) {
  // Past a few files the blocks start folded, so a turn that changed many reads as a list first.
  const folded = files.length > 4
  return (
    <div className="grid grid-cols-1 gap-2">
      {files.map((file) => (
        <FileBlock key={file.path} file={file} relative={relative} startsOpen={!folded} />
      ))}
    </div>
  )
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={cn('shrink-0 transition-transform duration-(--duration-quick) ease-soft', open && 'rotate-90')}
  >
    <path d="M6 3.5 10.5 8 6 12.5" />
  </svg>
)

/**
 * Lines added and removed, in the ok and danger colours, each left out when there are none; a file that is not
 * text, too large, or whose content before is not known, says so instead.
 */
export function Counts({ change, className }: { change: Pick<FileChange, 'added' | 'removed' | 'binary' | 'large' | 'unknown'>; className?: string }) {
  if (change.binary) return <span className={cn('shrink-0 text-text-faint', className)}>binary</span>
  if (change.large) return <span className={cn('shrink-0 text-text-faint', className)}>large</span>
  if (change.unknown) return <span className={cn('shrink-0 text-text-faint', className)}>not compared</span>
  return (
    <span className={cn('inline-flex shrink-0 gap-1.5 font-mono tabular-nums', className)}>
      {change.added > 0 && <span className="text-info">{plus(change.added)}</span>}
      {change.removed > 0 && <span className="text-danger">{minus(change.removed)}</span>}
      {change.added === 0 && change.removed === 0 && <span className="text-text-faint">±0</span>}
    </span>
  )
}

/** A path cut from its start when it does not fit, so the file's name stays in sight. */
export function PathLine({ path, className }: { path: string; className?: string }) {
  const { folder, name } = splitPath(path)
  return (
    <span className={cn('flex min-w-0 font-mono', className)}>
      {folder && (
        <span dir="rtl" className="min-w-0 truncate text-text-faint">
          <bdi>{folder}</bdi>
        </span>
      )}
      <span className="max-w-full shrink-0 truncate">{name}</span>
    </span>
  )
}

function FileBlock({ file, relative, startsOpen }: { file: FileDiff; relative: Relative; startsOpen: boolean }) {
  const [open, setOpen] = useState(startsOpen)
  const status = STATUS_WORDS[file.status]
  return (
    <section className="min-w-0 overflow-hidden bg-black/25 shadow-[inset_0_0_0_1px_rgb(235_230_218/0.07)]">
      <button
        type="button"
        aria-expanded={open}
        title={file.path}
        onClick={() => setOpen(!open)}
        className="flex h-8 w-full min-w-0 items-center gap-2 px-2.5 text-left text-text-faint transition-colors duration-(--duration-quick) ease-soft hover:bg-text/[0.03]"
      >
        <Chevron open={open} />
        <PathLine path={relative(file.path)} className="flex-1 text-text text-xs" />
        {status && <span className="shrink-0 text-[0.6875rem] text-text-faint">{status}</span>}
        <Counts change={file} className="text-[0.6875rem]" />
      </button>
      {open && <FileBody file={file} />}
    </section>
  )
}

/** A note in place of lines, or beside them: quiet, in the sentence face. */
function Note({ children, tone = 'faint' }: { children: ReactNode; tone?: 'faint' | 'warn' }) {
  return (
    <p className={cn('border-line border-t px-3 py-2 text-[0.6875rem] leading-relaxed', tone === 'warn' ? 'text-warn/90' : 'text-text-faint')}>{children}</p>
  )
}

function FileBody({ file }: { file: FileDiff }) {
  if (file.missing) return <Note>Nothing was kept to compare this change with: its versions are gone.</Note>
  if (file.binary) return <Note>Not a text file, so there are no lines to compare.</Note>
  if (file.large) return <Note>Too large to compare here.</Note>
  if (file.unknown) return <Note>What it held before the command ran is not known, so there is nothing to compare it with.</Note>
  if (file.hunks.length === 0) {
    return (
      <Note>
        {file.endings
          ? 'Only the line endings changed, between CRLF and LF.'
          : file.status === 'created'
            ? 'An empty file.'
            : file.status === 'deleted'
              ? 'An empty file was deleted.'
              : 'Nothing in it changed.'}
      </Note>
    )
  }
  return (
    <>
      {file.now && <Note tone="warn">Compared with the file as it is now: the version this change left was not kept.</Note>}
      <Lines file={file} />
      {file.endings && <Note>The line endings changed too, between CRLF and LF.</Note>}
      {file.clipped && <Note>Lines longer than 2,000 characters are shown in part.</Note>}
      {file.cut && <Note>The diff stops here: it is too long to show whole.</Note>}
    </>
  )
}

type Row = { kind: 'gap'; count: number } | { kind: 'line'; line: DrawnLine }

/**
 * The rows of a file's diff: its lines, with the words changed within them marked and their code coloured by the
 * file's language, and between its hunks the unchanged lines they leave out, as one row each.
 */
function rowsOf(file: FileDiff): Row[] {
  const gaps = unchangedAround(file)
  const rows: Row[] = []
  const budget = { cells: FILE_CELLS }
  const language = languageOf(file.path)
  file.hunks.forEach((hunk, index) => {
    const gap = gaps.before[index] ?? 0
    if (gap > 0) rows.push({ kind: 'gap', count: gap })
    const lines = markChanges(drawnLines(hunk), budget)
    const painted = language ? paintHunk(lines, language) : []
    lines.forEach((line, at) => {
      const paint = painted[at]
      rows.push({ kind: 'line', line: paint && paint.length > 0 ? { ...line, paint } : line })
    })
  })
  if (gaps.after > 0 && !file.cut) rows.push({ kind: 'gap', count: gaps.after })
  return rows
}

const TINT = { added: 'bg-info/[0.07]', removed: 'bg-danger/[0.07]', context: '' } as const
const GUTTER_TINT = { added: 'bg-info/[0.11]', removed: 'bg-danger/[0.11]', context: '' } as const
const SIGN = { added: '+', removed: '−', context: '' } as const
const SIGN_COLOUR = { added: 'text-info/80', removed: 'text-danger/80', context: '' } as const
const MARK_TINT = { added: 'bg-info/[0.24]', removed: 'bg-danger/[0.24]', context: '' } as const

/** The colour of each role code takes; comments are the faint text. */
const ROLE_COLOUR: Record<Role, string> = {
  comment: 'text-text-faint',
  keyword: 'text-code-keyword',
  string: 'text-code-string',
  number: 'text-code-number',
  type: 'text-code-type',
  function: 'text-code-function'
}

/** A line's text, its code coloured by its language and the words changed in it tinted more strongly than the line. */
function LineText({ line }: { line: DrawnLine }) {
  if (line.text === '') return ' '
  if ((!line.marks || line.marks.length === 0) && (!line.paint || line.paint.length === 0)) return line.text
  return textRuns(line.text.length, line.paint ?? [], line.marks ?? []).map((run) => {
    const pieces = run.pieces.map((piece) =>
      piece.role ? (
        <span key={piece.start} className={ROLE_COLOUR[piece.role]}>
          {line.text.slice(piece.start, piece.end)}
        </span>
      ) : (
        <Fragment key={piece.start}>{line.text.slice(piece.start, piece.end)}</Fragment>
      )
    )
    const start = run.pieces[0]?.start ?? 0
    return run.marked ? (
      <mark key={start} className={cn('text-inherit', MARK_TINT[line.kind])}>
        {pieces}
      </mark>
    ) : (
      <Fragment key={start}>{pieces}</Fragment>
    )
  })
}

/**
 * The lines, in two columns that share their rows: the numbers and signs, which stay put, and the text, which
 * scrolls sideways on its own. Every row is one line high and never wraps, so the two columns always line up.
 */
const Lines = memo(function Lines({ file }: { file: FileDiff }) {
  const rows = useMemo(() => rowsOf(file), [file])
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, FIRST_ROWS)
  const width = `${numberWidth(file)}ch`
  const rest = rows.slice(shown.length).filter((row) => row.kind === 'line').length
  return (
    <>
      <div className="flex border-line border-t font-mono text-xs leading-5">
        <div aria-hidden="true" className="shrink-0 select-none border-line border-r text-[0.6875rem] text-text-faint/70 tabular-nums">
          {shown.map((row, index) =>
            row.kind === 'gap' ? (
              <div key={index} className="h-5 bg-text/[0.025] text-center text-text-faint/60">
                ⋯
              </div>
            ) : (
              <div key={index} className={cn('flex h-5 pl-2', GUTTER_TINT[row.line.kind])}>
                <span className="text-right" style={{ width }}>
                  {row.line.before ?? ''}
                </span>
                <span className="ml-2 text-right" style={{ width }}>
                  {row.line.after ?? ''}
                </span>
                <span className={cn('w-5 text-center', SIGN_COLOUR[row.line.kind])}>{SIGN[row.line.kind]}</span>
              </div>
            )
          )}
        </div>
        <div className="scroll-quiet min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="w-max min-w-full">
            {shown.map((row, index) =>
              row.kind === 'gap' ? (
                <div key={index} className="flex h-5 items-center bg-text/[0.025] px-2.5 font-sans text-[0.6875rem] text-text-faint">
                  {linesInWords(row.count)} unchanged
                </div>
              ) : (
                <div
                  key={index}
                  className={cn('h-5 whitespace-pre pr-6 pl-1 [tab-size:2]', TINT[row.line.kind], row.line.kind === 'context' ? 'text-text-soft' : 'text-text')}
                >
                  <LineText line={row.line} />
                  {row.line.unended && <span className="ml-3 font-sans text-[0.625rem] text-text-faint">no line break at the end</span>}
                </div>
              )
            )}
          </div>
        </div>
      </div>
      {rest > 0 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="flex h-7 w-full items-center justify-center border-line border-t text-[0.6875rem] text-text-soft transition-colors duration-(--duration-quick) ease-soft hover:bg-text/[0.03] hover:text-text"
        >
          Show the rest · {linesInWords(rest)}
        </button>
      )}
    </>
  )
})
