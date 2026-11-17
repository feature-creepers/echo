import type { MemoryState } from '@repo/client'
import { useFollowed } from '@repo/client/react'
import type { SleepSettings } from '@repo/protocol'
import { type KeyboardEvent, useEffect, useId, useState } from 'react'
import { Orb } from '../presence/orb.tsx'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { Select } from '../primitives/select.tsx'
import { SLEEP_CHOICES, sleepStatus } from './words.ts'

/** The time now, again every half minute, so "last slept 3 minutes ago" stays true while the screen is open. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

const fieldClass =
  'h-7 rounded-md border border-line-strong bg-black/25 px-2.5 text-[0.8125rem] text-text tabular-nums shadow-[inset_0_1px_1px_rgb(0_0_0/0.25)] transition duration-150 ease-soft'

/**
 * Whether the assistant is asleep, the work its sleep is doing, and when it sleeps. The core on the main
 * screen dims while it sleeps; here the same core says it in words.
 */
export function SleepPanel({ memory, sleep }: { memory: MemoryState; sleep: SleepSettings }) {
  const state = useFollowed(memory.assistant)
  const now = useNow()
  const [problem, setProblem] = useState<string>()
  const [asking, setAsking] = useState(false)
  const quietId = useId()
  const timeId = useId()

  const status = sleepStatus(state, sleep, now)
  const working = state.asleep && state.work !== undefined && state.work.total > 0
  const progress = working && state.work ? state.work.done / Math.max(1, state.work.total) : 0
  const usesQuiet = sleep.when === 'quiet' || sleep.when === 'quiet-or-time'
  const usesTime = sleep.when === 'time' || sleep.when === 'quiet-or-time'

  const change = (settings: Partial<SleepSettings>) => {
    setProblem(undefined)
    memory.setSleep(settings).catch(() => setProblem('The setting could not be saved.'))
  }

  const sleepNow = async () => {
    setAsking(true)
    setProblem(undefined)
    try {
      await memory.sleepNow()
    } catch {
      setProblem('It could not fall asleep.')
    } finally {
      setAsking(false)
    }
  }

  return (
    <div
      className={cn('grid gap-5 rounded-lg border bg-surface/85 p-5 transition duration-500 ease-soft', state.asleep ? 'border-line' : 'border-line-strong')}
    >
      <div className="flex items-center gap-5">
        <Orb size={64} mood={state.asleep ? 'asleep' : 'idle'} className={cn('-m-2 shrink-0 transition-opacity duration-700', state.asleep && 'opacity-70')} />
        <div className="grid min-w-0 flex-1 gap-1" aria-live="polite">
          <Eyebrow accent={!state.asleep}>{status.title}</Eyebrow>
          <p className="text-sm text-text-soft leading-relaxed">{status.detail}</p>
        </div>
        <Button onClick={() => void sleepNow()} disabled={sleep.when === 'never' || asking || working} className="shrink-0">
          {working ? 'Sleeping…' : 'Sleep now'}
        </Button>
      </div>

      {working && (
        <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-label="Sleep" aria-valuenow={Math.round(progress * 100)}>
          <div className="h-full rounded-full bg-accent/70 transition-[width] duration-700 ease-soft" style={{ width: `${Math.max(4, progress * 100)}%` }} />
        </div>
      )}

      <div className="grid gap-4 border-line border-t pt-5">
        <div className="flex items-center justify-between gap-6">
          <Eyebrow>When it sleeps</Eyebrow>
          <Select
            label="When it sleeps"
            className="w-60"
            value={sleep.when}
            options={SLEEP_CHOICES.map(({ mode, label, description }) => ({ value: mode, label, description }))}
            onChange={(when) => change({ when })}
          />
        </div>

        {(usesQuiet || usesTime) && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-text-soft">
            {usesQuiet && (
              <span className="flex items-center gap-2.5">
                <label htmlFor={quietId}>After</label>
                <QuietMinutes id={quietId} value={sleep.quietMinutes} onCommit={(quietMinutes) => change({ quietMinutes })} />
                <span>quiet minutes</span>
              </span>
            )}
            {usesTime && (
              <span className="flex items-center gap-2.5">
                <label htmlFor={timeId}>At</label>
                <input
                  id={timeId}
                  type="time"
                  value={sleep.time}
                  onChange={(event) => {
                    if (/^\d{2}:\d{2}$/.test(event.target.value)) change({ time: event.target.value })
                  }}
                  className={cn(fieldClass, 'w-32 [color-scheme:dark]')}
                />
                <span>every day</span>
              </span>
            )}
          </div>
        )}

        {problem && (
          <p role="alert" className="text-danger text-sm">
            {problem}
          </p>
        )}
      </div>
    </div>
  )
}

/** A number of minutes, kept as typed until the field is left or Enter is pressed. */
function QuietMinutes({ id, value, onCommit }: { id: string; value: number; onCommit(minutes: number): void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])

  const commit = () => {
    const minutes = Math.round(Number(draft))
    if (Number.isFinite(minutes) && minutes >= 1 && minutes <= 1440) {
      if (minutes !== value) onCommit(minutes)
    } else {
      setDraft(String(value))
    }
  }
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur()
  }

  return (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      min={1}
      max={1440}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={onKey}
      className={cn(fieldClass, 'w-20 text-center')}
    />
  )
}
