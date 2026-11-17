import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn.ts'

const button = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition duration-(--duration-quick) ease-soft disabled:opacity-45 active:not-disabled:translate-y-px',
  {
    variants: {
      kind: {
        /** The one action a screen is there for. */
        primary: 'bg-accent text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.25)] hover:not-disabled:brightness-110',
        /** A second choice beside the primary one. */
        secondary:
          'border border-line-strong bg-raised text-text shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] hover:not-disabled:border-text-faint/60 hover:not-disabled:bg-overlay',
        /** There when wanted, asking for no attention. */
        quiet: 'text-text-soft hover:not-disabled:bg-raised hover:not-disabled:text-text'
      },
      size: {
        sm: 'h-7 rounded-sm px-2.5 text-xs',
        md: 'h-8 rounded-md px-3.5 text-[0.8125rem]',
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
