import type { BlockProps } from '@repo/catalog'
import type { ReactNode } from 'react'
import { cn } from '../../primitives/cn.ts'
import { Eyebrow } from '../../primitives/eyebrow.tsx'

/** The three spacings a view is laid out with. One scale for every block, so views read as one family. */
const GAP = { tight: 'gap-1', normal: 'gap-2', loose: 'gap-3' } as const

/**
 * Blocks side by side are parted by a vertical hairline in the middle of the room between them, never boxed. The line
 * hangs before each block, so the one that starts a line, wrapped or not, has its line cut off by the clip, which
 * still leaves room for a focus ring. Buttons and labels in a row are not parted.
 */
const PARTED =
  '[clip-path:inset(-200rem_-200rem_-200rem_-4px)] [&>:not(button):not(span)]:relative [&>:not(button):not(span)]:before:absolute [&>:not(button):not(span)]:before:inset-y-0 [&>:not(button):not(span)]:before:w-px [&>:not(button):not(span)]:before:bg-line'

/** The room between blocks side by side, and where their hairline falls: half way. */
const ROOM = {
  tight: 'gap-x-4 gap-y-2 [&>:not(button):not(span)]:before:-left-2',
  normal: 'gap-x-6 gap-y-3 [&>:not(button):not(span)]:before:-left-3',
  loose: 'gap-x-8 gap-y-4 [&>:not(button):not(span)]:before:-left-4'
} as const

export function Stack({ props, children }: { props: BlockProps<'Stack'>; children: ReactNode }) {
  const align = { start: 'items-start', center: 'items-center', end: 'items-end', stretch: 'items-stretch' }[props.align]
  return <div className={cn('flex min-w-0 flex-col', GAP[props.gap], align)}>{children}</div>
}

export function Row({ props, children }: { props: BlockProps<'Row'>; children: ReactNode }) {
  const align = { start: 'items-start', center: 'items-center', end: 'items-end', baseline: 'items-baseline' }[props.align]
  const justify = { start: 'justify-start', center: 'justify-center', end: 'justify-end', between: 'justify-between' }[props.justify]
  // A row always wraps when there is no room: a view is drawn in places of every width. Buttons sit closer.
  return <div className={cn('flex min-w-0 flex-wrap has-[>button]:gap-x-2', PARTED, ROOM[props.gap], align, justify)}>{children}</div>
}

/** The room between tiles, in pixels, as the classes of `ROOM` set it. */
const TILE_GAP = { tight: 16, normal: 24, loose: 32 } as const

export function Grid({ props, children }: { props: BlockProps<'Grid'>; children: ReactNode }) {
  // Tiles never get narrower than about nine characters: the grid takes fewer columns instead. The columns asked
  // for fit with the very gap drawn between them.
  const gap = TILE_GAP[props.gap]
  return (
    <div
      className={cn('grid min-w-0', PARTED, ROOM[props.gap])}
      style={{
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, max(7.5rem, calc((100% - ${(props.columns - 1) * gap}px) / ${props.columns}))), 1fr))`
      }}
    >
      {children}
    </div>
  )
}

export function Card({ props, children }: { props: BlockProps<'Card'>; children: ReactNode }) {
  // A group under a rule, not a box: the one that matters most is under a rule of the full ink.
  return (
    <div className={cn('grid min-w-0 content-start gap-2 pt-2', props.emphasis === 'accent' ? 'border-text border-t-2' : 'border-line-strong border-t')}>
      {(props.title || props.subtitle) && (
        <div className="grid gap-0.5">
          {props.title && <h3 className="font-semibold text-[0.8125rem] leading-snug">{props.title}</h3>}
          {props.subtitle && <p className="text-text-soft text-xs leading-snug">{props.subtitle}</p>}
        </div>
      )}
      {children}
    </div>
  )
}

export function Section({ props, children }: { props: BlockProps<'Section'>; children: ReactNode }) {
  return (
    <section className="grid min-w-0 gap-2">
      <div className="grid gap-0.5">
        <Eyebrow>{props.title}</Eyebrow>
        {props.description && <p className="text-text-soft text-xs leading-snug">{props.description}</p>}
      </div>
      {children}
    </section>
  )
}

export function Divider() {
  return <hr className="border-line border-t" />
}
