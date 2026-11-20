import type { Client } from '@repo/client'
import type { AccessUse, FileChange, Persona, Step, Thread } from '@repo/protocol'
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
import { useFollowLatest } from './follow-latest.ts'
import { AnswerActions } from './full-answer.tsx'
import { GoArrow } from './go-arrow.tsx'
import { LatestButton } from './latest-button.tsx'
import { PlanList } from './plan-list.tsx'
import { commandOf, stepSummary, stepTitle } from './steps.ts'
import { kindWords, overOf, STATE, StateDot, StopThread, underOf, underWords, usedWords } from './thread-list.tsx'
import type { ThreadEntry } from './thread-pages.ts'
import { type EarlierReading, useThreadPages } from './use-thread-pages.ts'
import { whoAsked } from './who-asked.ts'

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

interface ThreadViewProps {
  client: Client
  thread: string
  /** Every thread, to show the one this thread is part of and those it handed work to. */
  threads: readonly Thread[]
  personas: readonly Persona[]
  onBack(): void
  /** Open another thread's work in its place. */
  onOpenThread(thread: string): void
}

/**
 * One thread, for those who want to see the work: each thing asked, every tool call with what went in and came
 * out (folded until opened, and read whole then), what was said aloud, and the full written answer. It opens at
 * the latest request and follows the thread as it works; earlier requests are read as the person scrolls up. Its
 * header says where it stands, stops it while it works, and leads to the thread it is part of and to those it
 * handed work to.
 */
export function ThreadView({ client, thread, threads, personas, onBack, onOpenThread }: ThreadViewProps) {
  const scroll = useFollowLatest()
  const { pages, problem, earlier, readEarlier } = useThreadPages(client, thread, scroll.prepend)

  // The list is current as the thread's state changes; the page read may be a moment behind it.
  const header = threads.find((one) => one.id === thread) ?? pages?.thread

  // The turns that changed files, whose changes are read from the activity: each use, and the turn's files counted.
  const changing = useMemo(
    () => (pages ? pages.entries.filter((entry) => entry.steps.some((step) => step.tool === 'computer_write')).map((entry) => entry.exchange.turn) : []),
    [pages]
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
      <ThreadHeader
        header={header}
        threads={threads}
        onBack={onBack}
        onOpenThread={onOpenThread}
        onStop={() => void client.threads.stop(thread).catch(() => undefined)}
        onFocus={() => void client.threads.focus(thread).catch(() => undefined)}
      />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scroll.ref} className="scroll-quiet min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
          <div>
            {pages === undefined ? (
              problem === undefined ? (
                <p className="text-sm text-text-faint">Reading…</p>
              ) : (
                <p className="text-danger text-sm [overflow-wrap:anywhere]">{problem}</p>
              )
            ) : pages.entries.length === 0 ? (
              <p className="text-sm text-text-faint">Nothing has been answered here yet.</p>
            ) : (
              <ol className="grid grid-cols-1 gap-6">
                {pages.earlier > 0 && <EarlierRequests count={pages.earlier} reading={earlier} read={readEarlier} area={scroll.area} />}
                {pages.entries.map((entry) => (
                  <ExchangeEntry
                    key={entry.exchange.turn}
                    entry={entry}
                    persona={personas.find((candidate) => candidate.id === entry.exchange.persona)}
                    about={header?.title}
                    context={{ client, thread, relative, undo }}
                    changes={changes}
                  />
                ))}
              </ol>
            )}
          </div>
        </div>
        <LatestButton scroll={scroll} />
      </div>
    </div>
  )
}

interface ThreadHeaderProps {
  /** The thread, once it is known. */
  header: Thread | undefined
  threads: readonly Thread[]
  onBack(): void
  onOpenThread(thread: string): void
  onStop(): void
  onFocus(): void
}

/**
 * The top of a thread's work. Its first line is the way back: to the list, or to the thread it is part of, as a
 * path; and what can be done with it from here: brought to the screen, for a topic, or stopped while it works.
 * Under it, what the thread is and where it stands, then the threads it handed work to, each a step away.
 */
function ThreadHeader({ header, threads, onBack, onOpenThread, onStop, onFocus }: ThreadHeaderProps) {
  const over = header === undefined ? undefined : overOf(header)
  const above = over === undefined ? undefined : threads.find((one) => one.id === over)
  const under = header === undefined ? [] : underOf(header.id, threads)
  const working = header?.state === 'working'
  const meta =
    header === undefined
      ? []
      : [
          kindWords(header),
          STATE[header.state],
          header.folder === undefined ? undefined : `in ${lastPart(header.folder)}`,
          working ? undefined : usedWords(header.at, new Date())
        ].filter((part) => part !== undefined && part !== '')
  return (
    <div className="grid grid-cols-1 gap-2 border-line border-b px-4 pt-2 pb-3">
      <div className="-ml-1 flex min-w-0 items-center gap-0.5 text-text-faint text-xs">
        <button type="button" onClick={onBack} className="flex shrink-0 items-center gap-1 rounded-sm px-1 py-0.5 transition-colors hover:text-text">
          <BackGlyph /> Threads
        </button>
        {above && (
          <>
            <span aria-hidden="true">/</span>
            <button
              type="button"
              onClick={() => onOpenThread(above.id)}
              title={`Show the work of ${above.title}`}
              className="min-w-0 truncate rounded-sm px-1 py-0.5 transition-colors hover:text-text"
            >
              {above.title}
            </button>
          </>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1 pl-2">
          {/* A sub-thread shows nothing of its own: its work is shown by the thread it works for. */}
          {header !== undefined && header.kind !== 'subthread' && (
            <Button kind="quiet" size="sm" onClick={onFocus}>
              Show on screen
            </Button>
          )}
          {working && <StopThread title={header.title} onClick={onStop} />}
        </span>
      </div>
      {header && (
        <div className="grid min-w-0 gap-1">
          <span className="font-medium text-[0.9375rem] leading-snug [overflow-wrap:anywhere]">{header.title}</span>
          <span className="flex min-w-0 items-center gap-2 text-label text-text-faint">
            <StateDot state={header.state} />
            <span className="min-w-0 truncate" title={header.folder}>
              {meta.join(' · ')}
            </span>
          </span>
        </div>
      )}
      {under.length > 0 && (
        <div className="grid min-w-0 gap-1.5 pt-0.5">
          <Eyebrow>{underWords(under)}</Eyebrow>
          <ul className="flex min-w-0 flex-wrap gap-1">
            {under.map((thread) => (
              <li key={thread.id} className="min-w-0 max-w-full">
                <button
                  type="button"
                  onClick={() => onOpenThread(thread.id)}
                  title={`Show the work of ${thread.title}`}
                  className="group flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-sm bg-white/[0.05] pr-1.5 pl-2 text-text-soft text-xs shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.07)] transition-colors duration-(--duration-quick) ease-soft hover:bg-white/[0.09] hover:text-text"
                >
                  <StateDot state={thread.state} />
                  <span className="min-w-0 truncate">{thread.title}</span>
                  <GoArrow className="text-text-faint" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * Where the earlier requests begin, above the first one read: they are read as it comes near, as the person
 * scrolls up, a page at a time; pressed, it reads them at once, and says why when they could not be read.
 */
function EarlierRequests({ count, reading, read, area }: { count: number; reading: EarlierReading; read(): void; area: HTMLElement | null }) {
  const [mark, setMark] = useState<HTMLLIElement | null>(null)

  // Made again after each page, so a page too short to take the mark out of sight reads the next one.
  useEffect(() => {
    if (!mark || !area || reading.state !== 'idle') return
    const observer = new IntersectionObserver((seen) => seen.some((one) => one.isIntersecting) && read(), { root: area, rootMargin: '600px 0px 0px 0px' })
    observer.observe(mark)
    return () => observer.disconnect()
  }, [mark, area, reading, read])

  const many = count === 1 ? 'One earlier request' : `${count} earlier requests`
  return (
    <li ref={setMark} className="flex min-h-6 items-center justify-center gap-2 text-label text-text-faint">
      {reading.state === 'reading' ? (
        <span>Reading earlier requests…</span>
      ) : reading.state === 'failed' ? (
        <>
          <span className="min-w-0 truncate text-danger" title={reading.problem}>
            Earlier requests could not be read.
          </span>
          <Button kind="quiet" size="sm" onClick={read}>
            Try again
          </Button>
        </>
      ) : (
        <Button kind="quiet" size="sm" onClick={read}>
          {many}
        </Button>
      )}
    </li>
  )
}

interface ExchangeEntryProps {
  entry: ThreadEntry
  persona: Persona | undefined
  /** What the thread is about, to name its full answer when it is saved. */
  about: string | undefined
  context: StepContext
  changes: ThreadChanges
}

/** What a step opened shows, and how to undo the change it made: what the rows of one exchange share. */
interface StepContext {
  client: Client
  /** The thread the steps are of, to read one whole. */
  thread: string
  relative: Relative
  undo: Undo
}

// Every stack here is one column that is never wider than the sheet, whatever it holds: a long address, a path or
// a command wraps, or scrolls in its own box, instead of widening the column and the sheet with it.
function ExchangeEntry({ entry, persona, about, context, changes }: ExchangeEntryProps) {
  const { exchange, steps, views, earlierSteps } = entry
  // Views shown before calls were kept have no call to show them by.
  const shownByCalls = steps.some((step) => step.tool === 'ui_render')
  const files = changes.turns.get(exchange.turn)
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

      <PlanList plan={exchange.plan} />

      {(steps.length > 0 || (!shownByCalls && views.length > 0)) && (
        <div className="grid grid-cols-1 gap-1">
          <Eyebrow>Work</Eyebrow>
          <ul className="grid grid-cols-1 overflow-hidden rounded-md border border-line">
            {earlierSteps > 0 && (
              <li className="px-3 py-2 text-text-faint text-xs">
                {earlierSteps === 1 ? 'One earlier call is' : `${earlierSteps} earlier calls are`} not shown: this request made too many to show.
              </li>
            )}
            {steps.map((step) => (
              <StepRow key={step.call} step={step} use={step.use === undefined ? undefined : changes.uses.get(step.use)} context={context} />
            ))}
            {!shownByCalls &&
              views.map((view) => (
                <li key={view.id} className="flex items-baseline gap-2 border-line border-t px-3 py-2 text-xs first:border-t-0">
                  <span className="shrink-0 text-text-soft">Showed a view</span>
                  <span className="min-w-0 truncate text-text-faint">{view.title}</span>
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
  <span aria-hidden="true" className={cn('w-2 shrink-0 text-text-faint transition-transform duration-(--duration-quick) ease-soft', open && 'rotate-90')}>
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
  // A command found to have changed files shows them under what it printed.
  const commandChanged = use?.action === 'run' && (use.changes?.length ?? 0) > 0 ? use : undefined
  const total = changed ? totalOf(changed) : commandChanged ? totalOf(commandChanged) : undefined
  const command = commandOf(step)
  // Opened, what it was given and gave back are read whole: the row came with their start only.
  const whole = useWholeStep(context, step, open && !changed) ?? step
  const wholeCommand = commandOf(whole)
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
              {wholeCommand !== undefined ? (
                <Detail label="Command" text={wholeCommand} />
              ) : (
                <Detail label={`${step.tool} · input`} text={whole.input === undefined ? '—' : JSON.stringify(whole.input, null, 2)} />
              )}
              <Detail label="Output" text={whole.output ?? (running ? 'Still running.' : '—')} />
              {commandChanged && (
                <Changes client={context.client} of={{ use: commandChanged.id }} relative={context.relative} version={versionOf(commandChanged)} />
              )}
            </>
          )}
        </div>
      </Opening>
    </li>
  )
}

/**
 * A step read whole once its row is opened, and again when it ends. Undefined until it arrives, or if it cannot be
 * read: the row then shows what it came with.
 */
function useWholeStep(context: StepContext, step: Step, wanted: boolean): Step | undefined {
  const [whole, setWhole] = useState<Step>()
  const { client, thread } = context
  const { call, ended } = step
  useEffect(() => {
    if (!wanted) return
    let gone = false
    client.threads.step(thread, call).then(
      (read) => {
        if (!gone) setWhole(read)
      },
      () => undefined
    )
    return () => {
      gone = true
    }
  }, [client, thread, call, ended, wanted])
  return whole?.ended === step.ended ? whole : undefined
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
