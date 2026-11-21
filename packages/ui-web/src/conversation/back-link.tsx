import type { ReactNode } from 'react'
import { BackGlyph } from '../primitives/icons.tsx'

/** The way back from a place in the side sheet to where it was opened from, in capitals after an arrow. */
export function BackLink({ onClick, children }: { onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="caps flex w-fit shrink-0 items-center gap-1 text-text-soft transition-colors duration-(--duration-quick) ease-soft hover:text-text [&_svg]:size-3.5"
    >
      <BackGlyph /> {children}
    </button>
  )
}
