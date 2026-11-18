import { z } from 'zod'
import { eventPrefixSchema } from '../envelope.ts'

/**
 * Take a picture with the camera, which the person allowed on a card just now. A device that declared `camera` takes
 * it, marking the screen while the camera is on, and answers with `camera.picture` and the same `request`.
 */
export const deviceCameraSchema = eventPrefixSchema.extend({
  name: z.literal('device.camera'),
  request: z.string().min(1).max(64),
  /** The camera to use, by words of its name. Left out, the system's first. */
  camera: z.string().min(1).max(200).optional()
})
