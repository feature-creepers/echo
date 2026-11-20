/**
 * DPAPI ties the key to the person's Windows account: other programs the same person runs can open it, other people
 * on the computer cannot. It is always there.
 */
export const keyringProblem = (): string | undefined => undefined
