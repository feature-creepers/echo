import { motion } from 'motion/react'
import { type ReactNode, useEffect, useRef, useState, type WheelEvent } from 'react'
import { cn } from '../primitives/cn.ts'
import { HUB_SIDE, hubTurn } from './now.ts'
import { type NowTab, ProgressMark, standing } from './now-tabs.tsx'

/** The hub's drawing, in pixels: its box, the eye's centre and size, where the spokes end, and how far apart they stand. */
const HUB = { width: 656, height: 214, x: 328, y: 100, eye: 108, left: 209, right: 447, middle: 91, apart: 46 } as const

/** The width the hub needs: under it, the main screen shows the eye and the tabs alone. */
export const HUB_WIDTH = HUB.width

/** How far a sideways swipe must travel, in pixels, to turn the hub. */
const TURN_AFTER = 70

const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Where the spokes of one side end, from the top: spread evenly about the eye's height. */
const heights = (count: number) => Array.from({ length: count }, (_, at) => HUB.middle + (at - (count - 1) / 2) * HUB.apart)

interface Spoke {
  side: 'left' | 'right'
  x: number
  y: number
  tab: NowTab | undefined
}

interface NowHubProps {
  /** The topics in progress, what needs the person first. */
  tabs: readonly NowTab[]
  /** The topic whose island leads the page. */
  selected: string | undefined
  /** The topic the person picked, here or elsewhere: the hub turns to it when it is on another turn of it. */
  picked: string | undefined
  onPick(topic: string): void
  /** The eye, drawn at a size. */
  eye(size: number): ReactNode
  /** What stands under the eye: its name and what it is doing. */
  children: ReactNode
}

/**
 * The hub at the top of the main screen (docs/SPEC.md, section 13.2): the eye in the middle and the topics in progress
 * on spokes around it, each with its number, how it stands and its name. The spoke of the topic whose island leads is
 * in the accent; along the spoke of a topic at work a small square travels to the eye. Up to eight topics stand on it;
 * with more, the last spoke turns it to the next ones, and so does a sideways swipe.
 */
export function NowHub({ tabs, selected, picked, onPick, eye, children }: NowHubProps) {
  const [turn, setTurn] = useState(0)
  const { left, right, more } = hubTurn(tabs.length, turn)
  // It turns to the topic picked elsewhere when that one is on another turn of it.
  const at = tabs.findIndex((tab) => tab.topic.id === picked)
  useEffect(() => {
    if (at >= 0 && tabs.length > 2 * HUB_SIDE) setTurn(Math.floor(at / (2 * HUB_SIDE - 1)))
  }, [at, tabs.length])
  const swiped = useRef(0)
  const onWheel = (event: WheelEvent) => {
    if (more === 0 || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
    swiped.current += event.deltaX
    if (Math.abs(swiped.current) < TURN_AFTER) return
    setTurn((was) => was + (swiped.current > 0 ? 1 : -1))
    swiped.current = 0
  }

  const spokes: Spoke[] = [
    ...heights(left.length).map((y, index): Spoke => ({ side: 'left', x: HUB.left, y, tab: tabs[left[index] ?? -1] })),
    // The spoke that turns the hub stands last on the right.
    ...heights(right.length + (more > 0 ? 1 : 0)).map((y, index): Spoke => ({ side: 'right', x: HUB.right, y, tab: tabs[right[index] ?? -1] }))
  ]

  return (
    <div onWheel={onWheel} className="relative shrink-0" style={{ width: HUB.width, height: HUB.height }}>
      <svg aria-hidden="true" viewBox={`0 0 ${HUB.width} ${HUB.height}`} fill="none" className="absolute inset-0 size-full text-text">
        {spokes.map(({ x, y, tab }) => {
          const on = tab !== undefined && tab.topic.id === selected
          // Where the spoke meets the eye's ring: what travels along it stops there.
          const reach = 1 - (HUB.eye / 2 + 6) / Math.hypot(HUB.x - x, HUB.y - y)
          return (
            <g key={tab?.topic.id ?? 'more'}>
              <line
                x1={x}
                y1={y}
                x2={HUB.x}
                y2={HUB.y}
                className={on ? 'stroke-accent' : 'stroke-line-strong'}
                strokeWidth={on ? 1.5 : 1}
                strokeDasharray={tab ? undefined : '3 3'}
              />
              {tab?.topic.progress === 'working' && !still() && (
                <motion.rect
                  x={x - 1.5}
                  y={y - 1.5}
                  width={3}
                  height={3}
                  className="fill-accent"
                  initial={{ x: 0, y: 0, opacity: 0 }}
                  animate={{ x: (HUB.x - x) * reach, y: (HUB.y - y) * reach, opacity: [0, 1, 1, 0] }}
                  transition={{ duration: 2.2, ease: 'linear', repeat: Number.POSITIVE_INFINITY, repeatDelay: 0.4 }}
                />
              )}
              {tab ? (
                <rect x={x - 3} y={y - 3} width={6} height={6} className={on ? 'fill-accent' : 'fill-ground stroke-text/50'} />
              ) : (
                <>
                  <rect x={x - 6} y={y - 6} width={12} height={12} className="fill-ground stroke-text/60" />
                  <path d={`M${x - 3} ${y}h6M${x} ${y - 3}v6`} stroke="currentColor" />
                </>
              )}
            </g>
          )
        })}
        {/* The eye stands on a disc of the ground, so no spoke runs under its lines. */}
        <circle cx={HUB.x} cy={HUB.y} r={HUB.eye / 2 + 4} className="fill-ground" />
      </svg>
      <span className="absolute" style={{ left: HUB.x - HUB.eye / 2, top: HUB.y - HUB.eye / 2 }}>
        {eye(HUB.eye)}
      </span>
      {spokes.map(({ side, y, tab }) => {
        const on = tab !== undefined && tab.topic.id === selected
        return (
          <button
            key={tab?.topic.id ?? 'more'}
            type="button"
            aria-current={on ? 'true' : undefined}
            onClick={() => (tab ? onPick(tab.topic.id) : setTurn((was) => was + 1))}
            className={cn('group absolute grid max-w-[11.5rem] gap-px', side === 'left' ? 'justify-items-end text-right' : 'justify-items-start text-left')}
            style={{ top: y - 16, ...(side === 'left' ? { right: HUB.width - HUB.left + 9 } : { left: HUB.right + 9 }) }}
          >
            <span className="caps flex items-center gap-[5px] text-text-soft">
              {tab && <ProgressMark progress={tab.topic.progress} />}
              {tab ? standing(tab) : 'Turn the hub'}
            </span>
            <span
              className={cn(
                'display max-w-full truncate text-lg leading-[1.0625rem] transition-colors duration-(--duration-quick) ease-soft group-hover:text-text',
                on ? 'text-text' : tab ? 'text-text-faint' : 'text-text-soft'
              )}
            >
              {tab ? tab.topic.title : `${more} more`}
            </span>
          </button>
        )
      })}
      <div className="absolute inset-x-0 bottom-1 flex items-center justify-center gap-[7px]">{children}</div>
    </div>
  )
}
