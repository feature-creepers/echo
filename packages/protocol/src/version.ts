/**
 * The version of the messages in this package.
 *
 * It goes up when a change would break a peer built against the previous version: a field removed
 * or given a new meaning, a message a peer must understand. Adding an optional field does not count.
 */
export const PROTOCOL_VERSION = 1

/** Whether a peer speaking `theirs` can talk to this build. Only the same version, until there is a second one to bridge. */
export function isCompatible(theirs: number): boolean {
  return theirs === PROTOCOL_VERSION
}
