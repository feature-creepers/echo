import { classes } from '../primitives/classes.ts'
import styles from './notice.module.css'

export interface NoticeProps {
  title: string
  detail?: string
  /** Something went wrong, as opposed to something being under way. */
  problem?: boolean
}

/** What fills the window when there is nothing else to show: the app is starting, or it could not. */
export function Notice({ title, detail, problem = false }: NoticeProps) {
  return (
    <div className={classes(styles.notice, problem && styles.problem)} role={problem ? 'alert' : 'status'}>
      <p className={styles.title}>{title}</p>
      {detail !== undefined && <p className={styles.detail}>{detail}</p>}
    </div>
  )
}
