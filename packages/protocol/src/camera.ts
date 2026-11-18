import { z } from 'zod'

/**
 * The longest picture a device sends, as base64: well under the longest line of the protocol, so the picture and its
 * envelope always fit in one. A device makes its picture smaller until it does.
 */
export const MAX_PICTURE_LENGTH = 800_000

/** A picture taken with a device's camera (docs/SPEC.md, section 12.4, more of the device), as a JPEG in base64. */
export const cameraPictureSchema = z.object({
  data: z.string().min(1).max(MAX_PICTURE_LENGTH),
  mime: z.literal('image/jpeg'),
  width: z.number().int().positive().max(10_000),
  height: z.number().int().positive().max(10_000),
  /** The camera it was taken with, by the name the system gives it. */
  camera: z.string().max(200).optional()
})
export type CameraPicture = z.infer<typeof cameraPictureSchema>
