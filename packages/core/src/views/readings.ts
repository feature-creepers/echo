/**
 * Readings of web addresses, kept so that every view naming an address shares one reading. The `most` latest used are
 * kept, each for `freshMs` when it is given; a failure is not kept, since the address may answer the next time.
 */
export function keptReadings<Reading extends { ok: boolean }>(
  most: number,
  fresh?: { ms: number; now: () => Date }
): (url: string, read: () => Promise<Reading>) => Promise<Reading> {
  const kept = new Map<string, { at: number; reading: Promise<Reading> }>()
  return (url, read) => {
    const at = fresh?.now().getTime() ?? 0
    const known = kept.get(url)
    kept.delete(url)
    if (known && (fresh === undefined || at - known.at < fresh.ms)) {
      kept.set(url, known)
      return known.reading
    }
    const reading = read()
    kept.set(url, { at, reading })
    void reading.then((answer) => {
      if (!answer.ok && kept.get(url)?.reading === reading) kept.delete(url)
    })
    while (kept.size > most) kept.delete(kept.keys().next().value as string)
    return reading
  }
}
