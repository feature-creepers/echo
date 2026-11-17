import type { ReactNode } from 'react'
import { IconButton } from './icon-button.tsx'
import { CloseGlyph } from './icons.tsx'

export interface ScreenHeaderProps {
  title: string
  /** A line under the title: a count, a state. */
  detail?: ReactNode
  /** What the close button says it closes, for a screen reader and as its tooltip. */
  closeLabel: string
  onClose(): void
}

/**
 * The top of a screen that covers the main one, such as the settings or the library: its title on the left, the
 * button that closes it on the right, level with the title. Escape closes it too; the button is the one hint.
 */
export function ScreenHeader({ title, detail, closeLabel, onClose }: ScreenHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="grid min-w-0 gap-1">
        <h1 className="truncate font-semibold text-[1.375rem] leading-8 tracking-[-0.02em]">{title}</h1>
        {detail && <p className="text-[0.8125rem] text-text-soft">{detail}</p>}
      </div>
      <IconButton label={closeLabel} onClick={onClose} className="mt-0.5 size-7">
        <CloseGlyph />
      </IconButton>
    </div>
  )
}
