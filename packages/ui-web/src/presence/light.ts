import { createContext, useContext } from 'react'
import { type Field, restingField } from './field.ts'

/**
 * The light the core casts on what is round it, kept outside React: the core writes it on every frame it draws,
 * and the ground reads it on every frame it draws, so the dots near the core, and round what it looks at, light up
 * with it and nothing on the page is drawn again for it.
 */
interface CoreLight {
  /** Where the core is on the screen and how large, in CSS pixels from the top left of the window; nothing while no core is shown. */
  core: { x: number; y: number; radius: number } | undefined
  /** How much light it casts, from 0: more while it hears or speaks and as the computer works harder, little asleep. */
  glow: number
  /** What it looks at, when it looks at something: where, how wide its light falls there, and how strongly. */
  spot: { x: number; y: number; radius: number; strength: number } | undefined
  /** How hard the computer works, as the core shows it, from 0 to 1: the ground's light drifts faster with it. */
  power: number
  /** What the core does, for the ground round it to show: its voice going out, and the voice it hears coming in. */
  field: Field
  /**
   * The voice over the last second, as the core's life keeps it (`Pose.echo`): its own and the one it hears, newest
   * first; and how far between two samples it is. Nothing until the core has drawn a frame.
   */
  voice: Float32Array | undefined
  voiceShift: number
}

export function createCoreLight(): CoreLight {
  return { core: undefined, glow: 0, spot: undefined, power: 0.3, field: restingField(), voice: undefined, voiceShift: 0 }
}

/** The window's core light, shared by the core and the ground under it. Left out, the core lights nothing round it. */
export const CoreLightContext = createContext<CoreLight | undefined>(undefined)

export function useCoreLight(): CoreLight | undefined {
  return useContext(CoreLightContext)
}
