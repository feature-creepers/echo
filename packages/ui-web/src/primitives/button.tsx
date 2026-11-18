import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn.ts'

const button = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition duration-(--duration-quick) ease-soft disabled:opacity-45 active:not-disabled:brightness-90',
  {
    variants: {
      kind: {
        /** The one action a screen is there for. */
        primary: 'bg-accent text-accent-ink shadow-[0_1px_2px_rgb(0_0_0/0.35),inset_0_1px_0_rgb(255_255_255/0.25)] hover:not-disabled:brightness-110',
        /** A second choice beside the primary one. */
        secondary:
          'bg-white/[0.09] text-text shadow-[0_1px_2px_rgb(0_0_0/0.3),inset_0_0_0_0.5px_rgb(255_255_255/0.1),inset_0_1px_0_rgb(255_255_255/0.06)] hover:not-disabled:bg-white/[0.12]',
        /** There when wanted, asking for no attention. */
        quiet: 'text-text-soft hover:not-disabled:bg-white/[0.06] hover:not-disabled:text-text'
      },
      size: {
        sm: 'h-6 rounded-sm px-2.5 text-xs',
        md: 'h-7 rounded-md px-3 text-[0.8125rem]',
        lg: 'h-10 rounded-md px-5 text-sm'
      }
    },
    defaultVariants: { kind: 'secondary', size: 'md' }
  }
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {}

export function Button({ kind, size, type = 'button', className, ...rest }: ButtonProps) {
  return <button type={type} className={cn(button({ kind, size }), className)} {...rest} />
}
