/**
 * Runs pieces of work one at a time, in the order they were given. An engine holds one model and one set
 * of working memory: two requests at once would share them.
 */
export interface Serial {
  /** Run `work` after everything given before it, and resolve or reject as it does. */
  run<Outcome>(work: () => Promise<Outcome> | Outcome): Promise<Outcome>
}

export function createSerial(): Serial {
  let last: Promise<unknown> = Promise.resolve()
  return {
    run(work) {
      const outcome = last.then(() => work())
      // A piece of work that fails must not stop the ones behind it.
      last = outcome.catch(() => undefined)
      return outcome
    }
  }
}
