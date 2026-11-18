/**
 * macOS counts as free only the pages nothing has ever touched. It keeps nearly all the rest as cache and as memory
 * it would give back, so that count is a few hundred megabytes on a computer at rest, and would read as one that
 * has run out. What is really to be had is not in what Node reports: it is left unknown, and memory does not count
 * in the load there.
 */
export const freeMemory = (): number | undefined => undefined
