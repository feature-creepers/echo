/**
 * Time that passes, as the core needs it: to do something later. The core runs anywhere, so it is given
 * the timers of the place it runs in rather than reaching for them.
 */
export interface Timers {
  /** Run `work` once, after `ms` milliseconds. Returns a function that cancels it, which does nothing once it ran. */
  after(ms: number, work: () => void): () => void
}
