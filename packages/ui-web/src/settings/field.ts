import { cn } from '../primitives/cn.ts'

/** A field the person types in: a line round a plane, in the full ink while it has the keyboard, in the danger colour while what it holds is wrong. */
export const FIELD =
  'border border-line-strong bg-surface text-text transition-colors duration-(--duration-quick) ease-soft placeholder:text-text-faint focus-visible:border-text focus-visible:outline-none aria-invalid:border-danger'

/** A small field in a line of words: a time, a date, a number. */
export const SMALL_FIELD = cn(FIELD, 'h-7 px-2.5 text-[0.8125rem] tabular-nums [color-scheme:dark]')

/** A field for a few lines of text. */
export const TEXT_AREA = cn(FIELD, 'w-full resize-none px-3 py-2 text-[0.8125rem] leading-relaxed')
