import type { ReactNode } from 'react'

export interface ScreenHeaderProps {
  title: string
  /** A line under the title: a count, a state. */
  detail?: ReactNode
}

/**
 * The top of a page of a screen that covers the main one: its title at the top left. The way back is the screen's
 * own, at the top of its sidebar, so the page carries no close button.
 */
export function ScreenHeader({ title, detail }: ScreenHeaderProps) {
  return (
    <div className="grid min-w-0 gap-1">
      <h1 className="truncate font-semibold text-[1.375rem] leading-8 tracking-[-0.02em]">{title}</h1>
      {detail && <p className="text-[0.8125rem] text-text-soft">{detail}</p>}
    </div>
  )
}
