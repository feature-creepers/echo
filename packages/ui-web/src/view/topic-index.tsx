import type { Topic } from '@repo/protocol'
import { cn } from '../primitives/cn.ts'

interface TopicIndexProps {
  /** The topics shown, the one last active first. */
  topics: readonly Topic[]
  /** The topic in front of the person. */
  front: string | undefined
  onGo(topic: string): void
}

/** How many squares the index draws: the topics around the one in front. */
const DRAWN = 36

/**
 * The index of the topics, at the right edge of the main screen (docs/SPEC.md, section 13.2): a small square for each
 * one, in their order, the one in front in the accent. Pointing at a square names its topic; pressing it goes there.
 */
export function TopicIndex({ topics, front, onGo }: TopicIndexProps) {
  const at = Math.max(
    0,
    topics.findIndex((topic) => topic.id === front)
  )
  const from = Math.min(Math.max(at - DRAWN / 2, 0), Math.max(topics.length - DRAWN, 0))
  return (
    <nav aria-label="Topics" className="-translate-y-1/2 absolute top-1/2 right-1 z-10 grid">
      {topics.slice(from, from + DRAWN).map((topic) => (
        <button
          key={topic.id}
          type="button"
          aria-label={topic.title}
          aria-current={topic.id === front ? 'true' : undefined}
          onClick={() => onGo(topic.id)}
          className="group relative flex h-3.5 w-4 items-center justify-center"
        >
          <span
            className={cn(
              'size-1.5 transition-colors duration-(--duration-quick) ease-soft',
              topic.id === front ? 'bg-accent' : 'border border-line-strong group-hover:border-text group-focus-visible:border-text'
            )}
          />
          <span className="caps pointer-events-none absolute right-5 max-w-56 truncate bg-ground px-1.5 text-text opacity-0 transition-opacity duration-(--duration-quick) ease-soft group-hover:opacity-100 group-focus-visible:opacity-100">
            {topic.title}
          </span>
        </button>
      ))}
    </nav>
  )
}
