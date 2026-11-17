/**
 * Something a client knows and keeps current: a value that changes over time, with a way to be told when.
 * Every piece of client state has this shape, so an interface reads them all the same way.
 */
export interface Followed<Value> {
  /** The value now. The same object until it changes, so it can be compared by identity. */
  current(): Value
  /** Be told each time `current()` changes. Returns a function that stops the telling. */
  subscribe(listener: () => void): () => void
}

/** A value that can be set, and that tells its listeners when it changes. */
export interface Cell<Value> extends Followed<Value> {
  set(next: Value): void
}

export function cell<Value>(initial: Value): Cell<Value> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    current: () => value,
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    set(next) {
      if (Object.is(next, value)) return
      value = next
      for (const listener of listeners) listener()
    }
  }
}
