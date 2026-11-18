import { freemem } from 'node:os'

/** Linux counts what is available, the cache it would give back included: what a program could still be given. */
export const freeMemory = (): number | undefined => freemem()
