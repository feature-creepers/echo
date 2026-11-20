import type { Look } from '@repo/protocol'
import type { Rgb } from './color.ts'
import { createHudPainting } from './hud-painter.ts'
import { createLensPainting } from './lens-painter.ts'
import { LOOK_SHRINK, type Pose } from './life.ts'

export type { Mood } from './life.ts'

/**
 * Draws the core the simpler way, on a 2D canvas, where the system has no graphics card to draw it with (`gpu.ts`).
 * Each look is drawn as its shader draws it, with less detail, from the same life (`life.ts`), so the two ways
 * move alike: what changes is only how finely the light is worked out.
 */
interface Painter {
  /** Draws one frame, as `GpuCore.paint` does. */
  paint(context: CanvasRenderingContext2D, pose: Pose, accents: Record<Look, Rgb>, side: number, scale: number): void
}

export function createPainter(): Painter {
  const lens = createLensPainting()
  const hud = createHudPainting()

  return {
    paint(context, pose, accents, side, zoom) {
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.globalCompositeOperation = 'source-over'
      context.globalAlpha = 1
      context.clearRect(0, 0, side, side)
      // While one look gives way to the other, the outgoing one is drawn first and the incoming one over it, each
      // as strong as it is in effect, and each a little smaller until it has settled.
      const order = (Object.keys(pose.looks) as Look[]).sort((one, other) => pose.looks[one] - pose.looks[other])
      for (const look of order) {
        const weight = pose.looks[look]
        if (weight < 0.002) continue
        const scale = (1 - LOOK_SHRINK * (1 - weight)) * zoom
        // Waking, drawn more simply than the shaders do it: the instrument fades in as it grows to its size, and the
        // lens's light rises out of its dark glass.
        const woken = pose.wake[look]
        const rising = woken * woken * (3 - 2 * woken)
        if (look === 'lens') {
          context.globalAlpha = weight
          lens.paint(context, { ...pose.lens, lamp: pose.lens.lamp * (0.15 + 0.85 * rising) }, accents.lens, side, scale)
        } else {
          context.globalAlpha = weight * rising
          hud.paint(context, pose, accents.hud, side, scale * (0.9 + 0.1 * rising))
        }
      }
      context.globalAlpha = 1
    }
  }
}
