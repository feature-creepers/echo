import type { Client, ThreadRead } from '@repo/client'
import type { AccessUse, Exchange, FileChange, Persona, Step } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { AttachedLine } from '../attachments/attached-line.tsx'
import { Changes } from '../changes/changes.tsx'
import { Counts, PathLine, type Relative } from '../changes/diff-view.tsx'
import { type Undo, UndoAction } from '../changes/undo-action.tsx'
import { useAssistantFolder } from '../changes/use-assistant-folder.ts'
import { type ThreadChanges, useThreadChanges } from '../changes/use-thread-changes.ts'
import { changedInWords, lastPart, relativePath, totalOf } from '../changes/words.ts'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { BackGlyph } from '../primitives/icons.tsx'
import { accentStyle } from '../styles/accent.ts'
import { settle } from '../styles/motion.ts'
import { Markdown } from '../view/blocks/markdown.tsx'
import { AnswerActions } from './full-answer.tsx'
import { commandOf, stepSummary, stepTitle } from './steps.ts'
import { StateDot } from './thread-list.tsx'
import { whoAsked } from './who-asked.ts'

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const STATE = { working: 'working', ready: 'ready', parked: 'idle' } as const

export interface ThreadViewProps {
  client: Client
  thread: string
  personas: readonly Persona[]
  onBack(): void
}

/**
 * One thread, whole, for those who want to see the work: each thing asked, every tool call with what went in
 * and came out (folded until opened), what was said aloud, and the full written answer. Kept current while
 * the thread works.
 */
export function ThreadView({ client, thread, personas, onBack }: ThreadViewProps) {
  const [read, setRead] = useState<ThreadRead | { problem: string }>()

  const load = useCallback(() => {
    client.threads
      .read(thread)
      .then(setRead)
      .catch((error: unknown) => setRead({ problem: error instanceof Error ? error.message : String(error) }))
  }, [client, thread])

  // Read again, a moment after anything that concerns this thread, so a working thread fills in as it goes.
  useEffect(() => {
    load()
    let timer: number | undefined
    const soon = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(load, 200)
    }
    const stop = client.session.onEvent((event) => {
      const concerns =
        (event.name === 'activity' && event.step?.thread === thread) ||
        ((event.name === 'turn.started' || event.name === 'turn.ended' || event.name === 'answer.written') && event.exchange.thread === thread) ||
        (event.name === 'view.shown' && event.view.thread === thread) ||
        event.name === 'threads.changed'
      if (concerns) soon()
    })
    return () => {
      stop()
      window.clearTimeout(timer)
    }
  }, [client, thread, load])

  const header = read && 'thread' in read ? read.thread : client.threads.current().threads.find((one) => one.id === thread)

  // The turns that changed files, whose changes are read from the activity: each use, and the turn's files counted.
  const changing = useMemo(
    () => (read && 'steps' in read ? [...new Set(read.steps.filter((step) => step.tool === 'computer_write').map((step) => step.turn))] : []),
    [read]
  )
  const changes = useThreadChanges(client, thread, changing)
  const assistantFolder = useAssistantFolder(client)
  const folder = header?.folder
  const relative = useCallback<Relative>((path) => relativePath(path, [folder, assistantFolder]), [folder, assistantFolder])
  const undo = useCallback<Undo>(
    async (use, anyway) => {
      const undone = await client.session.run('activity.undo', { use, anyway })
      if (undone.use) changes.accept(undone.use)
      return undone.outcome
    },
    [client, changes]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-1 gap-2 border-line border-b px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 flex w-fit items-center gap-1 rounded-sm px-1 py-0.5 text-text-faint text-xs transition-colors hover:text-text"
        >
          <BackGlyph /> Threads
        </button>
        {header && (
          <div className="flex items-start justify-between gap-3">
            <div className="grid min-w-0 gap-1">
              <span className="font-medium text-[0.9375rem] leading-snug [overflow-wrap:anywhere]">{header.title}</span>
              <span className="flex min-w-0 items-center gap-2 text-label text-text-faint">
                <StateDot state={header.state} />
                <span className="min-w-0 truncate">
                  {header.kind === 'aside' ? 'Aside' : 'Topic'} · {STATE[header.state]}
                  {header.folder && <span title={header.folder}> · in {lastPart(header.folder)}</span>}
                </span>
              </span>
            </div>
            <Button kind="quiet" size="sm" className="shrink-0" onClick={() => void client.threads.focus(thread).catch(() => undefined)}>
              {header.kind === 'aside' ? 'Show the card' : 'Show on screen'}
            </Button>
          </div>
        )}
      </div>
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
        {read === undefined ? (
          <p className="text-sm text-text-faint">Reading…</p>
        ) : 'problem' in read ? (
          <p className="text-danger text-sm [overflow-wrap:anywhere]">{read.problem}</p>
        ) : read.exchanges.length === 0 ? (
          <p className="text-sm text-text-faint">Nothing has been answered here yet.</p>
        ) : (
          <ol className="grid grid-cols-1 gap-6">
            {read.earlier > 0 && (
              <li className="text-label text-text-faint">
                {read.earlier === 1 ? 'One earlier request is' : `${read.earlier} earlier requests are`} not shown: this thread is too long to show whole.
              </li>
            )}
            {read.exchanges.map((exchange) => (
              <ExchangeEntry
                key={exchange.turn}
                exchange={exchange}
                steps={read.steps.filter((step) => step.turn === exchange.turn)}
                views={read.views.filter((view) => view.turn === exchange.turn).map((view) => view.title)}
                persona={personas.find((candidate) => candidate.id === exchange.persona)}
                about={header?.title}
                client={client}
                changes={changes}
                relative={relative}
                undo={undo}
              />
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

interface ExchangeEntryProps {
  exchange: Exchange
  steps: Step[]
  views: string[]
  persona: Persona | undefined
  /** What the thread is about, to name its full answer when it is saved. */
  about: string | undefined
  client: Client
  changes: ThreadChanges
  relative: Relative
  undo: Undo
}

/** What a step opened shows, and how to undo the change it made: what the rows of one exchange share. */
interface StepContext {
  client: Client
  relative: Relative
  undo: Undo
}

// Every stack here is one column that is never wider than the sheet, whatever it holds: a long address, a path or
// a command wraps, or scrolls in its own box, instead of widening the column and the sheet with it.
function ExchangeEntry({ exchange, steps, views, persona, about, client, changes, relative, undo }: ExchangeEntryProps) {
  // Views shown before calls were kept have no call to show them by.
  const shownByCalls = steps.some((step) => step.tool === 'ui_render')
  const files = changes.turns.get(exchange.turn)
  const context: StepContext = { client, relative, undo }
  return (
    <li className="grid grid-cols-1 gap-3" style={accentStyle(persona?.accent)}>
      <div className="grid grid-cols-1 gap-1">
        <span className="flex items-baseline gap-2 text-label text-text-faint">
          {whoAsked(exchange)} <time dateTime={exchange.at}>{clock.format(new Date(exchange.at))}</time>
        </span>
        {exchange.said && <p className="text-sm text-text-soft leading-relaxed [overflow-wrap:anywhere]">{exchange.said}</p>}
        <AttachedLine attached={exchange.attached} />
      </div>

      {files && files.length > 0 && <TurnChanges turn={exchange.turn} files={files} context={context} />}

      {(steps.length > 0 || (!shownByCalls && views.length > 0)) && (
        <div className="grid grid-cols-1 gap-1">
          <Eyebrow>Work</Eyebrow>
          <ul className="grid grid-cols-1 overflow-hidden rounded-md border border-line">
            {steps.map((step) => (
              <StepRow key={step.call} step={step} use={step.use === undefined ? undefined : changes.uses.get(step.use)} context={context} />
            ))}
            {!shownByCalls &&
              views.map((title) => (
                <li key={title} className="flex items-baseline gap-2 border-line border-t px-3 py-2 text-xs first:border-t-0">
                  <span className="shrink-0 text-text-soft">Showed a view</span>
                  <span className="min-w-0 truncate text-text-faint">{title}</span>
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-1 border-accent/50 border-l pl-3">
        <span className="text-accent text-label">{persona?.name ?? 'Assistant'} said</span>
        {exchange.replied ? (
          <p className="text-sm leading-relaxed [overflow-wrap:anywhere]">{exchange.replied}</p>
        ) : exchange.outcome === 'running' ? (
          <p className="text-sm text-text-faint">…</p>
        ) : null}
        {exchange.outcome === 'stopped' && <p className="text-label text-text-faint">Stopped</p>}
        {exchange.outcome === 'failed' && (
          <p className="text-danger text-sm leading-relaxed [overflow-wrap:anywhere]">{exchange.problem ?? 'It could not answer.'}</p>
        )}
      </div>

      {exchange.written && (
        <div className="grid grid-cols-1 gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <Eyebrow>Full answer</Eyebrow>
            <AnswerActions text={exchange.written} about={about} />
          </div>
          <div className="grid grid-cols-1 gap-3 rounded-md border border-line bg-ground/60 px-4 py-3 text-sm leading-relaxed [&_h3]:text-lg [&_h4]:text-base">
            <Markdown text={exchange.written} />
          </div>
        </div>
      )}
    </li>
  )
}

/** The calls whose summary is a file's path. */
const FILE_TOOLS = new Set(['computer_read', 'computer_write'])

/** Whether a use made a change to files that can be shown: allowed, and not reported failed. */
const changedFiles = (use: AccessUse | undefined): use is AccessUse =>
  use !== undefined && use.action !== 'read' && use.action !== 'run' && use.decision !== 'refused' && use.outcome?.ok !== false

/** What a use's diff depends on: read again once the change is known to be done, or undone. */
const versionOf = (use: AccessUse) => `${use.outcome ? (use.outcome.ok ? 'done' : 'failed') : 'running'}:${use.undo?.done ?? ''}`

/** What opens under a row: a fade and a short rise, as the Activity page opens a row. */
function Opening({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={settle}
          className="grid grid-cols-1 gap-2.5"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

const Chevron = ({ open }: { open: boolean }) => (
  <span aria-hidden="true" className={cn('w-2 shrink-0 text-text-faint transition-transform duration-150', open && 'rotate-90')}>
    ›
  </span>
)

/** The files a turn changed, in one line that opens their diffs together: each file once, as the turn left it. */
function TurnChanges({ turn, files, context }: { turn: string; files: FileChange[]; context: StepContext }) {
  const [open, setOpen] = useState(false)
  const said = changedInWords(files)
  const version = files.map((file) => `${file.path}:${file.added}:${file.removed}`).join(',')
  return (
    <div className="grid grid-cols-1 gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-md border border-line px-3 py-2 text-left text-xs transition-colors hover:bg-raised"
      >
        <Chevron open={open} />
        <span className="min-w-0 flex-1 truncate text-text-soft">{said.files}</span>
        <Counts change={said} className="text-[0.6875rem]" />
      </button>
      <Opening open={open}>
        <Changes client={context.client} of={{ turn }} relative={context.relative} version={version} />
      </Opening>
    </div>
  )
}

/** One tool call: what it did and on what; opened, the diff of what it changed, or its input and its output whole. */
function StepRow({ step, use, context }: { step: Step; use: AccessUse | undefined; context: StepContext }) {
  const [open, setOpen] = useState(false)
  const summary = stepSummary(step, context.relative)
  const running = step.ended === undefined
  const seconds = step.ended && step.at ? (new Date(step.ended).getTime() - new Date(step.at).getTime()) / 1000 : undefined
  const changed = changedFiles(use) ? use : undefined
  const total = changed ? totalOf(changed) : undefined
  const command = commandOf(step)
  return (
    <li className="border-line border-t first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-raised"
      >
        <Chevron open={open} />
        <span className={cn('shrink-0', step.failed ? 'text-danger' : 'text-text-soft')}>{stepTitle(step, use)}</span>
        {summary && FILE_TOOLS.has(step.tool) ? (
          // A path gives way from its start, so the file's name stays in sight.
          <PathLine path={summary} className="flex-1 text-[0.6875rem] text-text-faint" />
        ) : (
          <span className={cn('min-w-0 flex-1 truncate text-text-faint', (command || step.tool.startsWith('computer_')) && 'font-mono text-[0.6875rem]')}>
            {summary}
          </span>
        )}
        {total && <Counts change={total} className="text-[0.6875rem]" />}
        {changed?.undo?.done && <span className="shrink-0 text-[0.6875rem] text-accent">undone</span>}
        <span className="shrink-0 font-mono text-[0.625rem] text-text-faint tabular-nums">
          {running ? <span className="animate-pulse text-accent">running</span> : seconds !== undefined ? `${seconds.toFixed(1)} s` : ''}
        </span>
      </button>
      <Opening open={open}>
        <div className="grid grid-cols-1 gap-2.5 px-3 pb-3">
          {changed ? (
            <>
              <Changes client={context.client} of={{ use: changed.id }} relative={context.relative} version={versionOf(changed)} />
              <UndoAction use={changed} undo={context.undo} />
            </>
          ) : (
            <>
              {command !== undefined ? (
                <Detail label="Command" text={command} />
              ) : (
                <Detail label={`${step.tool} · input`} text={step.input === undefined ? '—' : JSON.stringify(step.input, null, 2)} />
              )}
              <Detail label="Output" text={step.output ?? (running ? 'Still running.' : '—')} />
            </>
          )}
        </div>
      </Opening>
    </li>
  )
}

function Detail({ label, text }: { label: string; text: string }) {
  return (
    <div className="grid grid-cols-1 gap-1">
      <span className="text-[0.6875rem] text-text-faint">{label}</span>
      <pre className="scroll-quiet max-h-72 overflow-auto whitespace-pre-wrap rounded-sm bg-ground p-2.5 font-mono text-[0.6875rem] text-text-soft leading-relaxed [overflow-wrap:anywhere]">
        {text}
      </pre>
    </div>
  )
}
