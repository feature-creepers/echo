import { cn } from '../primitives/cn.ts'
import { ArrowGlyph } from '../primitives/icons.tsx'

/** The arrow at the end of a link that opens something else, leaning towards it under the pointer: the link is the `group`. */
export function GoArrow({ className }: { className?: string }) {
  return (
    <span className={cn('shrink-0 transition-transform duration-(--duration-quick) ease-soft group-hover:translate-x-0.5 [&_svg]:size-3', className)}>
      <ArrowGlyph />
    </span>
  )
}
