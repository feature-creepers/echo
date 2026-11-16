import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Accept exactly one token: the one given to the core when it started.
 *
 * Both sides are hashed first so the comparison takes the same time whatever the candidate's length
 * or content, and a wrong guess learns nothing from how long the answer took.
 */
export function localToken(expected: string): (candidate: string) => boolean {
  const digest = (text: string) => createHash('sha256').update(text).digest()
  const wanted = digest(expected)
  return (candidate) => timingSafeEqual(digest(candidate), wanted)
}
