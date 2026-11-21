import type { Client } from '@repo/client'
import type { FileVersion } from '@repo/protocol'
import { useEffect, useState } from 'react'
import { Changes } from '../changes/changes.tsx'
import { Counts } from '../changes/diff-view.tsx'
import { lastPart } from '../changes/words.ts'
import { Button } from '../primitives/button.tsx'
import { modifiedWords, versionWords } from './words.ts'

type Reading = { is: 'reading' } | { is: 'failed' } | { is: 'read'; versions: FileVersion[] }

/** A version, as one row of the list knows it. */
const keyOf = (version: FileVersion) => `${version.use}:${version.side}`

/**
 * The versions the core kept of a file (docs/SPEC.md, section 9.7): what each change left, the latest first, and
 * the file as it was before the first. Each opens on what its change did, and can be put back; putting one back is a
 * change of its own, so it shows here in turn. Read again when the file changes.
 */
export function Versions({ client, location, modified }: { client: Client; location: string; modified: string }) {
  const [reading, setReading] = useState<Reading>({ is: 'reading' })
  const [open, setOpen] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [problem, setProblem] = useState<string>()
  // Counts the person's tries after a failed reading, each of which reads again.
  const [attempt, setAttempt] = useState(0)

  // Read again whenever the file changes, though the reading does not use when: what is kept may have moved on.
  useEffect(() => {
    let live = true
    client.session.run('activity.versions', { path: location }).then(
      ({ versions }) => live && setReading({ is: 'read', versions }),
      () => live && setReading({ is: 'failed' })
    )
    return () => {
      live = false
    }
  }, [client, location, modified, attempt])

  const putBack = async (version: FileVersion) => {
    setBusy(keyOf(version))
    setProblem(undefined)
    try {
      const done = await client.session.run('activity.restore', { use: version.use, path: location, side: version.side })
      setReading({ is: 'read', versions: done.versions })
      if (done.outcome === 'gone') setProblem('That version is no longer kept.')
    } catch {
      setProblem('It could not be put back.')
    } finally {
      setBusy(undefined)
    }
  }

  if (reading.is === 'reading') {
    return (
      <div aria-busy="true" className="grid content-start gap-1.5 p-4">
        <div className="h-11 animate-pulse bg-text/[0.035]" />
        <div className="h-11 animate-pulse bg-text/[0.025]" />
        <p className="text-[0.6875rem] text-text-faint">Reading its versions…</p>
      </div>
    )
  }
  if (reading.is === 'failed') {
    return (
      <div className="flex flex-wrap items-center gap-2 p-4">
        <span className="text-danger text-xs">Its versions could not be read.</span>
        <Button
          kind="quiet"
          size="sm"
          onClick={() => {
            setReading({ is: 'reading' })
            setAttempt((count) => count + 1)
          }}
        >
          Try again
        </Button>
      </div>
    )
  }
  if (reading.versions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 px-10 text-center">
        <span className="text-sm text-text-soft">No earlier versions</span>
        <span className="max-w-xs text-text-faint text-xs">When the assistant changes a file, it keeps the versions before and after, for 30 days.</span>
      </div>
    )
  }

  return (
    <div className="grid min-h-0 content-start gap-2 overflow-y-auto p-4">
      {problem && <p className="text-danger text-xs">{problem}</p>}
      <ol className="grid gap-1.5">
        {reading.versions.map((version) => {
          const key = keyOf(version)
          const shown = open === key
          return (
            <li key={key} className="grid gap-2 border border-line px-3 py-2">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid min-w-0 flex-1">
                  <span className="truncate text-[0.8125rem]">{versionWords(version)}</span>
                  <span className="flex min-w-0 items-center gap-2 text-[0.6875rem] text-text-faint">
                    <span className="truncate">{modifiedWords(version.at)}</span>
                    {version.change && <Counts change={version.change} />}
                  </span>
                </div>
                {version.side === 'after' && (
                  <Button size="sm" kind="quiet" aria-expanded={shown} onClick={() => setOpen(shown ? undefined : key)}>
                    {shown ? 'Hide changes' : 'Show changes'}
                  </Button>
                )}
                {version.restorable && (
                  <Button size="sm" kind="quiet" disabled={busy !== undefined} onClick={() => void putBack(version)}>
                    {busy === key ? 'Putting back…' : 'Put back'}
                  </Button>
                )}
              </div>
              {shown && <Changes client={client} of={{ use: version.use }} relative={lastPart} />}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
