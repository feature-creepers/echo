import {
  type CommandInput,
  JOB_REQUEST_MAX_LENGTH,
  JOB_SENTENCE_MAX_LENGTH,
  JOB_TITLE_MAX_LENGTH,
  type Job,
  MAX_EVERY_HOURS,
  MIN_EVERY_HOURS,
  WEEKDAYS,
  type Weekday
} from '@repo/protocol'
import { type KeyboardEvent, type ReactNode, useId, useState } from 'react'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { Select } from '../primitives/select.tsx'
import { SMALL_FIELD, TEXT_AREA } from '../settings/field.ts'
import { formOf, localNow, OFTEN, type Often, type TimingForm, timingOf } from './timing-form.ts'

/** The days of the week, as the buttons that pick them say them. */
const DAY_NAMES: Record<Weekday, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun'
}

const EVERY = Array.from({ length: MAX_EVERY_HOURS - MIN_EVERY_HOURS + 1 }, (_, index) => {
  const hours = MIN_EVERY_HOURS + index
  return { value: String(hours), label: hours === 1 ? 'Every hour' : `Every ${hours} hours` }
})

interface JobEditorProps {
  job: Job
  /** The zone the jobs ring in: a single time is to come on its clock. */
  zone: string
  now: Date
  /** Save what changed. Rejects with why not, in words for the person. */
  onSave(change: Omit<CommandInput<'schedule.change'>, 'job'>): Promise<void>
  onDone(): void
}

/**
 * A job opened in place on the Reminders page (docs/SPEC.md, section 7.10): its title, what it says or does, and when
 * it rings. Only what changed is saved; a new timing counts from now. A job on files or mail keeps its folder or its
 * account here: it is
 * changed by asking. Escape leaves it as it was.
 */
export function JobEditor({ job, zone, now, onSave, onDone }: JobEditorProps) {
  const reminder = job.kind === 'reminder'
  const words = (reminder ? job.sentence : job.request) ?? ''
  const timed = job.timing.kind === 'files' || job.timing.kind === 'mail' ? undefined : job.timing
  const [title, setTitle] = useState(job.title)
  const [said, setSaid] = useState(words)
  const [form, setForm] = useState<TimingForm | undefined>(() => (timed ? formOf(timed, localNow(now, zone).slice(0, 10)) : undefined))
  const [problem, setProblem] = useState<string>()
  const [busy, setBusy] = useState(false)
  const ids = { title: useId(), said: useId() }

  const save = async () => {
    setProblem(undefined)
    if (title.trim() === '' || said.trim() === '') return setProblem(reminder ? 'Give it a title and what it says.' : 'Give it a title and what it does.')
    const timing = form ? timingOf(form, localNow(new Date(), zone)) : undefined
    if (timing && !timing.ok) return setProblem(timing.problem)
    const change = {
      ...(title.trim() === job.title ? {} : { title: title.trim() }),
      ...(said.trim() === words ? {} : reminder ? { sentence: said.trim() } : { request: said.trim() }),
      ...(timing?.ok && JSON.stringify(timing.timing) !== JSON.stringify(job.timing) ? { timing: timing.timing } : {})
    }
    if (Object.keys(change).length === 0) return onDone()
    setBusy(true)
    try {
      await onSave(change)
      onDone()
    } catch (error) {
      setProblem(error instanceof Error && error.message !== '' ? error.message : 'It could not be changed.')
    } finally {
      setBusy(false)
    }
  }

  // Escape leaves the edit, and goes no further: on the settings it would also close them.
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    onDone()
  }
  const set = (change: Partial<TimingForm>) => setForm((current) => (current ? { ...current, ...change } : current))

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape anywhere in the editor leaves it, as in a dialog
    <div className="grid gap-4" onKeyDown={keys}>
      <div className="grid gap-1.5">
        <label htmlFor={ids.title}>
          <Eyebrow>Title</Eyebrow>
        </label>
        <input
          id={ids.title}
          value={title}
          maxLength={JOB_TITLE_MAX_LENGTH}
          // biome-ignore lint/a11y/noAutofocus: the job the person just asked to edit
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
          className={cn(SMALL_FIELD, 'h-8 w-full px-3')}
        />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={ids.said}>
          <Eyebrow>{reminder ? 'It says' : 'It does'}</Eyebrow>
        </label>
        <textarea
          id={ids.said}
          value={said}
          rows={2}
          maxLength={reminder ? JOB_SENTENCE_MAX_LENGTH : JOB_REQUEST_MAX_LENGTH}
          onChange={(event) => setSaid(event.target.value)}
          className={TEXT_AREA}
        />
      </div>

      {form ? (
        <div className="grid gap-2">
          <Eyebrow>When</Eyebrow>
          <div className="flex flex-wrap items-center gap-2.5 text-text-soft text-xs">
            <Select label="How often" className="w-40" value={form.often} options={OFTEN} onChange={(often: Often) => set({ often })} />
            <When form={form} set={set} />
          </div>
        </div>
      ) : (
        <p className="text-text-faint text-xs">It rings when a file arrives: to watch another folder, ask for it.</p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-line border-t pt-3">
        <span role="alert" className="min-w-0 flex-1 text-danger text-xs">
          {problem}
        </span>
        <Button kind="quiet" size="sm" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button kind="primary" size="sm" onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

/** The fields of the timing its kind uses, beside how often. */
function When({ form, set }: { form: TimingForm; set(change: Partial<TimingForm>): void }) {
  const time = (label: string, field: 'time' | 'from' | 'until') => (
    <Labelled label={label}>
      <input
        type="time"
        aria-label={label}
        value={form[field]}
        onChange={(event) => set({ [field]: event.target.value })}
        className={cn(SMALL_FIELD, 'w-28')}
      />
    </Labelled>
  )
  switch (form.often) {
    case 'once':
      return (
        <>
          <Labelled label="On">
            <input type="date" aria-label="On" value={form.date} onChange={(event) => set({ date: event.target.value })} className={cn(SMALL_FIELD, 'w-36')} />
          </Labelled>
          {time('at', 'time')}
        </>
      )
    case 'daily':
    case 'weekdays':
      return time('at', 'time')
    case 'weekly':
      return (
        <>
          <fieldset className="flex flex-wrap gap-1" aria-label="On">
            {WEEKDAYS.map((day) => {
              const on = form.days.includes(day)
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ days: on ? form.days.filter((one) => one !== day) : [...form.days, day] })}
                  className={cn(
                    'caps h-7 px-2 transition-colors duration-(--duration-quick) ease-soft',
                    on ? 'bg-text text-ground' : 'text-text-soft shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-text/[0.08] hover:text-text'
                  )}
                >
                  {DAY_NAMES[day]}
                </button>
              )
            })}
          </fieldset>
          {time('at', 'time')}
        </>
      )
    case 'monthly':
      return (
        <>
          <Labelled label="On the">
            <input
              type="number"
              aria-label="Day of the month"
              min={1}
              max={31}
              value={form.day}
              onChange={(event) => set({ day: Number(event.target.value) })}
              className={cn(SMALL_FIELD, 'w-16')}
            />
          </Labelled>
          {time('at', 'time')}
        </>
      )
    case 'hourly':
      return (
        <>
          <Select
            label="How many hours apart"
            className="w-36"
            value={String(form.every)}
            options={EVERY}
            onChange={(every) => set({ every: Number(every) })}
          />
          {time('from', 'from')}
          {time('to', 'until')}
        </>
      )
  }
}

/** A field with a word before it, as a sentence reads: "at 08:00", "from 09:00". */
function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden>{label}</span>
      {children}
    </span>
  )
}
