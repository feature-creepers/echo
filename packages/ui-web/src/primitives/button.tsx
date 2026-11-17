import type { ButtonHTMLAttributes } from 'react'
import styles from './button.module.css'
import { classes } from './classes.ts'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` is the one action a screen is there for; `quiet` is everything else. */
  kind?: 'primary' | 'quiet'
}

export function Button({ kind = 'quiet', type = 'button', className, ...rest }: ButtonProps) {
  return <button type={type} className={classes(styles.button, styles[kind], className)} {...rest} />
}
