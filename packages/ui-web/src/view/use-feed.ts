import { FEED_DEFAULT_SECONDS, FEED_MIN_SECONDS } from '@repo/catalog'
import { useEffect, useState } from 'react'
import { useViewActions } from './context.ts'

type Wanted = { url: string; every?: number | undefined } | undefined

/**
 * The documents some feeds name, each read again every `every` seconds while the block is drawn (docs/SPEC.md,
 * section 9.4). Each is undefined until its first reading, and kept as last read when a reading fails, so a figure
 * never blinks out: the block shows what it was given until then. The core keeps a reading half a minute, so blocks
 * naming the same address share it.
 */
export function useFeedDocuments(feeds: Wanted[]): unknown[] {
  const { readFeed } = useViewActions()
  const [documents, setDocuments] = useState<unknown[]>([])
  // The feeds as one key, so a view drawn again with the same feeds does not read them again.
  const key = JSON.stringify(feeds.map((feed) => (feed ? [feed.url, feed.every ?? null] : null)))
  useEffect(() => {
    const wanted = JSON.parse(key) as ([string, number | null] | null)[]
    if (!readFeed || wanted.every((feed) => feed === null)) return
    let current = true
    const timers = wanted.map((feed, index) => {
      if (feed === null) return undefined
      const [url, every] = feed
      const read = () =>
        readFeed(url).then(
          (document) =>
            current &&
            setDocuments((before) => {
              const after = [...before]
              after[index] = document
              return after
            }),
          () => undefined
        )
      void read()
      return setInterval(read, Math.max(FEED_MIN_SECONDS, every ?? FEED_DEFAULT_SECONDS) * 1000)
    })
    return () => {
      current = false
      for (const timer of timers) if (timer) clearInterval(timer)
    }
  }, [key, readFeed])
  return documents
}

/** The document one feed names, as `useFeedDocuments` reads it. */
export function useFeedDocument(feed: Wanted): unknown {
  return useFeedDocuments([feed])[0]
}
