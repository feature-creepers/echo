import type { Client } from '@repo/client'
import type { Topic } from '@repo/protocol'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../primitives/button.tsx'
import { BackLink } from './back-link.tsx'
import { Empty, usedWords } from './thread-list.tsx'

/** What is known of the topics put away: being read, read, or why they could not be. */
type Away = { is: 'reading' } | { is: 'read'; topics: readonly Topic[] } | { is: 'failed' }

/**
 * The topics the person put away, in the side panel (docs/SPEC.md, section 13.2), the one last active first: each with
 * when it was last active and how many answers it has, and the way to bring it back to the main screen.
 */
export function TopicsAway({ client, onBack }: { client: Client; onBack(): void }) {
  const [away, setAway] = useState<Away>({ is: 'reading' })
  const read = useCallback(() => {
    client.topics.away().then(
      (topics) => setAway({ is: 'read', topics: topics.map((one) => one.topic) }),
      () => setAway({ is: 'failed' })
    )
  }, [client])
  useEffect(read, [read])
  const bringBack = (topic: string) => void client.topics.archive(topic, false).then(read, () => setAway({ is: 'failed' }))
  const now = new Date()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-line border-b px-4 pt-2 pb-3">
        <BackLink onClick={onBack}>Threads</BackLink>
        <p className="mt-2 font-medium text-[0.9375rem] leading-snug">Topics put away</p>
      </div>
      {away.is === 'reading' ? (
        <p className="caps px-4 pt-3 text-text-soft">Reading</p>
      ) : away.is === 'failed' ? (
        <div className="flex items-center gap-2 px-4 pt-3">
          <span className="min-w-0 flex-1 text-[0.8125rem] text-danger">The topics put away could not be read.</span>
          <Button kind="quiet" size="sm" onClick={read}>
            Try again
          </Button>
        </div>
      ) : away.topics.length === 0 ? (
        <Empty title="Nothing put away" text="A topic you put away from the main screen waits here, with everything it holds." />
      ) : (
        <ul className="scroll-quiet mx-4 mt-3 grid min-h-0 grid-cols-1 overflow-y-auto border-text border-t-2">
          {away.topics.map((topic) => (
            <li key={topic.id} className="flex min-h-9 min-w-0 items-center gap-2 border-line border-b">
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-[0.8125rem]">{topic.title}</span>
                <span className="caps truncate text-text-soft">{`${usedWords(topic.at, now)} · ${topic.answers === 1 ? '1 answer' : `${topic.answers} answers`}`}</span>
              </span>
              <Button kind="quiet" size="sm" onClick={() => bringBack(topic.id)}>
                Bring back
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
