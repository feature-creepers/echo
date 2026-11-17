import { FACT_KIND_TITLES } from '@repo/client'
import { FACT_KINDS, FACT_MAX_LENGTH, type Fact, type FactKind } from '@repo/protocol'
import { type KeyboardEvent, useState } from 'react'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { learnedFrom } from './words.ts'

export interface FactRowProps {
  fact: Fact
  onEdit(text: string, kind: FactKind): Promise<void>
  onForget(): Promise<void>
}

type Mode = { is: 'reading' } | { is: 'editing'; text: string; kind: FactKind } | { is: 'forgetting' }

/**
 * One thing the assistant knows: what it says, where and when it was learned, and the user's way to correct
 * it or have it forgotten. Forgetting asks once, since the words are erased for good.
 */
export function FactRow({ fact, onEdit, onForget }: FactRowProps) {
  const [mode, setMode] = useState<Mode>({ is: 'reading' })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()
  const source = fact.sources.find((candidate) => candidate.said !== undefined)

  const act = async (work: () => Promise<void>, failure: string) => {
    setBusy(true)
    setProblem(undefined)
    try {
      await work()
      setMode({ is: 'reading' })
    } catch {
      setProblem(failure)
    } finally {
      setBusy(false)
    }
  }

  // Escape leaves the edit, and goes no further: in settings it would also close the screen.
  const keys = (event: KeyboardEvent<HTMLElement>, save?: () => void) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      setMode({ is: 'reading' })
    } else if (event.key === 'Enter' && !event.shiftKey && save) {
      event.preventDefault()
      save()
    }
  }

  if (mode.is === 'editing') {
    const text = mode.text.trim()
    const save = () => {
      if (text !== '') void act(() => onEdit(text, mode.kind), 'The correction could not be saved.')
    }
    return (
      <li className="grid gap-3 rounded-md border border-accent/45 bg-surface px-4 py-3.5">
        <textarea
          aria-label="What it knows"
          value={mode.text}
          maxLength={FACT_MAX_LENGTH}
          rows={2}
          // biome-ignore lint/a11y/noAutofocus: the field the user just asked to edit
          autoFocus
          onChange={(event) => setMode({ ...mode, text: event.target.value })}
          onKeyDown={(event) => keys(event, save)}
          className="w-full resize-none rounded-sm bg-transparent text-sm text-text leading-relaxed outline-none"
        />
        <div className="flex flex-wrap items-center gap-2 border-line border-t pt-3">
          <select
            aria-label="Kind"
            value={mode.kind}
            onChange={(event) => setMode({ ...mode, kind: event.target.value as FactKind })}
            onKeyDown={(event) => keys(event)}
            className="h-7 rounded-sm border border-line-strong bg-black/25 shadow-[inset_0_1px_1px_rgb(0_0_0/0.25)] px-2 text-text-soft text-xs outline-none"
          >
            {FACT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {FACT_KIND_TITLES[kind]}
              </option>
            ))}
          </select>
          <span className="flex-1" />
          {problem && <span className="text-danger text-xs">{problem}</span>}
          <Button kind="quiet" size="sm" onClick={() => setMode({ is: 'reading' })} disabled={busy}>
            Cancel
          </Button>
          <Button kind="primary" size="sm" onClick={save} disabled={busy || text === ''}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </li>
    )
  }

  return (
    <li
      className={cn(
        'group flex items-start gap-4 rounded-md border bg-surface/80 px-4 py-3.5 transition duration-150 ease-soft',
        mode.is === 'forgetting' ? 'border-danger/40' : 'border-line hover:border-line-strong'
      )}
    >
      <div className="grid min-w-0 flex-1 gap-1.5">
        <p className={cn('text-sm leading-relaxed transition', mode.is === 'forgetting' && 'text-text-soft line-through decoration-danger/60')}>{fact.text}</p>
        <p className="flex min-w-0 items-baseline gap-2 text-text-faint text-xs">
          <span className="shrink-0">{learnedFrom(fact)}</span>
          {source?.said && (
            <span className="truncate" title={source.said}>
              · “{source.said}”
            </span>
          )}
        </p>
        {problem && <p className="text-danger text-xs">{problem}</p>}
      </div>
      {mode.is === 'forgetting' ? (
        <div className="flex shrink-0 items-center gap-1">
          <span className="mr-1 text-text-soft text-xs">Forget for good?</span>
          <Button kind="quiet" size="sm" onClick={() => setMode({ is: 'reading' })} disabled={busy} onKeyDown={(event) => keys(event)}>
            Keep
          </Button>
          <Button
            kind="secondary"
            size="sm"
            className="border-danger/50 text-danger hover:not-disabled:border-danger"
            onClick={() => void act(onForget, 'It could not be forgotten.')}
            disabled={busy}
          >
            {busy ? 'Forgetting…' : 'Forget'}
          </Button>
        </div>
      ) : (
        <div className="flex shrink-0 gap-1 opacity-0 transition duration-150 ease-soft focus-within:opacity-100 group-hover:opacity-100">
          <Button kind="quiet" size="sm" onClick={() => setMode({ is: 'editing', text: fact.text, kind: fact.kind })}>
            Edit
          </Button>
          <Button kind="quiet" size="sm" className="hover:not-disabled:text-danger" onClick={() => setMode({ is: 'forgetting' })}>
            Forget
          </Button>
        </div>
      )}
    </li>
  )
}
