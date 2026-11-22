import type { Client } from '@repo/client'
import type { KeptCopy } from '@repo/protocol'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../primitives/button.tsx'
import { EmptyRow, SettingGroup } from '../settings/rows.tsx'
import { copyWords, removalWords } from './copy-words.ts'

/** A branch leaving a line of work, drawn as the other marks are. */
const BranchMark = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
    <path d="M4.5 5v6M4.5 11c0-3.5 7-1.5 7-5" />
    <path d="M3 2.5h3V5H3zM3 11h3v2.5H3zM10 3.5h3V6h-3z" />
  </svg>
)

/**
 * The copies of repositories kept in the app's data (docs/SPEC.md, section 7.11), in Settings, Access: each thread's
 * that is there, then the folders no thread names, with the room each takes and what removing it would lose. A copy
 * is removed by itself once nothing in it would be lost; what is kept is listed here, and removed only when the
 * person says so, after being told what goes with it.
 */
export function CopiesGroup({ client, productName }: { client: Client; productName: string }) {
  const [copies, setCopies] = useState<KeptCopy[]>()
  const [asking, setAsking] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()

  const read = useCallback(async () => {
    try {
      setCopies((await client.session.run('copies.read', {})).copies)
    } catch {
      setCopies([])
      setProblem('The copies could not be read.')
    }
  }, [client])

  useEffect(() => {
    void read()
  }, [read])

  const remove = async (copy: KeptCopy) => {
    setProblem(undefined)
    setBusy(true)
    try {
      // What the person was told would be lost is removed with it; anything it holds since is not.
      const outcome = await client.session.run('copy.remove', { folder: copy.folder, anyway: copy.holds !== undefined })
      if (outcome.problem !== undefined) setProblem(outcome.problem)
      else if (!outcome.removed) setProblem(`It was not removed: it now holds ${outcome.holds ?? 'something that would be lost'}.`)
      setAsking(undefined)
      await read()
    } catch {
      setProblem('The copy could not be removed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingGroup title="Copies of projects" note="Removed by themselves once nothing in them would be lost">
      {copies === undefined ? (
        <EmptyRow title="Looking at the copies…" />
      ) : copies.length === 0 ? (
        <EmptyRow
          title="None kept"
          detail={`When two threads work in one git repository at once, ${productName} gives the second a copy of it, on a branch of its own. Copies are listed here for as long as they are kept.`}
        />
      ) : (
        copies.map((copy) => {
          const { title, under } = copyWords(copy)
          return (
            <div key={copy.folder} className="grid gap-2 py-3">
              <div className="flex items-center gap-4">
                <span className="shrink-0 text-text-faint">
                  <BranchMark />
                </span>
                <div className="grid min-w-0 flex-1 gap-0.5" title={copy.folder}>
                  <span className="truncate text-[0.8125rem]">{title}</span>
                  <span className="truncate text-text-faint text-xs">{under}</span>
                  {copy.holds !== undefined && <span className="text-warn text-xs leading-relaxed">Holds {copy.holds}</span>}
                </div>
                {asking !== copy.folder && (
                  <Button kind="quiet" size="sm" disabled={busy} onClick={() => setAsking(copy.folder)}>
                    Remove
                  </Button>
                )}
              </div>
              {asking === copy.folder && (
                <div className="flex flex-wrap items-center gap-3 pl-8">
                  <span className="min-w-48 flex-1 text-text-soft text-xs leading-relaxed">{removalWords(copy)}</span>
                  <Button size="sm" disabled={busy} onClick={() => void remove(copy)}>
                    {busy ? 'Removing…' : 'Remove it'}
                  </Button>
                  <Button kind="quiet" size="sm" disabled={busy} onClick={() => setAsking(undefined)}>
                    Keep it
                  </Button>
                </div>
              )}
            </div>
          )
        })
      )}
      {problem && (
        <p role="alert" className="py-3 text-danger text-xs leading-relaxed">
          {problem}
        </p>
      )}
    </SettingGroup>
  )
}
