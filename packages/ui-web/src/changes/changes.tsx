import type { Client } from '@repo/client'
import type { FileDiff } from '@repo/protocol'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../primitives/button.tsx'
import { DiffView, type Relative } from './diff-view.tsx'

type Reading = { is: 'reading' } | { is: 'failed' } | { is: 'read'; files: FileDiff[] }

/**
 * The diffs of a use, or of a whole turn, read from the core when shown, and read again when `version` changes:
 * once the change is known to be done, or undone.
 */
export function Changes({ client, of, relative, version }: { client: Client; of: { use: string } | { turn: string }; relative: Relative; version?: string }) {
  const [reading, setReading] = useState<Reading>({ is: 'reading' })
  // Read by what it is and its identifier rather than by `of`, which a parent makes anew at each render.
  const [kind, id] = 'use' in of ? (['use', of.use] as const) : (['turn', of.turn] as const)

  const read = useCallback(
    (live: () => boolean) => {
      client.session.run('activity.diff', kind === 'use' ? { use: id } : { turn: id }).then(
        ({ files }) => live() && setReading({ is: 'read', files }),
        () => live() && setReading({ is: 'failed' })
      )
    },
    [client, kind, id]
  )

  // Read again whenever `version` changes, though the reading does not use it: it says the change moved on.
  useEffect(() => {
    let live = true
    read(() => live)
    return () => {
      live = false
    }
  }, [read, version])

  if (reading.is === 'reading') {
    return (
      <div aria-busy="true" className="grid grid-cols-1 gap-1.5">
        <div className="hatch h-8 animate-pulse text-line" />
        <p className="caps text-text-soft">Reading the changes</p>
      </div>
    )
  }
  if (reading.is === 'failed') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[0.8125rem] text-danger">The changes could not be read.</span>
        <Button
          kind="quiet"
          size="sm"
          onClick={() => {
            setReading({ is: 'reading' })
            read(() => true)
          }}
        >
          Try again
        </Button>
      </div>
    )
  }
  if (reading.files.length === 0) return <p className="text-[0.8125rem] text-text-soft">No file was changed.</p>
  return <DiffView files={reading.files} relative={relative} />
}
