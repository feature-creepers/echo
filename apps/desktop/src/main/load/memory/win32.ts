import { freemem } from 'node:os'

/** Windows counts the physical memory that is available, which is what a program could still be given. */
export const freeMemory = (): number | undefined => freemem()
