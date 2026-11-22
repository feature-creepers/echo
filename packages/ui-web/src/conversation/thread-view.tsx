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
import { changedInWords, foldersOf, lastPart, relativePath, totalOf } from '../changes/words.ts'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { ChevronGlyph } from '../primitives/icons.tsx'
import { accentStyle } from '../styles/accent.ts'
import { settle } from '../styles/motion.ts'
import { Markdown } from '../view/blocks/markdown.tsx'
import { BackLink } from './back-link.tsx'
import { useFollowLatest } from './follow-latest.ts'
import { AnswerActions } from './full-answer.tsx'
import { GoArrow } from './go-arrow.tsx'
import { LatestButton } from './latest-button.tsx'
import { PlanList } from './plan-list.tsx'
import { commandOf, stepSummary, stepTitle } from './steps.ts'
import { kindWords, overOf, STATE, StateDot, StopThread, underOf, underWords, usedWords } from './thread-list.tsx'
import type { ThreadEntry } from './thread-pages.ts'
import { answerLine } from './transcript.tsx'
import { type EarlierReading, useThreadPages } from './use-thread-pages.ts'
import { whoAsked } from './who-asked.ts'

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

interface ThreadViewProps {
  client: Client
  thread: string
  /** Every thread, to show the one this thread is part of and those it handed work to. */
  threads: readonly Thread[]
  personas: readonly Persona[]
  /**
   * The way back, and to the threads around it: its header then shows, with what the thread is and where it stands.
   * Left out, its work alone, for a place that says itself which thread it shows.
   */
  nav?: { onBack(): void; onOpenThread(thread: string): void } | undefined
}

/**
 * One thread, for those who want to see the work: each thing asked, every tool call with what went in and came
 * out (folded until opened, and read whole then), what was said aloud, and the full written answer. It opens at
 * the latest request and follows the thread as it works; earlier requests are read as the person scrolls up. Its
 * header says where it stands, stops it while it works, and leads to the thread it is part of and to those it
 * handed work to.
 */
export function ThreadView({ client, thread, threads, personas, nav }: ThreadViewProps) {
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
  const [copy, folder] = foldersOf(header, threads)
  const relative = useCallback<Relative>((path) => relativePath(path, [copy, folder, assistantFolder]), [copy, folder, assistantFolder])
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
      {nav && (
        <ThreadHeader
          header={header}
          threads={threads}
          onBack={nav.onBack}
          onOpenThread={nav.onOpenThread}
          onStop={() => void client.threads.stop(thread).catch(() => undefined)}
          onFocus={() => void client.threads.focus(thread).catch(() => undefined)}
        />
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scroll.ref} className="scroll-quiet min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pt-1 pb-4">
          <div>
            {pages === undefined ? (
              problem === undefined ? (
                <p className="caps pt-3 text-text-soft">Reading</p>
              ) : (
                <p className="pt-3 text-[0.8125rem] text-danger [overflow-wrap:anywhere]">{problem}</p>
              )
            ) : pages.entries.length === 0 ? (
              <p className="pt-3 text-[0.8125rem] text-text-soft">Nothing has been answered here yet.</p>
            ) : (
              <ol className="grid grid-cols-1">
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
          header.copy === undefined ? undefined : `a copy on ${header.copy.branch}`,
          working ? undefined : usedWords(header.at, new Date())
        ].filter((part) => part !== undefined && part !== '')
  return (
    <div className="grid grid-cols-1 gap-2 border-line border-b px-4 pt-2 pb-3">
      <div className="caps flex min-h-6 min-w-0 items-center gap-1.5 text-text-soft">
        <BackLink onClick={onBack}>Threads</BackLink>
        {above && (
          <>
            <span aria-hidden="true">/</span>
            <button
              type="button"
              onClick={() => onOpenThread(above.id)}
              title={`Show the work of ${above.title}`}
              className="min-w-0 truncate transition-colors duration-(--duration-quick) ease-soft hover:text-text"
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
          <span className="caps flex min-w-0 items-center gap-2 text-text-soft">
            <StateDot state={header.state} archived={header.archived} />
            <span className="min-w-0 truncate" title={header.copy?.folder ?? header.folder}>
              {meta.join(' · ')}
            </span>
          </span>
        </div>
      )}
      {under.length > 0 && (
        <div className="grid min-w-0 gap-1 pt-1">
          <Eyebrow>{underWords(under)}</Eyebrow>
          <ul className="grid min-w-0 border-text border-t-2">
            {under.map((thread) => (
              <li key={thread.id} className="min-w-0 border-line border-t first:border-t-0">
                <button
                  type="button"
                  onClick={() => onOpenThread(thread.id)}
                  title={`Show the work of ${thread.title}`}
                  className="group -outline-offset-1 flex h-7 w-full min-w-0 items-center gap-2.5 px-1 text-left text-[0.8125rem] text-text-soft transition-colors duration-(--duration-quick) ease-soft hover:bg-text/[0.06] hover:text-text"
                >
                  <StateDot state={thread.state} archived={thread.archived} />
                  <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                  <GoArrow />
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
    <li ref={setMark} className="caps flex min-h-8 items-center justify-center gap-2 text-text-soft">
      {reading.state === 'reading' ? (
        <span>Reading earlier requests</span>
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
// A request reads as a compact turn, as in the transcript: what was said and what was answered, each on a line or
// two, whole when pressed; its calls and its full answer fold behind a press, the calls open while it works.
function ExchangeEntry({ entry, persona, about, context, changes }: ExchangeEntryProps) {
  const { exchange, steps, views, earlierSteps } = entry
  // Views shown before calls were kept have no call to show them by.
  const shownByCalls = steps.some((step) => step.tool === 'ui_render')
  const files = changes.turns.get(exchange.turn)
  const running = exchange.outcome === 'running'
  const [whole, setWhole] = useState(false)
  const [work, setWork] = useState(running)
  const [written, setWritten] = useState(false)
  const asked = whoAsked(exchange)
  const answer = answerLine(exchange)
  const calls = steps.length + earlierSteps
  const hasWork = steps.length > 0 || (!shownByCalls && views.length > 0)
  // While it works, its calls show as they come; once done, they fold unless opened.
  useEffect(() => {
    if (running) setWork(true)
  }, [running])
  return (
    <li className="grid grid-cols-1 gap-1.5 border-line border-t py-3 first:border-t-0" style={accentStyle(persona?.accent)}>
      <span className="caps flex min-w-0 items-center gap-2 text-text-soft">
        <time dateTime={exchange.at} className="tabular-nums">
          {clock.format(new Date(exchange.at))}
        </time>
        {asked !== 'You' && <span className="truncate">{asked}</span>}
        {running && <span className="ml-auto text-accent">Working</span>}
        {exchange.outcome === 'stopped' && <span className="ml-auto">Stopped</span>}
      </span>
      <button
        type="button"
        aria-expanded={whole}
        onClick={() => setWhole(!whole)}
        title={whole ? 'Show less' : 'Show it whole'}
        className="grid min-w-0 grid-cols-1 gap-1.5 text-left"
      >
        {exchange.said && (
          <span className={cn('text-[0.8125rem] text-text-soft leading-relaxed [overflow-wrap:anywhere]', !whole && 'line-clamp-2')}>{exchange.said}</span>
        )}
        {answer && <span className={cn('text-[0.8125rem] text-text leading-relaxed [overflow-wrap:anywhere]', !whole && 'line-clamp-3')}>{answer}</span>}
      </button>
      <AttachedLine attached={exchange.attached} />
      {exchange.outcome === 'failed' && (
        <span className="text-[0.8125rem] text-danger leading-snug [overflow-wrap:anywhere]">{exchange.problem ?? 'It could not answer.'}</span>
      )}

      {files && files.length > 0 && <TurnChanges turn={exchange.turn} files={files} context={context} />}

      <PlanList plan={exchange.plan} />

      {(hasWork || exchange.written) && (
        <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          {hasWork && (
            <Fold open={work} onToggle={() => setWork(!work)}>
              {calls > 0 ? `${calls} ${calls === 1 ? 'call' : 'calls'}` : 'Work'}
            </Fold>
          )}
          {exchange.written && (
            <Fold open={written} onToggle={() => setWritten(!written)}>
              Full answer
            </Fold>
          )}
        </span>
      )}

      {hasWork && work && (
        <ul className="grid grid-cols-1 border-text border-t-2 border-b border-b-line">
          {earlierSteps > 0 && (
            <li className="py-2 text-[0.75rem] text-text-soft">
              {earlierSteps === 1 ? 'One earlier call is' : `${earlierSteps} earlier calls are`} not shown: this request made too many to show.
            </li>
          )}
          {steps.map((step) => (
            <StepRow key={step.call} step={step} use={step.use === undefined ? undefined : changes.uses.get(step.use)} context={context} />
          ))}
          {!shownByCalls &&
            views.map((view) => (
              <li key={view.id} className="flex items-baseline gap-2 border-line border-t py-2 pl-5 text-[0.75rem] first:border-t-0">
                <span className="shrink-0 text-text">Showed a view</span>
                <span className="min-w-0 truncate text-text-soft">{view.title}</span>
              </li>
            ))}
        </ul>
      )}

      {exchange.written && written && (
        <div className="grid grid-cols-1 gap-1.5">
          <div className="flex justify-end">
            <AnswerActions text={exchange.written} about={about} />
          </div>
          <div className="grid grid-cols-1 gap-3 border-text border-t-2 pt-3 text-[0.8125rem] leading-relaxed [&_h3]:text-base [&_h4]:text-sm">
            <Markdown text={exchange.written} />
          </div>
        </div>
      )}
    </li>
  )
}

/** A small press that folds or unfolds part of a request: its calls, its full answer. */
function Fold({ open, onToggle, children }: { open: boolean; onToggle(): void; children: string }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="caps flex h-6 items-center gap-1 text-text-soft transition-colors duration-(--duration-quick) ease-soft hover:text-text aria-expanded:text-text"
    >
      <Chevron open={open} />
      {children}
    </button>
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
  <span
    aria-hidden="true"
    className={cn('shrink-0 text-text-soft transition-transform duration-(--duration-quick) ease-soft [&_svg]:size-3', !open && '-rotate-90')}
  >
    <ChevronGlyph />
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
        className="-outline-offset-1 flex w-full items-center gap-2 border-line border-y py-2 pr-1 text-left text-[0.75rem] transition-colors duration-(--duration-quick) ease-soft hover:bg-text/[0.06]"
      >
        <Chevron open={open} />
        <span className="min-w-0 flex-1 truncate text-text">{said.files}</span>
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
        className="-outline-offset-1 flex w-full items-baseline gap-2 py-2 pr-1 text-left text-[0.75rem] transition-colors duration-(--duration-quick) ease-soft hover:bg-text/[0.06]"
      >
        <Chevron open={open} />
        <span className={cn('shrink-0', step.failed ? 'text-danger' : 'text-text')}>{stepTitle(step, use)}</span>
        {summary && FILE_TOOLS.has(step.tool) ? (
          // A path gives way from its start, so the file's name stays in sight.
          <PathLine path={summary} className="flex-1 text-[0.6875rem] text-text-soft" />
        ) : (
          <span className={cn('min-w-0 flex-1 truncate text-text-soft', (command || step.tool.startsWith('computer_')) && 'font-mono text-[0.6875rem]')}>
            {summary}
          </span>
        )}
        {total && <Counts change={total} className="text-[0.6875rem]" />}
        {changed?.undo?.done && <span className="caps shrink-0 text-text-soft">Undone</span>}
        <span className="caps shrink-0 text-text-soft tabular-nums">
          {running ? <span className="animate-pulse text-accent">Running</span> : seconds !== undefined ? `${seconds.toFixed(1)} s` : ''}
        </span>
      </button>
      <Opening open={open}>
        <div className="grid grid-cols-1 gap-2.5 pb-3 pl-5">
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
      <Eyebrow>{label}</Eyebrow>
      <pre className="scroll-quiet max-h-72 overflow-auto whitespace-pre-wrap border border-line bg-surface p-2.5 font-mono text-[0.6875rem] text-text-soft leading-relaxed [overflow-wrap:anywhere]">
        {text}
      </pre>
    </div>
  )
}
