import type { Exchange } from '@repo/protocol'

/**
 * How many times in a row a thread may be woken by the app's restart, to carry its work on by itself, before the
 * person speaks to it again (docs/SPEC.md, section 7.11). A thread that installs a new build of the app it runs in
 * restarts it and is woken again when it opens: with no limit, it could go on for hours, and each time it writes
 * itself what to do next, its work can drift far from what the person asked.
 */
export const RESUMES_WITHOUT_THE_PERSON = 3

/**
 * How many turns in a row a thread took up by itself after a restart, since the person last spoke to it. Each counts
 * once, whether it ended or the next restart cut it short: a turn cut short is kept only as stopped.
 */
export function resumesInARow(transcript: readonly Exchange[], thread: string): number {
  let count = 0
  for (let index = transcript.length - 1; index >= 0; index--) {
    const exchange = transcript[index]
    if (exchange?.thread !== thread) continue
    if (exchange.trigger === undefined) break
    if (exchange.trigger === 'resume') count++
  }
  return count
}

/** What the person last asked a thread, in their words: work it takes up by itself is held to it. */
export function lastRequest(transcript: readonly Exchange[], thread: string): string | undefined {
  for (let index = transcript.length - 1; index >= 0; index--) {
    const exchange = transcript[index]
    if (exchange?.thread === thread && exchange.trigger === undefined && exchange.said.trim() !== '') return exchange.said
  }
  return undefined
}

/** What a thread is told when it is woken after a restart, with what the person asked to hold it to. */
export function wakeRequest(woken: { planned?: string | undefined; cut?: string | undefined; asked?: string | undefined }): string {
  const asked =
    woken.asked !== undefined && woken.asked !== woken.planned && woken.asked !== woken.cut ? `\n\nWhat the person asked, in their words: ${woken.asked}` : ''
  const scope = 'Carry on only with what the person asked, and add nothing they did not ask for. When it is done, stop and report.'
  if (woken.planned !== undefined)
    return `(The app has opened again, as you planned before it restarted. ${scope})${asked}\n\nYour note for now: ${woken.planned}`
  return `(The app restarted while you were working on this: it was updated, or reopened. Your session is new. Check where the work stands, in the files and what you did above, then carry it on to the end without redoing what is done. ${scope})${asked}\n\n${woken.cut ?? ''}`
}
