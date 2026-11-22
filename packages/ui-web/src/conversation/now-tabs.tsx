import type { Topic, TopicProgress } from '@repo/protocol'
import { useEffect, useState } from 'react'
import { cn } from '../primitives/cn.ts'
import { PROGRESS_WORDS } from './now.ts'

/** A topic in progress as a tab names it. */
export interface NowTab {
  topic: Topic
  /** Its place among the topics in progress, from 1: what its tab is numbered. */
  number: number
  /** What its latest answer found, on one line. */
  line: string | undefined
}

const two = (count: number) => String(count).padStart(2, '0')

/**
 * How a topic in progress stands, as a small square: yellow when it asks the person something, the accent while it is
 * at work, the ink when an answer waits, and a hollow one while it rests.
 */
export function ProgressMark({ progress }: { progress: TopicProgress | undefined }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-1.5 shrink-0',
        progress === 'asks' ? 'bg-warn' : progress === 'working' ? 'bg-accent' : progress === 'ready' ? 'bg-text' : 'border border-line-strong'
      )}
    />
  )
}

/** A tab's number and how its topic stands, in words: "02 · Asks you". */
export const standing = (tab: NowTab) => `${two(tab.number)} · ${PROGRESS_WORDS[tab.topic.progress ?? 'quiet']}`

interface NowTabsProps {
  tabs: readonly NowTab[]
  /** The topic whose island leads the page. */
  selected: string | undefined
  /** The topic the person picked, here or elsewhere: the tabs turn to it when it is not among those shown. */
  picked: string | undefined
  onPick(topic: string): void
}

/**
 * The topics in progress as a strip of tabs under the hub (docs/SPEC.md, section 13.2), under a rule of the accent:
 * each one's number and standing, its name, and what its latest answer found. Four stand side by side, two in a
 * narrow column, and the last cell turns to the next ones.
 */
export function NowStrip({ tabs, selected, picked, onPick, narrow }: NowTabsProps & { narrow: boolean }) {
  const side = narrow ? 2 : 4
  const [from, setFrom] = useState(0)
  const at = tabs.findIndex((tab) => tab.topic.id === picked)
  useEffect(() => {
    if (at >= 0) setFrom((was) => (at >= was && at < was + side ? was : Math.floor(at / side) * side))
  }, [at, side])
  const start = from < tabs.length ? from : 0
  const shown = tabs.slice(start, start + side)
  const more = tabs.length - shown.length
  return (
    <nav
      aria-label="In progress"
      className="grid border-accent border-t-[3px]"
      style={{ gridTemplateColumns: `repeat(${side}, minmax(0, 1fr))${more > 0 ? ' 2.75rem' : ''}` }}
    >
      {shown.map((tab, index) => {
        const on = tab.topic.id === selected
        return (
          <button
            key={tab.topic.id}
            type="button"
            aria-current={on ? 'true' : undefined}
            onClick={() => onPick(tab.topic.id)}
            className={cn('group relative min-w-0 pt-2 pb-[9px] text-left', index === 0 ? 'pr-2.5' : 'border-line border-l px-2.5')}
          >
            <span className="caps flex items-center gap-[5px] text-text-soft">
              <ProgressMark progress={tab.topic.progress} />
              <span className="truncate">{standing(tab)}</span>
            </span>
            <span
              className={cn(
                'display mt-[3px] block truncate text-[1.0625rem] leading-4 transition-colors duration-(--duration-quick) ease-soft group-hover:text-text',
                on ? 'text-text' : 'text-text-faint'
              )}
            >
              {tab.topic.title}
            </span>
            <span className={cn('mt-[3px] block h-[0.9375rem] truncate text-[0.71875rem] leading-[0.9375rem]', on ? 'text-text' : 'text-text-soft')}>
              {tab.line}
            </span>
            {on && <span aria-hidden="true" className={cn('absolute right-2.5 bottom-0 h-0.5 bg-accent', index === 0 ? 'left-0' : 'left-2.5')} />}
          </button>
        )
      })}
      {more > 0 && (
        <button
          type="button"
          aria-label={`${more} more in progress`}
          title="The next ones"
          onClick={() => setFrom(start + side < tabs.length ? start + side : 0)}
          className="caps grid place-items-center border-line border-l text-text-soft transition-colors duration-(--duration-quick) ease-soft hover:text-text"
        >
          {`+${more} ›`}
        </button>
      )}
    </nav>
  )
}

/**
 * The topics in progress as tabs one line high, in the bar the eye shrinks into: each one's number, standing and name,
 * as many as fit, then how many more, which turns to the next ones. The one whose island leads stands on a line of the
 * accent.
 */
export function NowTabs({ tabs, selected, picked, onPick }: NowTabsProps) {
  const [row, setRow] = useState<HTMLDivElement | null>(null)
  const [from, setFrom] = useState(0)
  const [fits, setFits] = useState(tabs.length)
  const start = from < tabs.length ? from : 0
  const turned = [...tabs.slice(start), ...tabs.slice(0, start)]
  // The tabs that do not fit wrap under the row, out of sight: counting those still on it says how many do.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the tabs' names change how many fit
  useEffect(() => {
    if (!row) return
    const count = () => setFits([...row.children].filter((tab) => (tab as HTMLElement).offsetTop < row.clientHeight).length)
    const observer = new ResizeObserver(count)
    observer.observe(row)
    count()
    return () => observer.disconnect()
  }, [row, tabs, start])
  const more = tabs.length - fits
  const at = turned.findIndex((tab) => tab.topic.id === picked)
  useEffect(() => {
    if (at >= fits) setFrom((was) => (was + at) % Math.max(tabs.length, 1))
  }, [at, fits, tabs.length])
  return (
    <nav aria-label="In progress" className="flex h-full min-w-0 flex-1 items-stretch">
      <div ref={setRow} className="flex h-full min-w-0 flex-1 flex-wrap items-stretch overflow-hidden">
        {turned.map((tab) => {
          const on = tab.topic.id === selected
          return (
            <button
              key={tab.topic.id}
              type="button"
              aria-current={on ? 'true' : undefined}
              title={`${tab.topic.title} · ${PROGRESS_WORDS[tab.topic.progress ?? 'quiet']}`}
              onClick={() => onPick(tab.topic.id)}
              className="group relative flex h-full shrink-0 items-center gap-1.5 whitespace-nowrap border-line border-r px-[11px]"
            >
              <span className="caps text-text-faint">{two(tab.number)}</span>
              <ProgressMark progress={tab.topic.progress} />
              <span
                className={cn(
                  'display max-w-40 truncate text-[0.9375rem] leading-[0.875rem] transition-colors duration-(--duration-quick) ease-soft group-hover:text-text',
                  on ? 'text-text' : 'text-text-soft'
                )}
              >
                {tab.topic.title}
              </span>
              {on && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-accent" />}
            </button>
          )
        })}
      </div>
      {more > 0 && (
        <button
          type="button"
          aria-label={`${more} more in progress`}
          title="The next ones"
          onClick={() => setFrom((start + Math.max(fits, 1)) % tabs.length)}
          className="caps flex shrink-0 items-center px-[11px] text-text-soft transition-colors duration-(--duration-quick) ease-soft hover:text-text"
        >
          {`+${more} ›`}
        </button>
      )}
    </nav>
  )
}
