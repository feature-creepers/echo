import type { AccessUse } from '@repo/protocol'
import { useState } from 'react'
import { Button } from '../primitives/button.tsx'

/** Undo a use: `changed` when the file changed since and nothing was done; asked again with `anyway`, it is. */
export type Undo = (use: string, anyway: boolean) => Promise<'done' | 'changed' | 'gone'>

type Undoing = { is: 'idle' } | { is: 'busy' } | { is: 'changed' } | { is: 'failed'; reason: string }

const timeOf = (at: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(at))

/**
 * What can be undone of a change to files, and the button that does it: the previous version put back, or a file
 * the assistant created moved to the trash. A file changed since is said, and asked about once.
 */
export function UndoAction({ use, undo }: { use: AccessUse; undo: Undo }) {
  const [undoing, setUndoing] = useState<Undoing>({ is: 'idle' })
  if (!use.undo) return null
  if (use.undo.done) {
    return (
      <p className="text-accent text-xs">
        {use.undo.kind === 'restore' ? 'The previous version was put back' : 'Moved to the trash'} at {timeOf(use.undo.done)}.
      </p>
    )
  }

  const act = async (anyway: boolean) => {
    setUndoing({ is: 'busy' })
    try {
      const outcome = await undo(use.id, anyway)
      setUndoing(
        outcome === 'changed'
          ? { is: 'changed' }
          : outcome === 'gone'
            ? { is: 'failed', reason: 'There is nothing left to put back: the version kept, or the file, is gone.' }
            : { is: 'idle' }
      )
    } catch {
      setUndoing({ is: 'failed', reason: 'It could not be undone.' })
    }
  }

  const restore = use.undo.kind === 'restore'
  if (undoing.is === 'changed') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-warn text-xs">
          {use.paths.length > 1 ? 'These files' : 'The file'} changed since.{' '}
          {restore ? 'Put the previous version back anyway?' : 'Move it to the trash anyway?'}
        </span>
        <Button kind="quiet" size="sm" onClick={() => setUndoing({ is: 'idle' })}>
          Keep it
        </Button>
        <Button size="sm" onClick={() => void act(true)}>
          {restore ? 'Restore anyway' : 'Move anyway'}
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" disabled={undoing.is === 'busy'} onClick={() => void act(false)}>
        {undoing.is === 'busy' ? 'Working…' : restore ? 'Restore the previous version' : 'Move to trash'}
      </Button>
      {undoing.is === 'failed' && <span className="text-danger text-xs">{undoing.reason}</span>}
      {undoing.is !== 'failed' && !restore && <span className="text-text-faint text-xs">To the trash in the app’s data folder, to take back from there.</span>}
    </div>
  )
}
