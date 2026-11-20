import type { ReactNode } from 'react'
import { cn } from '../primitives/cn.ts'
import { Eyebrow } from '../primitives/eyebrow.tsx'

/** A titled group of settings: the title above, the rows in one panel with hairlines between them. */
export function SettingGroup({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-2">
      <div className="flex items-baseline justify-between gap-4 px-0.5">
        <Eyebrow className="font-semibold text-text-soft">{title}</Eyebrow>
        {note && <span className="text-right text-text-faint text-xs">{note}</span>}
      </div>
      <div className="divide-y divide-white/[0.06] overflow-hidden rounded-lg bg-raised/95 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]">{children}</div>
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
    <div className={cn('px-4 py-3', stacked ? 'grid gap-3' : 'flex items-center justify-between gap-8')}>
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
