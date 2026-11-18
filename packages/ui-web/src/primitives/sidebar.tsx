import type { ReactNode } from 'react'
import { cn } from './cn.ts'
import { BackGlyph } from './icons.tsx'

export interface SidebarProps {
  /** What the list is, for a screen reader. */
  label: string
  /** The way back to where the screen was opened from, at the top of the pane. */
  back?: { label: string; onBack(): void } | undefined
  /** What stands apart at the bottom of the pane. */
  footer?: ReactNode
  children: ReactNode
}

/**
 * The pane down the left of a screen that covers the main one, as in native split views: the way back at its top,
 * then its groups, and what stands apart at its bottom. It has no fill of its own: the window's ground runs under
 * it, and a hairline sets it apart.
 */
export function Sidebar({ label, back, footer, children }: SidebarProps) {
  return (
    <nav
      aria-label={label}
      className="scroll-quiet flex w-56 shrink-0 flex-col gap-5 overflow-y-auto border-black/45 border-r px-2.5 pt-3 pb-4 shadow-[1px_0_0_rgb(255_255_255/0.035)]"
    >
      {back && (
        <button
          type="button"
          onClick={back.onBack}
          className={cn(ROW, 'gap-1.5 pl-1.5 text-text-soft hover:bg-white/[0.04] hover:text-text active:bg-white/[0.07]')}
        >
          <span className="text-text-faint transition-colors duration-(--duration-quick) group-hover:text-text-soft [&_svg]:size-3.5">
            <BackGlyph />
          </span>
          <span className="truncate">{back.label}</span>
        </button>
      )}
      {children}
      {footer && <div className="mt-auto grid gap-px pt-2">{footer}</div>}
    </nav>
  )
}

/** A group of entries under a small title. */
export function SidebarGroup({ title, children }: { title?: string | undefined; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset is for a form's controls; this is a list of places, named for a screen reader.
    <div role="group" aria-label={title} className="grid gap-px">
      {title && (
        <span aria-hidden="true" className="mb-0.5 px-2.5 font-semibold text-[0.6875rem] text-text-faint">
          {title}
        </span>
      )}
      {children}
    </div>
  )
}

/** The shape every row of a sidebar shares: the back row and the entries. */
const ROW = 'group flex h-7 shrink-0 items-center rounded-md px-2.5 text-left text-[0.8125rem] transition-colors duration-(--duration-quick) ease-soft'

export interface SidebarItemProps {
  on: boolean
  onClick(): void
  /** A count or a state, on the right. */
  detail?: ReactNode
  children: ReactNode
}

/** One entry of a sidebar: the chosen one sits on a quiet raised row, as macOS marks a selection in a sidebar. */
export function SidebarItem({ on, onClick, detail, children }: SidebarItemProps) {
  return (
    <button
      type="button"
      aria-current={on ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        ROW,
        'justify-between gap-3',
        on ? 'bg-white/[0.1] text-text' : 'text-text-soft hover:bg-white/[0.04] hover:text-text active:bg-white/[0.07]'
      )}
    >
      <span className="truncate">{children}</span>
      {detail !== undefined && <span className={cn('text-xs tabular-nums', on ? 'text-text-soft' : 'text-text-faint')}>{detail}</span>}
    </button>
  )
}
