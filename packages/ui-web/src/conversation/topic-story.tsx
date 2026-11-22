import type { TopicAnswers, TurnId } from '@repo/protocol'
import { Button } from '../primitives/button.tsx'
import { cn } from '../primitives/cn.ts'
import { GoArrow } from './go-arrow.tsx'
import { answerLine } from './transcript.tsx'
import { whoAsked } from './who-asked.ts'

interface TopicStoryProps {
  /** The topic, with the answers of it read so far, the latest first. */
  topic: TopicAnswers
  /** The answer its island shows. */
  shown: string | undefined
  /** Show an answer on its island. */
  onShow(answer: string): void
  /** Read the answers before those read. */
  onEarlier(): void
  /** Show the full answer a line's thread wrote, whole. */
  onOpenAnswer(turn: TurnId): void
  now: Date
}

const two = (count: number) => String(count).padStart(2, '0')

/** When an answer was asked for, as its line says: the time today, the day and the time within a week, then the date. */
export function whenWords(iso: string, now: Date, locale?: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const day = (one: Date) => new Date(one.getFullYear(), one.getMonth(), one.getDate()).getTime()
  const days = Math.round((day(now) - day(at)) / 86_400_000)
  const time = at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  if (days <= 0) return time
  return days < 7 ? `${at.toLocaleDateString(locale, { weekday: 'short' })} ${time}` : at.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

/**
 * A topic's story, in the side panel (docs/SPEC.md, section 13.2): its answers along a line, the latest first, each
 * a version of it with its number and when it was asked for, what was asked and what the assistant said. The one its
 * island shows is marked in the accent; any other can be shown there. An answer its thread wrote in full leads to it.
 */
export function TopicStory({ topic, shown, onShow, onEarlier, onOpenAnswer, now }: TopicStoryProps) {
  const total = topic.topic.answers
  const unread = total - topic.answers.length
  return (
    <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pt-3 pb-4">
      {/* The line the versions stand on. */}
      <ol className="relative grid grid-cols-1 pl-4 before:absolute before:top-1.5 before:bottom-1 before:left-[2.5px] before:w-px before:bg-line-strong">
        {topic.answers.map((answer, at) => {
          const on = answer.id === shown
          const line = answer.exchange
          const who = line ? whoAsked(line) : undefined
          const said = line ? answerLine(line) : undefined
          return (
            <li key={answer.id} className="relative grid grid-cols-1 gap-0.5 pb-3.5">
              <span aria-hidden="true" className={cn('-left-4 absolute top-1 size-1.5', on ? 'bg-accent' : 'border border-line-strong bg-panel')} />
              <span className="caps flex min-w-0 items-center justify-between gap-2 text-text-soft">
                <span className={cn('min-w-0 truncate tabular-nums', on && 'text-text')}>{`V ${two(total - at)} · ${whenWords(answer.at, now)}`}</span>
                {on ? (
                  <span className="shrink-0 text-text">Shown</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onShow(answer.id)}
                    title="Show this answer on its island"
                    className="caps shrink-0 transition-colors duration-(--duration-quick) ease-soft hover:text-text"
                  >
                    Show
                  </button>
                )}
              </span>
              {line && (line.said !== '' || who !== 'You') && (
                <span className="line-clamp-3 text-[0.75rem] text-text-soft leading-4 [overflow-wrap:anywhere]">
                  {who === 'You' ? line.said : line.said === '' ? who : `${who} · ${line.said}`}
                </span>
              )}
              {said && <span className={cn('line-clamp-4 text-[0.8125rem] leading-[1.125rem] [overflow-wrap:anywhere]', !on && 'text-text-soft')}>{said}</span>}
              {line?.outcome === 'running' && <span className="caps text-accent">Answering</span>}
              {line?.outcome === 'failed' && (
                <span className="text-[0.75rem] text-danger leading-4 [overflow-wrap:anywhere]">{line.problem ?? 'It could not answer.'}</span>
              )}
              {(line?.written !== undefined || answer.views.length > 0) && (
                <span className="caps mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-text-soft">
                  {line?.written !== undefined && (
                    <button
                      type="button"
                      onClick={() => onOpenAnswer(line.turn)}
                      className="caps group flex items-center gap-1 transition-colors duration-(--duration-quick) ease-soft hover:text-text"
                    >
                      Full answer
                      <GoArrow />
                    </button>
                  )}
                  {answer.views.length > 0 && <span>{answer.views.length === 1 ? '1 card' : `${answer.views.length} cards`}</span>}
                </span>
              )}
            </li>
          )
        })}
      </ol>
      {unread > 0 && (
        <Button kind="quiet" size="sm" onClick={onEarlier} className="ml-4">
          {unread === 1 ? 'One earlier answer' : `${unread} earlier answers`}
        </Button>
      )}
    </div>
  )
}
