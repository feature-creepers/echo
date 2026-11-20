import { FEED_DEFAULT_SECONDS, FEED_MIN_SECONDS } from '@repo/catalog'
import { useEffect, useState } from 'react'
import { useViewActions } from './context.ts'

type Wanted = { url: string; every?: number | undefined } | undefined

/** Read for no feed yet. */
const NONE: unknown[] = []

/**
 * The documents some feeds name, each read again every `every` seconds while the block is drawn (docs/SPEC.md,
 * section 9.4). Each is undefined until its first reading, and kept as last read when a reading fails, so a figure
 * never blinks out: the block shows what it was given until then. The core keeps a reading half a minute, so blocks
 * naming the same address share it.
 */
export function useFeedDocuments(feeds: Wanted[]): unknown[] {
  const { readFeed } = useViewActions()
  // The feeds as one key, so a view drawn again with the same feeds does not read them again.
  const key = JSON.stringify(feeds.map((feed) => (feed ? [feed.url, feed.every ?? null] : null)))
  // What was read, and for which feeds: once the feeds change, what their earlier addresses gave is not theirs.
  const [read, setRead] = useState<{ key: string; documents: unknown[] }>({ key, documents: NONE })
  useEffect(() => {
    const wanted = JSON.parse(key) as ([string, number | null] | null)[]
    if (!readFeed || wanted.every((feed) => feed === null)) return
    let current = true
    const timers = wanted.map((feed, index) => {
      if (feed === null) return undefined
      const [url, every] = feed
      const once = () =>
        readFeed(url).then(
          (document) =>
            current &&
            setRead((before) => {
              const documents = before.key === key ? [...before.documents] : []
              documents[index] = document
              return { key, documents }
            }),
          () => undefined
        )
      void once()
      return setInterval(once, Math.max(FEED_MIN_SECONDS, every ?? FEED_DEFAULT_SECONDS) * 1000)
    })
    return () => {
      current = false
      for (const timer of timers) if (timer) clearInterval(timer)
    }
  }, [key, readFeed])
  return read.key === key ? read.documents : NONE
}

/** The document one feed names, as `useFeedDocuments` reads it. */
export function useFeedDocument(feed: Wanted): unknown {
  return useFeedDocuments([feed])[0]
}
