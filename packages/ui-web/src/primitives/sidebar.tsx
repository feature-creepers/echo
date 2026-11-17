import type { ReactNode } from 'react'
import { cn } from './cn.ts'

export interface SidebarProps {
  /** The name of the screen, at the top of the pane. */
  title: string
  /** What the list is, for a screen reader. */
  label: string
  children: ReactNode
}

/**
 * The pane down the left of a screen that covers the main one, as in native split views: the screen's name,
 * then its list. Where the window has the system's material behind the page, it shows through here.
 */
export function Sidebar({ title, label, children }: SidebarProps) {
  return (
    <nav
      aria-label={label}
      className="sidebar scroll-quiet grid w-56 shrink-0 content-start gap-5 overflow-y-auto border-black/45 border-r px-2.5 pt-5 pb-8 shadow-[1px_0_0_rgb(255_255_255/0.035)]"
    >
      <h2 className="px-2.5 font-semibold text-[0.9375rem] tracking-[-0.01em]">{title}</h2>
      {children}
    </nav>
  )
}

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
      aria-current={on}
      onClick={onClick}
      className={cn(
        'flex h-7 items-center justify-between gap-3 rounded-md px-2.5 text-left text-[0.8125rem] transition-colors duration-(--duration-quick) ease-soft',
        on ? 'bg-white/[0.1] text-text' : 'text-text-soft hover:bg-white/[0.04] hover:text-text'
      )}
    >
      <span className="truncate">{children}</span>
      {detail !== undefined && <span className={cn('text-xs tabular-nums', on ? 'text-text-soft' : 'text-text-faint')}>{detail}</span>}
    </button>
  )
}
