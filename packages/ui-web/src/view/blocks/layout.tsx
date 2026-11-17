import type { BlockProps } from '@repo/catalog'
import type { ReactNode } from 'react'
import { cn } from '../../primitives/cn.ts'
import { Eyebrow } from '../../primitives/eyebrow.tsx'

const GAP = { tight: 'gap-2', normal: 'gap-4', loose: 'gap-7' } as const

export function Stack({ props, children }: { props: BlockProps<'Stack'>; children: ReactNode }) {
  const align = { start: 'items-start', center: 'items-center', end: 'items-end', stretch: 'items-stretch' }[props.align]
  return <div className={cn('flex min-w-0 flex-col', GAP[props.gap], align)}>{children}</div>
}

export function Row({ props, children }: { props: BlockProps<'Row'>; children: ReactNode }) {
  const align = { start: 'items-start', center: 'items-center', end: 'items-end', baseline: 'items-baseline' }[props.align]
  const justify = { start: 'justify-start', center: 'justify-center', end: 'justify-end', between: 'justify-between' }[props.justify]
  return <div className={cn('flex min-w-0', GAP[props.gap], align, justify, props.wrap && 'flex-wrap')}>{children}</div>
}

export function Grid({ props, children }: { props: BlockProps<'Grid'>; children: ReactNode }) {
  // Tiles never get narrower than about twelve characters: the grid takes fewer columns instead.
  return (
    <div
      className={cn('grid min-w-0', GAP[props.gap])}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(max(10rem, calc((100% - ${props.columns - 1} * 1rem) / ${props.columns})), 1fr))` }}
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
        'grid min-w-0 content-start gap-4 rounded-lg border bg-surface/80 p-5 backdrop-blur-sm',
        accent ? 'border-accent/45 shadow-[0_0_60px_-30px_var(--accent)]' : 'border-line'
      )}
    >
      {(props.title || props.subtitle) && (
        <div className="grid gap-0.5">
          {props.title && <h3 className="font-medium text-base">{props.title}</h3>}
          {props.subtitle && <p className="text-sm text-text-soft">{props.subtitle}</p>}
        </div>
      )}
      {children}
    </div>
  )
}

export function Section({ props, children }: { props: BlockProps<'Section'>; children: ReactNode }) {
  return (
    <section className="grid min-w-0 gap-3">
      <div className="grid gap-1">
        <Eyebrow accent>{props.title}</Eyebrow>
        {props.description && <p className="text-sm text-text-soft">{props.description}</p>}
      </div>
      {children}
    </section>
  )
}

export function Divider() {
  return <hr className="border-line border-t" />
}
