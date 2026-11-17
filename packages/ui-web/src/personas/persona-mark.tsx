import { classes } from '../primitives/classes.ts'
import styles from './persona-mark.module.css'

export interface PersonaMarkProps {
  size: 'small' | 'large'
  /** Breathes slowly, as the persona that is present does. */
  alive?: boolean
}

/** The mark of a persona, in whatever accent surrounds it. It is decoration: the name beside it says who it is. */
export function PersonaMark({ size, alive = false }: PersonaMarkProps) {
  return <span aria-hidden="true" className={classes(styles.mark, styles[size], alive && styles.alive)} />
}
