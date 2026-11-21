import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn.ts'

const button = cva(
  'caps inline-flex select-none items-center justify-center gap-2 whitespace-nowrap transition-colors duration-(--duration-quick) ease-soft disabled:opacity-45',
  {
    variants: {
      kind: {
        /** The one action a screen is there for: a plane of the ink. */
        primary: 'bg-text text-ground hover:not-disabled:bg-text/85 active:not-disabled:bg-text/70',
        /** A second choice beside the primary one: a line round it. */
        secondary: 'text-text shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:not-disabled:bg-text/[0.08] active:not-disabled:bg-text/[0.14]',
        /** There when wanted, asking for no attention. */
        quiet: 'text-text-soft hover:not-disabled:bg-text/[0.08] hover:not-disabled:text-text active:not-disabled:bg-text/[0.14]'
      },
      size: {
        sm: 'h-6 px-2.5',
        md: 'h-7 px-3',
        lg: 'h-10 px-5'
      }
    },
    defaultVariants: { kind: 'secondary', size: 'md' }
  }
)

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {}

export function Button({ kind, size, type = 'button', className, ...rest }: ButtonProps) {
  return <button type={type} className={cn(button({ kind, size }), className)} {...rest} />
}
