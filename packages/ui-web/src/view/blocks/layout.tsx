import type { BlockProps } from '@repo/catalog'
import type { ReactNode } from 'react'
import { cn } from '../../primitives/cn.ts'
import { Eyebrow } from '../../primitives/eyebrow.tsx'

/** The three spacings a view is laid out with. One scale for every block, so views read as one family. */
const GAP = { tight: 'gap-1', normal: 'gap-2', loose: 'gap-3' } as const

export function Stack({ props, children }: { props: BlockProps<'Stack'>; children: ReactNode }) {
  const align = { start: 'items-start', center: 'items-center', end: 'items-end', stretch: 'items-stretch' }[props.align]
  return <div className={cn('flex min-w-0 flex-col', GAP[props.gap], align)}>{children}</div>
}

export function Row({ props, children }: { props: BlockProps<'Row'>; children: ReactNode }) {
  const align = { start: 'items-start', center: 'items-center', end: 'items-end', baseline: 'items-baseline' }[props.align]
  const justify = { start: 'justify-start', center: 'justify-center', end: 'justify-end', between: 'justify-between' }[props.justify]
  // A row always wraps when there is no room: a view is drawn in places of every width.
  return <div className={cn('flex min-w-0 flex-wrap', GAP[props.gap], align, justify)}>{children}</div>
}

/** Tiles sit closer than the blocks of a stack, so they read as one set, in pixels. */
const TILE_GAP = { tight: 4, normal: 6, loose: 8 } as const

export function Grid({ props, children }: { props: BlockProps<'Grid'>; children: ReactNode }) {
  // Tiles never get narrower than about nine characters: the grid takes fewer columns instead. The columns asked
  // for fit with the very gap drawn between them.
  const gap = TILE_GAP[props.gap]
  return (
    <div
      className="grid min-w-0"
      style={{
        gap,
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, max(7.5rem, calc((100% - ${(props.columns - 1) * gap}px) / ${props.columns}))), 1fr))`
      }}
    >
      {children}
    </div>
  )
}

export function Card({ props, children }: { props: BlockProps<'Card'>; children: ReactNode }) {
  const accent = props.emphasis === 'accent'
  return (
    <div
      className={cn(
        'grid min-w-0 content-start gap-2 overflow-hidden border px-3 py-2.5',
        accent ? 'border-accent/35 bg-accent/[0.045]' : 'border-line bg-text/[0.018]'
      )}
    >
      {(props.title || props.subtitle) && (
        <div className="grid gap-0.5">
          {props.title && <h3 className="font-medium text-[0.8125rem] leading-snug">{props.title}</h3>}
          {props.subtitle && <p className="text-text-soft text-xs leading-snug">{props.subtitle}</p>}
        </div>
      )}
      {children}
    </div>
  )
}

export function Section({ props, children }: { props: BlockProps<'Section'>; children: ReactNode }) {
  return (
    <section className="grid min-w-0 gap-1.5">
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
