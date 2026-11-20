import type { MiniSystem } from './system.ts'

/**
 * Windows: Mini floats as it is. The system's buttons stay over its top right, as on the full window: Electron gives no
 * way to hide them once the window exists.
 */
export const system: MiniSystem = {
  float: () => undefined,
  placed: () => true
}
