import type { MemoryState } from '@repo/client'
import type { Meaning } from '@repo/protocol'
import { useState } from 'react'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'
import { aboutModel, meaningDetail } from './words.ts'

const LABEL = 'Search by meaning'

/**
 * Search by meaning (docs/SPEC.md, section 10.7): what it does and the model it needs, downloaded only when the person
 * presses Download, its progress with Cancel, how much of the memory it can find once ready, and Remove, which asks
 * once since every vector goes with the model. Where it cannot run, the core's reason.
 */
export function MeaningPanel({ memory, meaning }: { memory: MemoryState; meaning: Meaning }) {
  const [busy, setBusy] = useState(false)
  const [asked, setAsked] = useState(false)
  const [problem, setProblem] = useState<string>()

  const act = async (work: () => Promise<void>, failure: string) => {
    setBusy(true)
    setProblem(undefined)
    try {
      await work()
      setAsked(false)
    } catch {
      setProblem(failure)
    } finally {
      setBusy(false)
    }
  }

  const progress = meaning.state === 'downloading' ? meaning.received / Math.max(1, meaning.total) : 0
  const failed = problem ?? (meaning.state === 'absent' ? meaning.failed : undefined)

  return (
    <div
      className={cn('grid gap-3 border bg-raised/95 p-5 transition duration-(--duration-quick) ease-soft', asked ? 'border-danger/40' : 'border-line-strong')}
    >
      <div className="flex items-center justify-between gap-6">
        <div className="grid min-w-0 gap-1" aria-live="polite">
          <Eyebrow>{LABEL}</Eyebrow>
          <p className={cn('text-sm leading-relaxed', meaning.state === 'unavailable' ? 'text-text-faint' : 'text-text-soft')}>{meaningDetail(meaning)}</p>
          <p className="text-text-faint text-xs">{aboutModel(meaning)}</p>
        </div>
        {meaning.state === 'absent' && (
          <Button
            kind="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => void act(memory.installMeaning, 'The download could not be started.')}
            disabled={busy}
          >
            {busy ? 'Starting…' : 'Download'}
          </Button>
        )}
        {meaning.state === 'downloading' && (
          <Button
            kind="quiet"
            size="sm"
            className="shrink-0"
            onClick={() => void act(memory.cancelMeaning, 'The download could not be stopped.')}
            disabled={busy}
          >
            Cancel
          </Button>
        )}
        {meaning.state === 'ready' && !asked && (
          <Button kind="quiet" size="sm" className="shrink-0" onClick={() => setAsked(true)} disabled={busy}>
            Remove
          </Button>
        )}
      </div>

      {meaning.state === 'downloading' && (
        <div role="progressbar" aria-label={LABEL} aria-valuenow={Math.round(progress * 100)} className="h-1 overflow-hidden bg-text/[0.06]">
          <div
            className="h-full origin-left bg-accent transition-transform duration-(--duration-calm) ease-soft"
            style={{ transform: `scaleX(${progress})` }}
          />
        </div>
      )}

      {asked && meaning.state === 'ready' && (
        <div className="flex flex-wrap items-center gap-2 border-line border-t pt-3">
          <p className="min-w-0 flex-1 text-text-soft text-xs leading-relaxed">
            The model and every vector made with it are deleted. Search goes on by keyword.
          </p>
          <Button kind="quiet" size="sm" onClick={() => setAsked(false)} disabled={busy}>
            Keep
          </Button>
          <Button
            kind="secondary"
            size="sm"
            className="border-danger/50 text-danger hover:not-disabled:border-danger"
            onClick={() => void act(memory.removeMeaning, 'The model could not be removed.')}
            disabled={busy}
          >
            {busy ? 'Removing…' : 'Remove'}
          </Button>
        </div>
      )}

      {failed && (
        <p role="alert" className="text-danger text-xs leading-relaxed">
          {failed}
        </p>
      )}
    </div>
  )
}
