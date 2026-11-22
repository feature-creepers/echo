import type { Answer, ShownView, Topic, TopicAnswers } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { Fragment, memo, useEffect, useMemo, useRef, useState, type WheelEvent } from 'react'
import { GoArrow } from '../conversation/go-arrow.tsx'
import { cn } from '../primitives/cn.ts'
import { ChevronGlyph, MoreGlyph } from '../primitives/icons.tsx'
import { Menu, type MenuEntry } from '../primitives/menu.tsx'
import { DURATION, EASE, glide } from '../styles/motion.ts'
import type { ViewActions } from './context.ts'
import { FEED, inRows } from './rows.ts'
import { type Stepped, shownOf } from './versions.ts'
import { ViewCard } from './view-card.tsx'

/** What an answer says over its cards. */
export interface AnswerWords {
  /** When it was asked for. */
  time?: string | undefined
  /** What was asked, and by whom when it was not the person. */
  asked?: string | undefined
  /** What the assistant said: the answer's headline. */
  said?: string | undefined
  /** It is being answered, and nothing was said yet. */
  working?: boolean | undefined
  /** Why it could not be answered. */
  problem?: string | undefined
  /** Opens the full answer its thread wrote, when it wrote one. */
  onOpenWhole?: (() => void) | undefined
}

/** What the person can correct of how the assistant filed things (docs/SPEC.md, section 7.3). */
export interface Corrections {
  rename(topic: string, title: string): void
  putAway(topic: string): void
  move(answer: string, to: { topic: string } | { title: string }): void
  merge(topic: string, into: string): void
}

interface TopicFeedProps {
  /** The topics to show, the one last active first, each with the answers of it read so far. */
  topics: readonly TopicAnswers[]
  /**
   * The topic that leads the page, first of the topics: the one in progress the person is on, right under the Now
   * zone's rule. The others follow it as the chronology, under "Earlier".
   */
  lead?: string | undefined
  /** The time now, to say which day each topic was last active. */
  moment: Date
  /** The answer each topic shows, when the person stepped away from its latest. */
  stepped: Readonly<Record<string, Stepped>>
  /** Step a topic to an earlier answer (1) or back to a later one (-1). */
  onStep(topic: string, way: 1 | -1): void
  /** The views that arrived while the app was open: they come in, where the ones read on opening are simply there. */
  arrived: readonly string[]
  /** The view the assistant is talking about. */
  attended?: string | undefined
  /** What the blocks of a view can do. Kept the same between renders, so a card is drawn again only when it changes. */
  actions(view: ShownView, topic: string): ViewActions
  onRemove(view: ShownView): void
  describe(answer: Answer): AnswerWords
  corrections: Corrections
}

const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** How far a sideways swipe must travel, in pixels, to step, and how long the island then waits before the next one. */
const SWIPE = { travel: 70, rest: 450 } as const

/** How many other topics an answer or a topic is offered to go to: the ones last active. */
const OFFERED = 8

/** The day a topic was last active, as the chronology's sections name it: "Today", "Yesterday", then the date. */
export function dayWords(iso: string, now: Date, locale?: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((day(now) - day(at)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return at.toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) })
}

/** What a topic made of one answer is called until the person names it: what was asked, cut short. */
const namedAfter = (answer: Answer) => {
  const words = (answer.exchange?.said || answer.views[0]?.title || 'New topic').replace(/\s+/g, ' ').trim()
  return words.length > 60 ? `${words.slice(0, 59).trimEnd()}…` : words
}

/** Whether something between an element and the island scrolls sideways itself: a wide table keeps its own swipe. */
function scrollsSideways(from: EventTarget, within: HTMLElement): boolean {
  for (let element = from instanceof HTMLElement ? from : null; element && element !== within; element = element.parentElement)
    if (element.scrollWidth > element.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(element).overflowX)) return true
  return false
}

/**
 * The topics of the conversation, one under the other, the one last active first (docs/SPEC.md, section 13.2). Each
 * is an island, bare on the ground: its name, when its answer was asked for and in what words, the way through its
 * versions, what the assistant said as its headline, then its cards side by side on rows of twelve columns. Each
 * answer is a version of its topic: the latest shows, the earlier ones are a step to the left.
 *
 * The topic that leads stands first, under the Now zone. The others are the chronology, in sections by the day each was
 * last active, each section under its day's name; a hairline parts the islands of one day.
 */
export function TopicFeed({ topics, lead, moment, stepped, onStep, arrived, attended, actions, onRemove, describe, corrections }: TopicFeedProps) {
  // The feed's own width says whether cards stand side by side, whatever narrows it: the window, the side sheet.
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const [stacked, setStacked] = useState(false)
  useEffect(() => {
    if (!box) return
    const observer = new ResizeObserver(([entry]) => setStacked((entry?.contentRect.width ?? FEED.most) < FEED.stacked))
    observer.observe(box)
    return () => observer.disconnect()
  }, [box])
  const names = useMemo(() => topics.map((one) => one.topic), [topics])
  // Each topic with the day that opens its section, when it is the first of that day in the chronology.
  let day: string | undefined
  const placed = topics.map((one, index) => {
    if (index === 0 && one.topic.id === lead) return { one, opens: undefined, ruled: false }
    const its = dayWords(one.topic.at, moment)
    const opens = its === day ? undefined : { day: its, first: day === undefined }
    day = its
    return { one, opens, ruled: opens === undefined }
  })

  return (
    <div ref={setBox} className="grid w-full min-w-0 grid-cols-1">
      <AnimatePresence initial={false}>
        {placed.flatMap(({ one, opens, ruled }) => [
          opens && (
            <motion.div
              key={`day:${opens.day}`}
              layout="position"
              transition={glide}
              // Under the Now zone the chronology is what came earlier; alone, its first section carries the page's rule.
              className={cn(
                'caps flex items-center gap-2.5 pt-3',
                opens.first && lead === undefined ? 'border-text border-t-[3px]' : 'border-line-strong border-t'
              )}
            >
              {opens.first && lead !== undefined && <span className="text-text">Earlier</span>}
              <span className="text-text-soft">{opens.day}</span>
            </motion.div>
          ),
          <Island
            key={one.topic.id}
            topic={one}
            ruled={ruled}
            stepped={stepped[one.topic.id]}
            stacked={stacked}
            others={names}
            onStep={onStep}
            arrived={arrived}
            attended={attended}
            actions={actions}
            onRemove={onRemove}
            describe={describe}
            corrections={corrections}
          />
        ])}
      </AnimatePresence>
    </div>
  )
}

interface IslandProps extends Omit<TopicFeedProps, 'topics' | 'stepped' | 'lead' | 'moment'> {
  topic: TopicAnswers
  /** A hairline stands over it: it follows another island of its day. */
  ruled: boolean
  stepped: Stepped | undefined
  stacked: boolean
  /** Every topic shown, this one among them: where an answer or the topic can go. */
  others: readonly Topic[]
}

function Island({ topic, ruled, stepped, stacked, others, onStep, arrived, attended, actions, onRemove, describe, corrections }: IslandProps) {
  const { id, title, answers: total } = topic.topic
  const { at, way } = shownOf(topic, stepped)
  const answer = topic.answers[at]
  const [renaming, setRenaming] = useState(false)
  // A sideways swipe steps once, then rests, so one gesture is one step however long it runs on.
  const swipe = useRef({ travelled: 0, restsUntil: 0 })
  const touch = useRef<{ x: number; y: number } | undefined>(undefined)
  // The answer shown on opening is simply there: only one stepped to, or one that arrives, comes in.
  const opened = useRef(false)
  useEffect(() => {
    opened.current = true
  }, [])
  if (!answer) return null
  const words = describe(answer)

  const onWheel = (event: WheelEvent<HTMLElement>) => {
    if (total < 2 || Math.abs(event.deltaX) <= Math.abs(event.deltaY) || scrollsSideways(event.target, event.currentTarget)) return
    if (event.timeStamp < swipe.current.restsUntil) return
    swipe.current.travelled += event.deltaX
    if (Math.abs(swipe.current.travelled) < SWIPE.travel) return
    // The answers run from the first on the left to the latest on the right, as the rail draws them.
    onStep(id, swipe.current.travelled > 0 ? -1 : 1)
    swipe.current = { travelled: 0, restsUntil: event.timeStamp + SWIPE.rest }
  }

  return (
    <motion.article
      // The stage finds the island by its topic, to know which one is in front of the person.
      data-topic={id}
      layout="position"
      aria-label={title}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE } }}
      exit={{ opacity: 0, transition: { duration: DURATION.quick, ease: EASE } }}
      transition={glide}
      onWheel={onWheel}
      onTouchStart={(event) => {
        const finger = event.touches[0]
        touch.current =
          finger && event.touches.length === 1 && !scrollsSideways(event.target, event.currentTarget) ? { x: finger.clientX, y: finger.clientY } : undefined
      }}
      onTouchEnd={(event) => {
        const [from, finger] = [touch.current, event.changedTouches[0]]
        touch.current = undefined
        if (!from || !finger || total < 2) return
        const [across, down] = [finger.clientX - from.x, finger.clientY - from.y]
        if (Math.abs(across) > SWIPE.travel && Math.abs(across) > 1.5 * Math.abs(down)) onStep(id, across > 0 ? 1 : -1)
      }}
      className={cn('group/island min-w-0 pb-9', ruled ? 'border-line-strong border-t pt-3.5' : 'pt-2.5')}
    >
      <div className="flex h-5 min-w-0 items-center gap-2.5">
        {renaming ? (
          <NameField
            name={title}
            onDone={(name) => {
              setRenaming(false)
              if (name !== undefined && name !== title) corrections.rename(id, name)
            }}
          />
        ) : (
          <h2 title={title} className={cn('caps min-w-0 truncate text-text', !stacked && 'max-w-[45%] shrink-0')}>
            {title}
          </h2>
        )}
        {words.time && !stacked && <span className="caps shrink-0 text-text-soft tabular-nums">{words.time}</span>}
        <span title={words.asked} className="min-w-0 flex-1 truncate text-[0.8125rem] text-text-soft">
          {words.asked}
        </span>
        {total > 1 && <VersionRail at={at} total={total} squares={!stacked} onStep={(to) => onStep(id, to)} />}
        <CorrectionsMenu topic={topic.topic} answer={answer} others={others} corrections={corrections} onRename={() => setRenaming(true)} />
      </div>
      {/* Keyed by the answer, so stepping to another draws it anew: it comes in from the side it lies on. */}
      <motion.div
        key={answer.id}
        initial={!opened.current || still() ? false : { opacity: 0, x: way * -20 }}
        animate={{ opacity: 1, x: 0, transition: { duration: DURATION.calm, ease: EASE } }}
        className="min-w-0"
      >
        {words.said ? (
          <p className="mt-3.5 line-clamp-4 max-w-[37.5rem] text-balance font-medium text-[1.5625rem] leading-[1.9375rem] tracking-[-0.015em]">{words.said}</p>
        ) : words.working ? (
          <p className="caps mt-3.5 flex items-center gap-[7px] text-text-soft">
            <span aria-hidden="true" className="size-[7px] bg-accent" />
            Working on it
          </p>
        ) : null}
        {words.problem && <p className="mt-2.5 max-w-[37.5rem] text-[0.9375rem] text-danger leading-snug">{words.problem}</p>}
        {words.onOpenWhole && (
          <button
            type="button"
            onClick={words.onOpenWhole}
            className="caps group mt-2.5 inline-flex items-center gap-1.5 text-text-soft transition-colors duration-(--duration-quick) ease-soft hover:text-text"
          >
            Full answer
            <GoArrow />
          </button>
        )}
        {answer.views.length > 0 && (
          <div className="mt-5 grid min-w-0 grid-cols-1">
            {inRows(answer.views, stacked).map((row, line) => (
              <div key={row[0]?.card.id} className={cn('grid min-w-0 grid-cols-12', line > 0 && 'mt-5 border-line border-t pt-5')}>
                {row.map(({ card, span }, column) => (
                  <section
                    key={card.id}
                    style={{ gridColumn: `span ${span} / span ${span}` }}
                    className={cn('min-w-0', column > 0 && 'border-line border-l pl-5', column < row.length - 1 && 'pr-5')}
                  >
                    <FeedCard
                      view={card}
                      topic={id}
                      appear={arrived.includes(card.id)}
                      order={line * 3 + column}
                      lit={attended === card.id}
                      actions={actions}
                      onRemove={onRemove}
                    />
                  </section>
                ))}
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </motion.article>
  )
}

/** How many versions the rail draws as squares: the ones around the one shown. */
const RAIL = 7
const two = (count: number) => String(count).padStart(2, '0')

interface VersionRailProps {
  /** The answer shown, counted from the latest. */
  at: number
  total: number
  /** Whether there is room for the squares, or only for the count and the arrows. */
  squares: boolean
  onStep(way: 1 | -1): void
}

/**
 * The way through a topic's versions: a square for each answer, the first on the left and the latest on the right,
 * the one shown in the accent; which one it is; and the two arrows.
 */
function VersionRail({ at, total, squares, onStep }: VersionRailProps) {
  const shown = total - at
  const drawn = Math.min(total, RAIL)
  const from = Math.min(Math.max(shown - Math.ceil(RAIL / 2), 0), total - drawn) + 1
  return (
    <span title="Each answer is a version of its topic" className="caps flex shrink-0 items-center text-text-soft tabular-nums">
      {squares && (
        <span aria-hidden="true" className="mr-2.5 flex items-center">
          {Array.from({ length: drawn }, (_, index) => from + index).map((version, index) => (
            <Fragment key={version}>
              {index > 0 && <span className="h-px w-3 bg-line-strong" />}
              <span className={cn('size-1.5', version === shown ? 'bg-accent' : 'border border-line-strong')} />
            </Fragment>
          ))}
        </span>
      )}
      <span>{`V ${two(shown)}/${two(total)}`}</span>
      <StepButton label="Earlier answer" disabled={shown <= 1} onClick={() => onStep(1)} turn="rotate-90" className="ml-1" />
      <StepButton label="Later answer" disabled={shown >= total} onClick={() => onStep(-1)} turn="-rotate-90" />
    </span>
  )
}

function StepButton({ label, disabled, onClick, turn, className }: { label: string; disabled: boolean; onClick(): void; turn: string; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-5 items-center justify-center text-text transition-colors duration-(--duration-quick) ease-soft hover:text-accent disabled:text-text-faint disabled:opacity-60 [&_svg]:size-3',
        className
      )}
    >
      <span className={turn}>
        <ChevronGlyph />
      </span>
    </button>
  )
}

/** The topic's name as a field: Enter keeps what was typed, Escape or leaving the field keeps the name it had. */
function NameField({ name, onDone }: { name: string; onDone(name: string | undefined): void }) {
  const [typed, setTyped] = useState(name)
  return (
    <input
      aria-label="The topic's name"
      value={typed}
      maxLength={80}
      // biome-ignore lint/a11y/noAutofocus: the field appears because the person asked to rename the topic
      autoFocus
      spellCheck={false}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setTyped(event.target.value)}
      onBlur={() => onDone(undefined)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onDone(typed.trim() || undefined)
        else if (event.key === 'Escape') onDone(undefined)
        else return
        event.preventDefault()
        event.stopPropagation()
      }}
      className="caps h-5 w-[45%] min-w-32 shrink-0 border-text border-b bg-transparent text-text outline-none"
    />
  )
}

interface CorrectionsMenuProps {
  topic: Topic
  /** The answer shown: the one a move takes elsewhere. */
  answer: Answer
  others: readonly Topic[]
  corrections: Corrections
  onRename(): void
}

/**
 * What the person corrects of a topic, under three small squares that show once the island is pointed at: its name,
 * where the answer shown belongs, the topic it is one with, and putting it away. Moving and merging open the list of
 * the topics last active in the same menu.
 */
function CorrectionsMenu({ topic, answer, others, corrections, onRename }: CorrectionsMenuProps) {
  const [listing, setListing] = useState<'move' | 'merge'>()
  const elsewhere = others.filter((other) => other.id !== topic.id).slice(0, OFFERED)
  const items: MenuEntry[] =
    listing === 'move'
      ? [
          { heading: 'Move this answer to' },
          { label: 'A new topic', onSelect: () => corrections.move(answer.id, { title: namedAfter(answer) }) },
          ...elsewhere.map((other) => ({ label: other.title, onSelect: () => corrections.move(answer.id, { topic: other.id }) }))
        ]
      : listing === 'merge'
        ? [{ heading: 'Merge this topic into' }, ...elsewhere.map((other) => ({ label: other.title, onSelect: () => corrections.merge(topic.id, other.id) }))]
        : [
            { label: 'Rename', onSelect: onRename },
            { label: 'Move this answer…', onSelect: () => setListing('move'), stay: true },
            ...(elsewhere.length > 0 ? [{ label: 'Merge into…', onSelect: () => setListing('merge'), stay: true }] : []),
            { divider: true },
            { label: 'Put away', onSelect: () => corrections.putAway(topic.id) }
          ]
  return (
    <Menu
      label={`${topic.title}: correct`}
      className="w-60"
      items={items}
      trigger={({ onClick, ...props }, { open }) => (
        <button
          type="button"
          aria-label={`Correct ${topic.title}`}
          title="Rename, move, merge, put away"
          {...props}
          onClick={(event) => {
            // It opens on what can be done, not on the list it was left on.
            setListing(undefined)
            onClick?.(event)
          }}
          className={cn(
            'flex size-5 shrink-0 items-center justify-center text-text-soft transition-[opacity,color] duration-(--duration-quick) ease-soft hover:text-text focus-visible:opacity-100 group-hover/island:opacity-100 [&_svg]:size-3.5',
            open ? 'text-text opacity-100' : 'opacity-0'
          )}
        >
          <MoreGlyph />
        </button>
      )}
    />
  )
}

interface FeedCardProps {
  view: ShownView
  topic: string
  /** Whether it comes in: it arrived while the app was open. */
  appear: boolean
  /** Its place among the cards of its answer: each comes in a moment after the one before. */
  order: number
  lit: boolean
  actions(view: ShownView, topic: string): ViewActions
  onRemove(view: ShownView): void
}

/**
 * One card of an answer. Drawn again only when its own view or what it can do changes, not each time the screen
 * around it does (a sentence spoken, a change of mood): a view can be a large tree. It rises a little as it fades
 * in, after the cards before it.
 */
const FeedCard = memo(function FeedCard({ view, topic, appear, order, lit, actions, onRemove }: FeedCardProps) {
  const can = useMemo(() => actions(view, topic), [actions, view, topic])
  const [entering] = useState(() => appear && !still())
  return (
    <motion.div
      initial={entering ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE, delay: entering ? 0.12 + order * 0.07 : 0 } }}
      className="min-w-0"
    >
      <ViewCard view={view} actions={can} lit={lit} onClose={() => onRemove(view)} />
    </motion.div>
  )
})
