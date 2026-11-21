import type { Persona } from '@repo/protocol'

/**
 * The personas a new user starts with.
 *
 * This is the only place their default names are written. Each is an entry like the other: the product
 * treats them the same way, and the user may rename both. The first one answers until the user picks another.
 */
export const DEFAULT_PERSONAS: readonly [Persona, ...Persona[]] = [
  { id: 'ally', name: 'JARVIS', stance: 'accommodating', accent: 'blue', look: 'hud' },
  { id: 'critic', name: 'HAL', stance: 'critical', accent: 'red', look: 'lens' }
]
