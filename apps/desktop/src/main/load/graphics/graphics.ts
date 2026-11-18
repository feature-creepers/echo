/** The graphics card's use, as one system reports it, read in the background while it is followed. */
export interface Graphics {
  /** The latest reading, from 0 to 1, or nothing while none has come or the system does not say. */
  latest(): number | undefined
  /** Stop reading, and let go of whatever reads. */
  stop(): void
}
