/**
 * Files' contents, kept by their hash: the same content is kept once, and a record refers to a hash, never to
 * a path on one machine (docs/SPEC.md, section 5.2).
 */
export interface Blobs {
  /** Keep these bytes and return their SHA-256, in hexadecimal. */
  put(bytes: Uint8Array): string
  /** The bytes with this hash, or nothing when they are not here. */
  get(hash: string): Uint8Array | undefined
  /** Let go of the bytes with this hash, where a store can: versions of files kept for undo, once they expire. */
  remove?(hash: string): void
}
