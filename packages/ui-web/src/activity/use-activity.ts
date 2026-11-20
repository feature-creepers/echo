import type { Client } from '@repo/client'
import type { AccessUse } from '@repo/protocol'
import { useCallback, useEffect, useState } from 'react'

/** How many uses are read at a time. */
const PAGE = 200

interface ActivityState {
  /** The uses read so far, the latest first. Nothing while the first page is read. */
  uses: AccessUse[] | undefined
  /** Earlier uses are kept than those read. */
  more: boolean
  problem: string | undefined
  /** Read the next page, older. */
  earlier(): Promise<void>
  /** Undo a use. `changed` when the file changed since and nothing was done; asked again with `anyway`, it is. */
  undo(use: string, anyway?: boolean): Promise<'done' | 'changed' | 'gone'>
}

/** The activity, read from the core and kept current as uses are decided, go, and are undone. */
export function useActivity(client: Client): ActivityState {
  const [uses, setUses] = useState<AccessUse[]>()
  const [more, setMore] = useState(false)
  const [problem, setProblem] = useState<string>()

  /** A use told by the core: in place when known, else the newest. */
  const accept = useCallback((use: AccessUse) => {
    setUses((known) => {
      if (!known) return known
      const at = known.findIndex((one) => one.id === use.id)
      if (at < 0) return [use, ...known]
      const next = [...known]
      next[at] = use
      return next
    })
  }, [])

  useEffect(() => {
    let live = true
    const stop = client.session.onEvent((event) => {
      if (event.name === 'activity.used') accept(event.use)
    })
    client.session.run('activity.read', { limit: PAGE }).then(
      (read) => {
        if (!live) return
        setUses(read.uses)
        setMore(read.more)
      },
      () => live && setProblem('The activity could not be read.')
    )
    return () => {
      live = false
      stop()
    }
  }, [client, accept])

  return {
    uses,
    more,
    problem,
    async earlier() {
      const last = uses?.at(-1)
      if (!last) return
      const read = await client.session.run('activity.read', { limit: PAGE, before: last.id })
      setUses((known) => [...(known ?? []), ...read.uses.filter((use) => !known?.some((one) => one.id === use.id))])
      setMore(read.more)
    },
    async undo(use, anyway = false) {
      const undone = await client.session.run('activity.undo', { use, anyway })
      if (undone.use) accept(undone.use)
      return undone.outcome
    }
  }
}
