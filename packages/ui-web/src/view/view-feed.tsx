import type { ShownView } from '@repo/protocol'
import { AnimatePresence, motion } from 'motion/react'
import { memo, useEffect, useMemo, useState } from 'react'
import { GoArrow } from '../conversation/go-arrow.tsx'
import { cn } from '../primitives/cn.ts'
import { ChevronGlyph, CloseGlyph } from '../primitives/icons.tsx'
import { DURATION, EASE, glide } from '../styles/motion.ts'
import type { ViewActions } from './context.ts'
import { FEED, type GroupVersion, inRows, type ViewGroup } from './groups.ts'
import { ViewCard } from './view-card.tsx'

/** What an answer says over its cards. */
export interface AnswerWords {
  /** When it was asked for. */
  time?: string | undefined
  /** What was asked, and by whom when it was not the person. */
  asked?: string | undefined
  /** What the assistant said: the answer's headline. */
  said: string
  /** Opens the full answer its thread wrote, when it wrote one. */
  onOpenWhole?: (() => void) | undefined
}

interface ViewFeedProps {
  /** The topics to show, the one shown last first. */
  groups: readonly ViewGroup[]
  /** The views that arrived while the app was open: they come in, where the ones read on opening are simply there. */
  arrived: readonly string[]
  /** The view the assistant is talking about. */
  attended?: string | undefined
  /** What the blocks of a view can do. Kept the same between renders, so a card is drawn again only when it changes. */
  actions(view: ShownView): ViewActions
  onClose(view: ShownView): void
  describe(group: ViewGroup, version: GroupVersion): AnswerWords
}

const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** The version of a topic the person stepped back to, good only while the topic's latest answer is the same. */
interface Stepped {
  latest: string
  shown: string
}

/**
 * The answers of the conversation, one under the other, the newest first (docs/SPEC.md, section 13.2): one for each
 * topic, bare on the ground, every one open. An answer is a line saying when it was asked and in what words, what
 * the assistant said as its headline, then its cards side by side on rows of twelve columns, parted by hairlines. An
 * answer that updates a topic takes the place of the one before, which stays a step back. A rule of the full ink
 * stands over the newest answer, a hairline over the others.
 */
export function ViewFeed({ groups, arrived, attended, actions, onClose, describe }: ViewFeedProps) {
  const [stepped, setStepped] = useState<Readonly<Record<string, Stepped>>>({})
  // The feed's own width says whether cards stand side by side, whatever narrows it: the window, the side sheet.
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const [stacked, setStacked] = useState(false)
  useEffect(() => {
    if (!box) return
    const observer = new ResizeObserver(([entry]) => setStacked((entry?.contentRect.width ?? FEED.most) < FEED.stacked))
    observer.observe(box)
    return () => observer.disconnect()
  }, [box])

  return (
    <div ref={setBox} className="grid w-full min-w-0 grid-cols-1">
      <AnimatePresence initial={false}>
        {groups.map((group, index) => {
          const latest = group.versions[0]
          if (!latest) return null
          const step = stepped[group.key]
          const at =
            step?.latest === latest.key
              ? Math.max(
                  0,
                  group.versions.findIndex((one) => one.key === step.shown)
                )
              : 0
          const version = group.versions[at] ?? latest
          const words = describe(group, version)
          return (
            <motion.article
              key={group.key}
              // The stage finds the answer by its topic, to know which one is in front of the person.
              data-group={group.key}
              layout="position"
              aria-label={words.asked ?? words.said}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE } }}
              exit={{ opacity: 0, transition: { duration: DURATION.quick, ease: EASE } }}
              transition={glide}
              className={cn('group/answer min-w-0 pb-9', index === 0 ? 'border-text border-t-[3px] pt-3' : 'border-line-strong border-t pt-3.5')}
            >
              <AnswerLine
                words={words}
                version={group.versions.length - at}
                versions={group.versions.length}
                onStep={(by) => {
                  const next = group.versions[at + by]
                  if (next) setStepped((was) => ({ ...was, [group.key]: { latest: latest.key, shown: next.key } }))
                }}
                onClose={() => {
                  for (const one of group.versions) for (const view of one.views) onClose(view)
                }}
              />
              <h2 className="mt-3.5 line-clamp-4 max-w-[37.5rem] text-balance font-medium text-[1.5625rem] leading-[1.9375rem] tracking-[-0.015em]">
                {words.said}
              </h2>
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
              {/* Keyed by the version, so stepping to another draws its cards anew rather than morphing these. */}
              <div key={version.key} className="mt-5 grid min-w-0 grid-cols-1">
                {inRows(version.views, stacked).map((row, line) => (
                  <div key={row[0]?.card.id} className={cn('grid min-w-0 grid-cols-12', line > 0 && 'mt-5 border-line border-t pt-5')}>
                    {row.map(({ card, span }, column) => (
                      <section
                        key={card.id}
                        style={{ gridColumn: `span ${span} / span ${span}` }}
                        className={cn('min-w-0', column > 0 && 'border-line border-l pl-5', column < row.length - 1 && 'pr-5')}
                      >
                        <FeedCard
                          view={card}
                          appear={arrived.includes(card.id)}
                          order={line * 3 + column}
                          lit={attended === card.id}
                          actions={actions}
                          onClose={onClose}
                        />
                      </section>
                    ))}
                  </div>
                ))}
              </div>
            </motion.article>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

interface AnswerLineProps {
  words: AnswerWords
  /** The version shown, counted from the first, and how many there are. */
  version: number
  versions: number
  /** Step to an earlier version (1) or back to a later one (-1). */
  onStep(by: 1 | -1): void
  onClose(): void
}

/**
 * The line over an answer: when it was asked for, in what words, the way through its versions when an answer updated
 * it, and, once pointed at, the way to close it.
 */
function AnswerLine({ words, version, versions, onStep, onClose }: AnswerLineProps) {
  return (
    <div className="flex h-5 min-w-0 items-center gap-2.5">
      {words.time && <span className="caps shrink-0 tabular-nums">{words.time}</span>}
      <span title={words.asked} className="min-w-0 flex-1 truncate text-[0.8125rem] text-text-soft">
        {words.asked}
      </span>
      {versions > 1 && (
        <span
          title="An answer that updates this topic takes the place of the one before"
          className="caps flex shrink-0 items-center text-text-soft tabular-nums"
        >
          <StepButton label="Earlier version" disabled={version <= 1} onClick={() => onStep(1)} turn="rotate-90" />
          <span className="px-1">{`V ${version}/${versions}`}</span>
          <StepButton label="Later version" disabled={version >= versions} onClick={() => onStep(-1)} turn="-rotate-90" />
        </span>
      )}
      <button
        type="button"
        aria-label={`Close ${words.asked ?? words.said}`}
        title="Close"
        onClick={onClose}
        className="flex size-5 shrink-0 items-center justify-center text-text-faint opacity-0 transition-[opacity,color] duration-(--duration-quick) ease-soft hover:text-text focus-visible:opacity-100 group-hover/answer:opacity-100 [&_svg]:size-3"
      >
        <CloseGlyph />
      </button>
    </div>
  )
}

function StepButton({ label, disabled, onClick, turn }: { label: string; disabled: boolean; onClick(): void; turn: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-5 items-center justify-center transition-colors duration-(--duration-quick) ease-soft hover:text-text disabled:opacity-35 disabled:hover:text-text-soft [&_svg]:size-3"
    >
      <span className={turn}>
        <ChevronGlyph />
      </span>
    </button>
  )
}

interface FeedCardProps {
  view: ShownView
  /** Whether it comes in: it arrived while the app was open. */
  appear: boolean
  /** Its place among the cards of its answer: each comes in a moment after the one before. */
  order: number
  lit: boolean
  actions(view: ShownView): ViewActions
  onClose(view: ShownView): void
}

/**
 * One card of an answer. Drawn again only when its own view or what it can do changes, not each time the screen
 * around it does (a sentence spoken, a change of mood): a view can be a large tree. It rises a little as it fades
 * in, after the cards before it.
 */
const FeedCard = memo(function FeedCard({ view, appear, order, lit, actions, onClose }: FeedCardProps) {
  const can = useMemo(() => actions(view), [actions, view])
  const [entering] = useState(() => appear && !still())
  return (
    <motion.div
      initial={entering ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE, delay: entering ? 0.12 + order * 0.07 : 0 } }}
      className="min-w-0"
    >
      <ViewCard view={view} actions={can} lit={lit} onClose={() => onClose(view)} />
    </motion.div>
  )
})
