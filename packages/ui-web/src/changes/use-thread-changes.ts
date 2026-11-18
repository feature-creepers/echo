import type { Client } from '@repo/client'
import type { AccessUse, FileChange } from '@repo/protocol'
import { useCallback, useEffect, useMemo, useState } from 'react'

/** What a thread's turns changed on the computer: each use that changed files, and each turn's files counted. */
export interface ThreadChanges {
  uses: ReadonlyMap<string, AccessUse>
  turns: ReadonlyMap<string, FileChange[]>
  /** A use as the core gives it back once undone, kept until the next reading. */
  accept(use: AccessUse): void
}

/** The most turns asked about at once, as the command allows. */
const BATCH = 50

/**
 * The changes of the turns given, read from the core, and read again a moment after a use of this thread is decided,
 * done or undone, so the counts fill in as the thread works.
 */
export function useThreadChanges(client: Client, thread: string, turns: readonly string[]): ThreadChanges {
  const [uses, setUses] = useState<ReadonlyMap<string, AccessUse>>(new Map())
  const [files, setFiles] = useState<ReadonlyMap<string, FileChange[]>>(new Map())
  const key = turns.join(',')

  const read = useCallback(
    async (live: () => boolean) => {
      const asked = key === '' ? [] : key.split(',')
      const nextUses = new Map<string, AccessUse>()
      const nextFiles = new Map<string, FileChange[]>()
      for (let at = 0; at < asked.length; at += BATCH) {
        const { turns: read } = await client.session.run('activity.changes', { turns: asked.slice(at, at + BATCH) })
        for (const turn of read) {
          nextFiles.set(turn.turn, turn.files)
          for (const use of turn.uses) nextUses.set(use.id, use)
        }
      }
      if (!live()) return
      setUses(nextUses)
      setFiles(nextFiles)
    },
    [client, key]
  )

  useEffect(() => {
    let live = true
    let timer: number | undefined
    const again = () => void read(() => live).catch(() => undefined)
    again()
    const stop = client.session.onEvent((event) => {
      if (event.name !== 'activity.used' || event.use.thread !== thread) return
      window.clearTimeout(timer)
      timer = window.setTimeout(again, 250)
    })
    return () => {
      live = false
      stop()
      window.clearTimeout(timer)
    }
  }, [client, thread, read])

  const accept = useCallback((use: AccessUse) => setUses((known) => new Map(known).set(use.id, use)), [])
  return useMemo(() => ({ uses, turns: files, accept }), [uses, files, accept])
}
