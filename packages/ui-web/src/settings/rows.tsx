import type { ReactNode } from 'react'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'

/** A titled group of settings: the title, a rule of the ink under it, then the rows with hairlines between them. */
export function SettingGroup({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-2">
      <div className="flex items-baseline justify-between gap-4">
        <Eyebrow>{title}</Eyebrow>
        {note && <span className="text-right text-text-faint text-xs">{note}</span>}
      </div>
      <div className="divide-y divide-line border-text border-t-2">{children}</div>
    </section>
  )
}

interface SettingRowProps {
  title: string
  /** What the setting does, in a sentence. */
  detail?: ReactNode
  /** The control, on the right; or under the words when `stacked`. */
  children?: ReactNode
  /** The control goes under the words, for one too wide to sit beside them. */
  stacked?: boolean
  /** What went wrong with the setting, in words for the person, under what it does. */
  problem?: string | undefined
}

/** One setting: what it is and what it does on the left, how to set it on the right. */
export function SettingRow({ title, detail, children, stacked = false, problem }: SettingRowProps) {
  return (
    <div className={cn('py-3', stacked ? 'grid gap-3' : 'flex items-center justify-between gap-8')}>
      <div className="grid min-w-0 gap-0.5">
        <span className="text-[0.8125rem]">{title}</span>
        {detail && <span className="max-w-xl text-text-faint text-xs leading-relaxed">{detail}</span>}
        {problem && (
          <span role="alert" className="max-w-xl text-danger text-xs leading-relaxed">
            {problem}
          </span>
        )}
      </div>
      {children !== undefined && <div className={cn('min-w-0', !stacked && 'shrink-0')}>{children}</div>}
    </div>
  )
}

/** What a list says while it holds nothing: a short label, and at most a sentence on how it fills. */
export function EmptyRow({ title, detail }: { title: string; detail?: ReactNode }) {
  return (
    <div className="grid gap-1 py-3">
      <span className="caps text-text-faint">{title}</span>
      {detail && <span className="max-w-xl text-text-faint text-xs leading-relaxed">{detail}</span>}
    </div>
  )
}

/** A page's list while it holds nothing yet: a hatched plane, with what fills it said on the ground in its middle. */
export function EmptyPlane({ children }: { children: ReactNode }) {
  return (
    <div className="hatch grid place-items-center px-6 py-8 text-line">
      <div className="grid max-w-md gap-1 bg-ground px-4 py-3 text-center text-text-soft text-xs leading-relaxed">{children}</div>
    </div>
  )
}
