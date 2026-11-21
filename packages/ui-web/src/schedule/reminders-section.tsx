import { type Client, followSchedule, type ScheduleState } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import { type CommandInput, type Job, lastName, type QuietHours, type ScheduleView } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useId, useState } from 'react'
import { useDevice } from '../device/device.tsx'
import { useNow } from '../hub/use-now.ts'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { IconButton } from '../primitives/icon-button.tsx'
import { ChevronGlyph, EditGlyph, TrashGlyph } from '../primitives/icons.tsx'
import { Switch } from '../primitives/switch.tsx'
import { SMALL_FIELD } from '../settings/field.ts'
import { EmptyPlane, SettingGroup, SettingRow } from '../settings/rows.tsx'
import { glide, settle } from '../styles/motion.ts'
import { JobEditor } from './job-editor.tsx'
import { clockWords, dayOf, howOften, KIND_WORDS, timeOf, whatItDoes, whenPast } from './words.ts'

/** The schedule, followed for as long as the page is open. */
function useSchedule(client: Client): ScheduleState | undefined {
  const [state, setState] = useState<ScheduleState>()
  useEffect(() => {
    const followed = followSchedule(client.session)
    setState(followed)
    return () => followed.unfollow()
  }, [client])
  return state
}

/**
 * The Reminders page (docs/SPEC.md, section 7.10): what the person asked the assistant to do later, the next to
 * ring first, each to edit, pause or delete; the past ones folded under them; the quiet hours; and what it takes for a
 * reminder to ring while the window is closed. It follows the core, so a reminder set by voice appears at once.
 */
export function RemindersSection({ client, productName }: { client: Client; productName: string }) {
  const state = useSchedule(client)
  return state ? <Schedule state={state} productName={productName} /> : <Reading />
}

function Reading() {
  return <p className="caps text-text-faint">Reading your reminders…</p>
}

function Schedule({ state, productName }: { state: ScheduleState; productName: string }) {
  const view = useFollowed(state)
  const unread = useFollowed(state.unread)
  const now = useNow()
  const [problem, setProblem] = useState<string>()

  if (unread) return <p className="text-danger text-xs">The reminders could not be read. Close the settings and open them again.</p>
  if (!view) return <Reading />

  /** Carry out a change, and say so when the core refuses it. */
  const act = (change: Promise<void>, failure: string) => {
    setProblem(undefined)
    change.catch(() => setProblem(failure))
  }
  const waiting = view.jobs.filter((job) => job.state === 'active' || job.state === 'paused')
  const past = view.jobs.filter((job) => job.state === 'done' || job.state === 'missed')

  return (
    <div className="grid gap-10">
      {view.held && <Held onResume={() => act(state.hold(false), 'They could not be resumed.')} />}

      <section aria-label="Coming up" className="grid gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <Eyebrow>Coming up</Eyebrow>
          <span className="caps text-right text-text-faint">
            {waiting.length > 0 && `${waiting.length} set · `}times in {view.timeZone.replaceAll('_', ' ')}
          </span>
        </div>
        {problem && (
          <p role="alert" className="text-danger text-xs">
            {problem}
          </p>
        )}
        {waiting.length === 0 ? (
          <Empty productName={productName} />
        ) : (
          <ul className="divide-y divide-line border-text border-t-2">
            <AnimatePresence initial={false}>
              {waiting.map((job) => (
                <Row key={job.id}>
                  <Waiting
                    job={job}
                    view={view}
                    now={now}
                    held={view.held}
                    onPause={(paused) => act(state.pause(job.id, paused), 'It could not be changed.')}
                    onDelete={() => act(state.remove([job.id]), 'It could not be deleted.')}
                    onChange={(change) => state.change({ job: job.id, ...change })}
                  />
                </Row>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </section>

      {past.length > 0 && <Past jobs={past} view={view} now={now} onDelete={(jobs) => act(state.remove(jobs), 'They could not be deleted.')} />}

      <QuietPanel quiet={view.quiet} onChange={(quiet) => act(state.setQuiet(quiet), 'The quiet hours could not be saved.')} />

      <WhileClosed productName={productName} />
    </div>
  )
}

/** A row of a list, which fades in and out in place and lets the others take their new places on a spring. */
function Row({ children }: { children: ReactNode }) {
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: settle }}
      transition={{ layout: glide, opacity: settle }}
      className="py-3"
    >
      {children}
    </motion.li>
  )
}

/** The clock time a job shows when it has no next time: the one it is set for. Nothing for a job on files or mail, which has none. */
const setFor = (job: Job) => {
  const { timing } = job
  if (timing.kind === 'files' || timing.kind === 'mail') return undefined
  if (timing.kind === 'once') return timing.at.slice(11, 16)
  return timing.kind === 'hourly' ? timing.from : timing.time
}

/** What a job shows where its time goes: its next time, the time it is set for, or for a job on files or mail, what it watches. */
function whenShown(job: Job, view: ScheduleView, now: Date): { top: string; under: string } {
  const paused = job.state === 'paused'
  if (job.timing.kind === 'files') return { top: lastName(job.timing.folder), under: paused ? 'Paused' : 'Watching' }
  if (job.timing.kind === 'mail') return { top: 'Mail', under: paused ? 'Paused' : 'Watching' }
  const set = setFor(job)
  return {
    top: job.next ? timeOf(job.next, view.timeZone) : set === undefined ? '—' : clockWords(set),
    under: paused ? 'Paused' : job.next ? dayOf(job.next, now, view.timeZone) : '—'
  }
}

interface WaitingProps {
  job: Job
  view: ScheduleView
  now: Date
  /** Everything is paused at once: each job keeps its own switch, but nothing rings. */
  held: boolean
  onPause(paused: boolean): void
  onDelete(): void
  /** Change its words or timing. Rejects with why not, in words for the person. */
  onChange(change: Omit<CommandInput<'schedule.change'>, 'job'>): Promise<void>
}

/**
 * A job still to ring: when, what, how often, and its switch. A paused one is dimmed, its switch off. Its pencil
 * opens it in place, to change its words or its timing.
 */
function Waiting({ job, view, now, held, onPause, onDelete, onChange }: WaitingProps) {
  const [editing, setEditing] = useState(false)
  const paused = job.state === 'paused'
  const words = whatItDoes(job)
  const when = whenShown(job, view, now)
  if (editing) return <JobEditor job={job} zone={view.timeZone} now={now} onSave={onChange} onDone={() => setEditing(false)} />
  return (
    <div className="flex items-start gap-4">
      <div className={cn('grid w-24 shrink-0 gap-0.5 pt-px transition-opacity duration-(--duration-calm) ease-soft', (paused || held) && 'opacity-45')}>
        <span className="display truncate text-[1.5rem] text-text leading-5" title={when.top}>
          {when.top}
        </span>
        <span className="caps text-text-faint">{when.under}</span>
      </div>

      <div className={cn('grid min-w-0 flex-1 gap-1 transition-opacity duration-(--duration-calm) ease-soft', paused && 'opacity-55')}>
        <span className="truncate text-[0.8125rem] text-text">{job.title}</span>
        <span className="flex min-w-0 items-baseline gap-2 text-text-soft text-xs">
          <span className="caps shrink-0 text-text-soft">{KIND_WORDS[job.kind]}</span>
          <span className="truncate">{howOften(job.timing)}</span>
        </span>
        {words && <span className="line-clamp-2 text-text-faint text-xs leading-relaxed">{job.kind === 'reminder' ? `“${words}”` : words}</span>}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
        <Switch label={`${job.title}: ${paused ? 'paused' : 'on'}`} on={!paused} onChange={(on) => onPause(!on)} />
        <IconButton label={`Edit “${job.title}”`} onClick={() => setEditing(true)}>
          <EditGlyph />
        </IconButton>
        <IconButton label={`Delete “${job.title}”`} onClick={onDelete}>
          <TrashGlyph />
        </IconButton>
      </div>
    </div>
  )
}

/** Nothing set yet: what the page is for, and the words that set a reminder. */
function Empty({ productName }: { productName: string }) {
  return (
    <EmptyPlane>
      <p className="caps text-text">Nothing is set</p>
      <p>Just say “remind me at 8 to feed the cat”, or “every weekday at 7:30, tell me the weather in Lyon”. {productName} says it, or does it, at its time.</p>
    </EmptyPlane>
  )
}

/** Everything was paused at once ("stop everything"): nothing rings until it is resumed. */
function Held({ onResume }: { onResume(): void }) {
  return (
    <div role="status" className="flex items-center gap-4 border-warn border-t-2 py-3">
      <span className="size-2 shrink-0 bg-warn" aria-hidden />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-[0.8125rem] text-text">Everything is paused</span>
        <span className="text-text-faint text-xs leading-relaxed">
          Nothing rings until you resume. A reminder due meanwhile then rings late, and the others carry on from their next time.
        </span>
      </div>
      <Button kind="primary" onClick={onResume} className="shrink-0">
        Resume
      </Button>
    </div>
  )
}

/** The jobs that rang or were missed, folded under the ones to come. */
function Past({ jobs, view, now, onDelete }: { jobs: Job[]; view: ScheduleView; now: Date; onDelete(jobs: string[]): void }) {
  const [open, setOpen] = useState(false)
  const missed = jobs.filter((job) => job.state === 'missed').length
  const list = useId()
  return (
    <section aria-label="Past and missed" className="grid gap-2">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={list}
          onClick={() => setOpen(!open)}
          className="-ml-1 flex items-center gap-1 px-1 py-0.5 text-text-soft transition-colors duration-(--duration-quick) ease-soft hover:text-text"
        >
          <span className={cn('transition-transform duration-(--duration-calm) ease-soft', !open && '-rotate-90')}>
            <ChevronGlyph />
          </span>
          <Eyebrow className="text-inherit">Past and missed</Eyebrow>
          <span className="caps text-text-faint">{jobs.length}</span>
          {missed > 0 && <span className="caps text-warn">· {missed} missed</span>}
        </button>
        {open && (
          <Button kind="quiet" size="sm" onClick={() => onDelete(jobs.map((job) => job.id))}>
            Clear all
          </Button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            id={list}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={settle}
            className="divide-y divide-line border-text border-t-2"
          >
            <AnimatePresence initial={false}>
              {jobs.map((job) => (
                <Row key={job.id}>
                  <div className="flex items-center gap-4">
                    <span className="caps w-24 shrink-0 text-text-faint">{whenPast(job, now, view.timeZone)}</span>
                    <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-text-soft">{job.title}</span>
                    <span className={cn('caps shrink-0', job.state === 'missed' ? 'text-warn' : 'text-text-faint')}>
                      {job.state === 'missed' ? 'Missed' : 'Rang'}
                    </span>
                    <IconButton label={`Delete “${job.title}”`} onClick={() => onDelete([job.id])}>
                      <TrashGlyph />
                    </IconButton>
                  </div>
                </Row>
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
      </AnimatePresence>
    </section>
  )
}

const timeField = cn(SMALL_FIELD, 'w-28')

/** The quiet hours: on or off, and from when to when. */
function QuietPanel({ quiet, onChange }: { quiet: QuietHours; onChange(quiet: Partial<QuietHours>): void }) {
  const from = useId()
  const until = useId()
  const time = (field: 'from' | 'until') => (event: { target: { value: string } }) => {
    if (/^\d{2}:\d{2}$/.test(event.target.value) && event.target.value !== quiet[field]) onChange({ [field]: event.target.value })
  }
  return (
    <SettingGroup title="Quiet hours">
      <SettingRow title="Keep quiet at night" detail="A reminder only shows a silent notification, and the answer to a task is shown without being said aloud.">
        <Switch label="Keep quiet at night" on={quiet.on} onChange={(on) => onChange({ on })} />
      </SettingRow>
      {quiet.on && (
        <SettingRow title="Hours" detail="Every day, on your clock. Hours that pass midnight carry on the next morning.">
          <span className="flex items-center gap-2.5 text-[0.8125rem] text-text-soft">
            <label htmlFor={from} className="sr-only">
              From
            </label>
            <input id={from} type="time" value={quiet.from} onChange={time('from')} className={timeField} />
            <span aria-hidden>to</span>
            <label htmlFor={until} className="sr-only">
              Until
            </label>
            <input id={until} type="time" value={quiet.until} onChange={time('until')} className={timeField} />
          </span>
        </SettingRow>
      )}
    </SettingGroup>
  )
}

/**
 * Reminders ring only while the app runs. Closing the window leaves it in the tray, and it can open at login, out of
 * sight: the same two settings as General, here where they matter.
 */
function WhileClosed({ productName }: { productName: string }) {
  const { settings, change, host } = useDevice()
  if (!host) return null
  const { closeToTray, launchAtLogin } = settings.app
  return (
    <SettingGroup title="While the window is closed" note={closeToTray && launchAtLogin ? undefined : 'Reminders ring while the app is running'}>
      <SettingRow
        title="Keep running in the tray"
        detail={`Closing the window leaves ${productName} in the tray, where reminders still ring. Off, closing the window quits, and nothing rings until it is opened again.`}
      >
        <Switch label="Keep running in the tray" on={closeToTray} onChange={(on) => change({ app: { closeToTray: on } })} />
      </SettingRow>
      <SettingRow
        title="Open at login"
        detail={`${productName} starts out of sight when you sign in, so reminders ring after the computer restarts. One missed while it was off rings late, within twelve hours.`}
      >
        <Switch label="Open at login" on={launchAtLogin} onChange={(on) => change({ app: { launchAtLogin: on } })} />
      </SettingRow>
    </SettingGroup>
  )
}
