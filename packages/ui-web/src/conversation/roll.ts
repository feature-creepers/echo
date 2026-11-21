/** Words whose tops are this close, in px, are on the same line: a measure in fractions of a pixel never splits one. */
const SAME_LINE = 1

/**
 * How far up a sentence rolls, in px, so that the line the voice is on is the last line shown: the lines already
 * said leave at the top as the voice goes on to the next one, and a sentence of no more lines than are `shown` never
 * moves. `tops` is where each word's last line starts, in order (a word broken at a hyphen is on the line it ends
 * on); `reached` is how many words the voice has reached.
 */
export function rollOf(tops: readonly number[], reached: number, shown: number): number {
  const lines: number[] = []
  for (const top of [...tops].sort((above, below) => above - below)) {
    const last = lines.at(-1)
    if (last === undefined || top - last > SAME_LINE) lines.push(top)
  }
  const first = lines[0]
  if (first === undefined) return 0
  // Before the first word, the voice is on the first line; past the last, on the last.
  const word = tops[Math.min(Math.max(reached, 1), tops.length) - 1] ?? first
  const on = lines.findLastIndex((line) => line <= word + SAME_LINE)
  return (lines[Math.max(0, on - shown + 1)] ?? first) - first
}
