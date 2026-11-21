import type { ShownView } from '@repo/protocol'
import { AnimatePresence, type MotionStyle, motion } from 'motion/react'
import { type CSSProperties, memo, useEffect, useMemo, useRef, useState } from 'react'
import { useScrollEdges } from '../conversation/scroll-edges.ts'
import { cn } from '../primitives/cn.ts'
import { ChevronGlyph, CloseGlyph } from '../primitives/icons.tsx'
import { DURATION, EASE, glide } from '../styles/motion.ts'
import type { ViewActions } from './context.ts'
import { BOARD, columnsFor, type GroupVersion, groupStream, inColumns, type ViewGroup } from './groups.ts'
import { ViewCard } from './view-card.tsx'

/** What a group says over its cards: when its answer was asked for, and in what words. */
export interface GroupWords {
  time?: string | undefined
  title: string
}

interface ViewBoardProps {
  /** The views to show, newest first. */
  views: readonly ShownView[]
  /** The views that arrived while the app was open: they come in, where the ones read on opening are simply there. */
  arrived: readonly string[]
  /** The view the core looks at, the one it is talking about: it is lit, as by the core's own light. */
  attended?: string | undefined
  /** What the blocks of a view can do. Kept the same between renders, so a card is drawn again only when it changes. */
  actions(view: ShownView): ViewActions
  onClose(view: ShownView): void
  /** What a group's answer is called over its cards. */
  describe(group: ViewGroup, version: GroupVersion): GroupWords
  className?: string | undefined
  style?: MotionStyle | undefined
}

/**
 * Where the board fades out where it is cut: under the header when scrolled, and at its foot, just above the composer,
 * when there is more below. Only where something is cut: a mask costs the compositor while anything moves under it.
 */
const FADES = {
  none: '',
  above: '[mask-image:linear-gradient(to_bottom,transparent,black_12px)]',
  below: '[mask-image:linear-gradient(to_bottom,black_calc(100%-28px),transparent)]',
  both: '[mask-image:linear-gradient(to_bottom,transparent,black_12px,black_calc(100%-28px),transparent)]'
} as const

const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** The version of a group the person stepped back to, good only while the group's latest answer is the same. */
interface Stepped {
  latest: string
  shown: string
}

/**
 * The views of the conversation as a board (docs/SPEC.md, section 13.2): one group for each topic, the group shown
 * last first, in one column no wider than two cards. A group is the cards of the topic's latest answer side by side
 * under a line saying when it was asked and in what words; an answer that updates the topic takes their place, the
 * earlier ones a step back. Only the newest group is open: the others fold to their line until pressed. The board
 * scrolls by itself, and back to its top when a view is put on top.
 */
export function ViewBoard({ views, arrived, attended, actions, onClose, describe, className, style }: ViewBoardProps) {
  const groups = useMemo(() => groupStream(views), [views])
  // What the person chose by hand: a group opened or folded, and an earlier version stepped back to.
  const [chosen, setChosen] = useState<Readonly<Record<string, boolean>>>({})
  const [stepped, setStepped] = useState<Readonly<Record<string, Stepped>>>({})

  // The board's own width says how many cards stand side by side, whatever narrows it: the window, the side sheet.
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const [columns, setColumns] = useState<number>(BOARD.columns)
  useEffect(() => {
    if (!box) return
    const observer = new ResizeObserver(([entry]) => setColumns(columnsFor(entry?.contentRect.width ?? 0)))
    observer.observe(box)
    return () => observer.disconnect()
  }, [box])

  // A view put on top, new or shown again, brings the board back to its top, wherever the person had scrolled to.
  const scroller = useRef<HTMLDivElement | null>(null)
  const shown = useRef(views)
  useEffect(() => {
    const before = shown.current
    shown.current = views
    const top = views[0]
    const was = before[0]
    if (top === undefined || was === undefined || top.id === was.id) return
    if (!before.some((view) => view.id === top.id) || views.some((view) => view.id === was.id))
      scroller.current?.scrollTo({ top: 0, behavior: still() ? 'auto' : 'smooth' })
  }, [views])

  const [watchEdges, edges] = useScrollEdges()
  const fade = FADES[edges.above ? (edges.below ? 'both' : 'above') : edges.below ? 'below' : 'none']

  return (
    <motion.div
      layoutScroll
      ref={(element: HTMLDivElement | null) => {
        scroller.current = element
        watchEdges(element)
      }}
      className={cn('scroll-none overflow-y-auto overscroll-contain', fade, className)}
      {...(style === undefined ? {} : { style })}
    >
      <div ref={setBox} className="mx-auto grid w-full grid-cols-1 gap-1.5" style={{ maxWidth: BOARD.most }}>
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
            const open = chosen[group.key] ?? index === 0
            const words = describe(group, version)
            return (
              <motion.section
                key={group.key}
                layout="position"
                aria-label={words.title}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: DURATION.calm, ease: EASE } }}
                exit={{ opacity: 0, transition: { duration: DURATION.quick, ease: EASE } }}
                transition={glide}
                className="grid min-w-0 grid-cols-1 gap-1"
              >
                <GroupLine
                  words={words}
                  open={open}
                  cards={version.views.length}
                  version={group.versions.length - at}
                  versions={group.versions.length}
                  onToggle={() => setChosen((was) => ({ ...was, [group.key]: !open }))}
                  onStep={(by) => {
                    const next = group.versions[at + by]
                    if (next) setStepped((was) => ({ ...was, [group.key]: { latest: latest.key, shown: next.key } }))
                  }}
                  onClose={() => {
                    for (const one of group.versions) for (const view of one.views) onClose(view)
                  }}
                />
                {open && (
                  // Keyed by the version, so stepping to another draws its cards anew rather than morphing these.
                  <div key={version.key} className="flex min-w-0 items-start" style={{ gap: BOARD.gap }}>
                    {inColumns(version.views, columns).map((stack, column) => (
                      <div key={column} className="grid min-w-0 flex-1 grid-cols-1" style={{ gap: BOARD.gap }}>
                        <AnimatePresence initial={false}>
                          {stack.map((view) => (
                            <BoardCard
                              key={view.id}
                              view={view}
                              appear={arrived.includes(view.id)}
                              lit={attended === view.id}
                              actions={actions}
                              onClose={onClose}
                            />
                          ))}
                        </AnimatePresence>
                      </div>
                    ))}
                  </div>
                )}
              </motion.section>
            )
          })}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

interface GroupLineProps {
  words: GroupWords
  open: boolean
  /** How many cards the version shown has. */
  cards: number
  /** The version shown, counted from the first, and how many there are. */
  version: number
  versions: number
  onToggle(): void
  /** Step to an earlier version (1) or back to a later one (-1). */
  onStep(by: 1 | -1): void
  onClose(): void
}

/**
 * The line over a group: when its answer was asked for and in what words, a press folding or unfolding its cards;
 * the way through its versions when an answer updated it; and, pointed at, the way to close it.
 */
function GroupLine({ words, open, cards, version, versions, onToggle, onStep, onClose }: GroupLineProps) {
  return (
    <div className="group/line flex h-7 min-w-0 items-center gap-1 pl-0.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        title={words.title}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none focus-visible:bg-white/[0.05]"
      >
        <span
          aria-hidden="true"
          className={cn('shrink-0 text-text-faint transition-transform duration-(--duration-quick) ease-soft [&_svg]:size-3', !open && '-rotate-90')}
        >
          <ChevronGlyph />
        </span>
        {words.time && <span className="shrink-0 text-[0.6875rem] text-text-faint tabular-nums">{words.time}</span>}
        <span
          className={cn(
            'min-w-0 truncate text-xs transition-colors duration-(--duration-quick) ease-soft',
            open ? 'font-medium text-text-soft' : 'text-text-faint group-hover/line:text-text-soft'
          )}
        >
          {words.title}
        </span>
        <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-line" />
        {!open && <span className="shrink-0 text-[0.6875rem] text-text-faint tabular-nums">{cards === 1 ? '1 card' : `${cards} cards`}</span>}
      </button>
      {open && versions > 1 && (
        <span className="flex shrink-0 items-center text-[0.6875rem] text-text-faint tabular-nums">
          <StepButton label="Earlier version" disabled={version <= 1} onClick={() => onStep(1)} turn="rotate-90" />
          <span title="An answer that updates this topic takes the place of the one before">{`${version}/${versions}`}</span>
          <StepButton label="Later version" disabled={version >= versions} onClick={() => onStep(-1)} turn="-rotate-90" />
        </span>
      )}
      <button
        type="button"
        aria-label={`Close ${words.title}`}
        title="Close"
        onClick={onClose}
        className="flex size-5 shrink-0 items-center justify-center rounded-sm text-text-faint opacity-0 outline-none transition-[opacity,color] duration-(--duration-quick) ease-soft hover:text-text focus-visible:opacity-100 group-hover/line:opacity-100 [&_svg]:size-3"
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
      className="flex size-5 items-center justify-center rounded-sm outline-none transition-colors duration-(--duration-quick) ease-soft hover:text-text focus-visible:bg-white/[0.06] disabled:opacity-35 disabled:hover:text-text-faint [&_svg]:size-3"
    >
      <span className={turn}>
        <ChevronGlyph />
      </span>
    </button>
  )
}

interface BoardCardProps {
  view: ShownView
  /** Whether it comes in: it arrived while the app was open. */
  appear: boolean
  /** Whether the core looks at it. */
  lit: boolean
  actions(view: ShownView): ViewActions
  onClose(view: ShownView): void
}

/**
 * One card of the board. Drawn again only when its own view or what it can do changes, not each time the screen
 * around it does (a sentence spoken, a change of mood): a view can be a large tree. It comes in growing slightly as
 * it fades in, and fades where it stands when closed.
 */
const BoardCard = memo(function BoardCard({ view, appear, lit, actions, onClose }: BoardCardProps) {
  const can = useMemo(() => actions(view), [actions, view])
  const [entering] = useState(() => appear && !still())
  // The core finds the card by its view, to look at it.
  return (
    <motion.div
      data-view={view.id}
      initial={entering ? { opacity: 0, scale: 0.97 } : false}
      animate={{ opacity: 1, scale: 1, transition: { duration: DURATION.slow, ease: EASE } }}
      exit={{ opacity: 0, transition: { duration: DURATION.quick, ease: EASE } }}
      className="group/card relative min-w-0"
    >
      <ViewCard view={view} actions={can} onClose={() => onClose(view)} />
      {/* The core's light on the card it looks at: its edge in the accent, and a little of the light falling on it
          from above, where the core is. Faintly the same under the pointer, as a card shows it is there to use. Only
          its opacity moves. */}
      <span
        aria-hidden="true"
        style={CORE_LIGHT}
        className={cn(
          'pointer-events-none absolute inset-0 rounded-lg transition-opacity duration-(--duration-slow) ease-soft',
          lit ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-40'
        )}
      />
    </motion.div>
  )
})

/**
 * The light the core casts on a card it looks at: a ring of the accent where the card's hairline is, brightest
 * along its top edge, which faces the core, and a faint wash of the accent falling from the top, gone before the
 * middle of the card, so what is in it reads as it always does.
 */
const CORE_LIGHT: CSSProperties = {
  // The brighter top edge is drawn inside the ring, so it follows the card's rounded corners: a shadow shifted up
  // showed only as two arcs at the top corners.
  boxShadow:
    '0 0 0 1px color-mix(in oklab, var(--accent) 46%, transparent), inset 0 1px 0 0 color-mix(in oklab, var(--accent) 60%, transparent), 0 0 0 2px color-mix(in oklab, var(--accent) 12%, transparent)',
  background: 'radial-gradient(90% 55% at 50% 0%, color-mix(in oklab, var(--accent) 8%, transparent), transparent 75%)'
}
