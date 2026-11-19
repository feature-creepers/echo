import type { Client } from '@repo/client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type ThreadPages, withEarlier, withLatest } from './thread-pages.ts'

/** Where reading the earlier requests stands. */
export type EarlierReading = { state: 'idle' } | { state: 'reading' } | { state: 'failed'; problem: string }

export interface ThreadPagesState {
  /** What has been read of the thread, the latest request included. Undefined until the first page arrives. */
  pages: ThreadPages | undefined
  /** Why the thread could not be read at all. */
  problem: string | undefined
  earlier: EarlierReading
  /** Read the page of requests before the first one read, if there are any and none is being read. */
  readEarlier(): void
}

const IDLE: EarlierReading = { state: 'idle' }
const wordsOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * A thread as the side sheet reads it: its latest page first, read again a moment after anything that concerns the
 * thread, so a working thread fills in as it goes, and its earlier pages one at a time, when asked for.
 */
export function useThreadPages(client: Client, thread: string): ThreadPagesState {
  const [pages, setPages] = useState<ThreadPages>()
  const [problem, setProblem] = useState<string>()
  const [earlier, setEarlier] = useState<EarlierReading>(IDLE)
  // What the callbacks need without being made again on each read.
  const latest = useRef({ pages, earlier })
  latest.current = { pages, earlier }

  useEffect(() => {
    let gone = false
    setPages(undefined)
    setProblem(undefined)
    setEarlier(IDLE)
    const load = () => {
      client.threads.read(thread).then(
        (page) => {
          if (gone) return
          setPages((was) => withLatest(was, page))
          setProblem(undefined)
        },
        (error: unknown) => {
          // Once something is shown, a read that fails leaves it: the next one will bring it up to date.
          if (!gone && latest.current.pages === undefined) setProblem(wordsOf(error))
        }
      )
    }
    load()
    let timer: number | undefined
    const soon = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(load, 200)
    }
    const stop = client.session.onEvent((event) => {
      const concerns =
        (event.name === 'activity' && event.step?.thread === thread) ||
        ((event.name === 'turn.started' || event.name === 'turn.ended' || event.name === 'answer.written' || event.name === 'turn.planned') &&
          event.exchange.thread === thread) ||
        (event.name === 'view.shown' && event.view.thread === thread) ||
        event.name === 'threads.changed'
      if (concerns) soon()
    })
    return () => {
      gone = true
      stop()
      window.clearTimeout(timer)
    }
  }, [client, thread])

  const readEarlier = useCallback(() => {
    const { pages: read, earlier: reading } = latest.current
    const first = read?.entries[0]?.exchange.turn
    if (read === undefined || first === undefined || read.earlier === 0 || reading.state === 'reading') return
    setEarlier({ state: 'reading' })
    latest.current = { pages: read, earlier: { state: 'reading' } }
    client.threads.read(thread, first).then(
      (page) => {
        setPages((was) => (was === undefined || was.entries[0]?.exchange.turn !== first ? was : withEarlier(was, page)))
        setEarlier(IDLE)
      },
      (error: unknown) => setEarlier({ state: 'failed', problem: wordsOf(error) })
    )
  }, [client, thread])

  return { pages, problem, earlier, readEarlier }
}
