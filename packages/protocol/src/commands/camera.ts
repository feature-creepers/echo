import { z } from 'zod'
import { cameraPictureSchema } from '../camera.ts'

export const cameraCommands = {
  /**
   * A device that declared `camera` answers the core's request for a picture (`device.camera`): the picture, or why
   * there is none, in words for the person ("This computer has no camera."). Any other answer to the same request is
   * ignored, and so is an answer to a request no longer waiting.
   */
  'camera.picture': {
    input: z.object({
      request: z.string().min(1).max(64),
      picture: cameraPictureSchema.optional(),
      problem: z.string().min(1).max(500).optional()
    }),
    output: z.object({})
  }
}
