import type { MemoryState } from '@repo/client'
import { useState } from 'react'
import { Button } from '../primitives/button.tsx'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { Select } from '../primitives/select.tsx'
import { retentionChoices, retentionDetail, retentionOf, retentionWarning } from './words.ts'

const LABEL = 'Keep what was said'

/**
 * How long the conversation's words are kept (docs/SPEC.md, section 10.2). A period that erases words at once asks
 * first, as forgetting a fact does: what is erased cannot be had back.
 */
export function RetentionPanel({ memory, days }: { memory: MemoryState; days: number | null }) {
  /** A shorter period, waiting for the person to say the words may go. */
  const [asked, setAsked] = useState<{ days: number | null; warning: string }>()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()

  const set = async (next: number | null) => {
    setBusy(true)
    setProblem(undefined)
    try {
      await memory.setRetention(next)
      setAsked(undefined)
    } catch {
      setProblem('The setting could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const choose = (value: string) => {
    const next = retentionOf(value)
    if (next === days) return setAsked(undefined)
    const warning = retentionWarning(days, next, new Date())
    if (warning) setAsked({ days: next, warning })
    else void set(next)
  }

  const shown = asked ? asked.days : days

  return (
    <div className="grid gap-3 py-4">
      <div className="flex items-center justify-between gap-6">
        <div className="grid min-w-0 gap-1">
          <Eyebrow>{LABEL}</Eyebrow>
          <p className="text-text-soft text-xs leading-relaxed">{retentionDetail(days)}</p>
        </div>
        <Select
          label={LABEL}
          className="w-60 shrink-0"
          value={shown === null ? 'for-good' : String(shown)}
          options={retentionChoices(days)}
          onChange={choose}
          disabled={busy}
        />
      </div>

      {asked && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-danger text-xs leading-relaxed">{asked.warning} What was learned from it stays.</p>
          <Button kind="quiet" size="sm" onClick={() => setAsked(undefined)} disabled={busy}>
            Keep
          </Button>
          <Button kind="secondary" size="sm" className="text-danger" onClick={() => void set(asked.days)} disabled={busy}>
            {busy ? 'Erasing…' : 'Erase'}
          </Button>
        </div>
      )}

      {problem && (
        <p role="alert" className="text-danger text-xs">
          {problem}
        </p>
      )}
    </div>
  )
}
