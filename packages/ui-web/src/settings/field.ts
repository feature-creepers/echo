import { cn } from '../primitives/cn.ts'

/** A field the person types in: dark and inset under a hairline, its border in the danger colour while what it holds is wrong. */
export const FIELD =
  'rounded-md border border-line-strong bg-black/25 text-text shadow-[inset_0_1px_1px_rgb(0_0_0/0.25)] transition duration-(--duration-quick) ease-soft placeholder:text-text-faint aria-invalid:border-danger'

/** A small field in a line of words: a time, a date, a number. */
export const SMALL_FIELD = cn(FIELD, 'h-7 px-2.5 text-[0.8125rem] tabular-nums [color-scheme:dark]')

/** A field for a few lines of text. */
export const TEXT_AREA = cn(FIELD, 'w-full resize-none px-3 py-2 text-[0.8125rem] leading-relaxed')
