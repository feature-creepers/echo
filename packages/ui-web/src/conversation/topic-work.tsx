import type { Client } from '@repo/client'
import type { Exchange, Persona, Thread, Topic } from '@repo/protocol'
import { type FormEvent, useState } from 'react'
import { cn } from '../primitives/cn.ts'
import { SendGlyph } from '../primitives/icons.tsx'
import { topicOf } from './now.ts'
import { doingOf } from './plan.ts'
import { Empty, STATE, StateDot, StopThread, usedWords } from './thread-list.tsx'
import { ThreadView } from './thread-view.tsx'

interface TopicWorkProps {
  client: Client
  topic: Topic
  /** Every thread: those that work for the topic are picked from them. */
  threads: readonly Thread[]
  /** The conversation's lines, to say what each thread at work is doing. */
  exchanges: readonly Exchange[]
  personas: readonly Persona[]
}

/** The threads that work for a topic: those at work first, then the one last used, each sub-thread after its thread. */
export function threadsFor(topic: string, threads: readonly Thread[]): Thread[] {
  const order = (one: Thread, other: Thread) => Number(other.state === 'working') - Number(one.state === 'working') || other.at.localeCompare(one.at)
  const own = threads.filter((thread) => topicOf(thread, threads) === topic)
  return own
    .filter((thread) => thread.kind !== 'subthread')
    .sort(order)
    .flatMap((thread) => [thread, ...own.filter((under) => under.kind === 'subthread' && under.parent === thread.id).sort(order)])
}

/**
 * The work behind a topic, in the side panel (docs/SPEC.md, section 13.2): the threads that work for it, each with how
 * it stands and the way to stop it; under them the work of the one chosen, every request with its plan, its tool calls
 * and the files it changed; and at the bottom a line to say something about the topic.
 */
export function TopicWork({ client, topic, threads, exchanges, personas }: TopicWorkProps) {
  const working = threadsFor(topic.id, threads)
  const [chosen, setChosen] = useState<string>()
  // The one chosen, else the first: one at work, else the one last used.
  const shown = working.find((thread) => thread.id === chosen) ?? working[0]
  const [text, setText] = useState('')
  const say = (event: FormEvent) => {
    event.preventDefault()
    const words = text.trim()
    if (words === '') return
    setText('')
    client.speech.stop()
    void client.channel.say(words, { about: topic.id }).catch(() => setText(words))
  }

  if (!shown) return <Empty title="No thread" text="Nothing worked for this topic: what it shows was shown by you, or by a reminder." />
  const now = new Date()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-3">
        <div className="caps flex justify-between border-text border-b-2 pb-1.5 text-text-soft">
          <span>Threads</span>
          <span className="tabular-nums">{working.length}</span>
        </div>
        <ul className="scroll-quiet grid max-h-40 grid-cols-1 overflow-y-auto">
          {working.map((thread) => {
            const doing = thread.state === 'working' ? doingOf(thread.id, exchanges) : undefined
            return (
              <li key={thread.id} className={cn('flex min-w-0 items-center gap-1 border-line border-b', thread.kind === 'subthread' && 'pl-4')}>
                <button
                  type="button"
                  aria-current={thread.id === shown.id ? 'true' : undefined}
                  onClick={() => setChosen(thread.id)}
                  title={doing ?? thread.title}
                  className={cn(
                    '-outline-offset-1 flex h-7 min-w-0 flex-1 items-center gap-2 text-left text-[0.78125rem] transition-colors duration-(--duration-quick) ease-soft hover:text-text',
                    thread.id === shown.id ? 'text-text' : 'text-text-soft'
                  )}
                >
                  <StateDot state={thread.state} archived={thread.archived} />
                  <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                  <span className="caps shrink-0 text-text-soft">
                    {thread.state === 'working' ? 'At work' : `${STATE[thread.state]} · ${usedWords(thread.at, now)}`}
                  </span>
                </button>
                {thread.state === 'working' && <StopThread title={thread.title} onClick={() => void client.threads.stop(thread.id).catch(() => undefined)} />}
              </li>
            )
          })}
        </ul>
      </div>
      {/* Keyed by the thread, so the work of another is read anew. */}
      <ThreadView key={shown.id} client={client} thread={shown.id} threads={threads} personas={personas} />
      <form onSubmit={say} className="material mx-4 mb-3 flex h-9 shrink-0 items-center gap-2 pr-1 pl-2.5">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-label={`Say something about ${topic.title}`}
          placeholder="Say something about this topic"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[0.8125rem] text-text outline-none placeholder:text-text-faint"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={text.trim() === ''}
          className={cn(
            'flex size-7 shrink-0 items-center justify-center transition-colors duration-(--duration-quick) ease-soft [&_svg]:size-3.5',
            text.trim() === '' ? 'text-text-faint shadow-[inset_0_0_0_1px_var(--color-line)]' : 'bg-accent text-accent-ink hover:bg-accent/85'
          )}
        >
          <SendGlyph />
        </button>
      </form>
    </div>
  )
}
