import { z } from 'zod'

/**
 * Files between the person and the assistant (docs/SPEC.md, section 9.7): what the person hands over with what
 * they say, and the assistant's own folder, as the person browses it.
 *
 * Bytes travel, never a path of the device: the core may be on another machine. A file crosses in pieces, each
 * small enough for one message.
 */

/** The most files that go with one thing said. */
export const ATTACHMENTS_PER_TURN = 10

/** The largest file the person can hand over, in bytes. */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024

/** The most bytes in one piece of a file, before base64: one piece and its envelope fit in one message. */
export const FILE_PIECE_BYTES = 512 * 1024

/**
 * What a model takes as a picture: these kinds, this size at most, and this many pixels on the long side. A larger
 * picture is made smaller before it is sent; another kind is a file the assistant reads.
 */
export const MODEL_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export const MODEL_IMAGE_MAX_BYTES = Math.floor(3.75 * 1024 * 1024)
export const MODEL_IMAGE_MAX_SIDE = 2000

/** A file handed over, while it is on its way to the core and once it is there. */
export const attachmentIdSchema = z.string().min(1).max(64)

/** A file the person handed over, kept in the inbox of the assistant's folder. */
export const attachmentSchema = z.object({
  id: attachmentIdSchema,
  /** Its name as kept: the one given, or the first free one like it. */
  name: z.string(),
  /** Where it is in the assistant's folder, its parts joined by "/": "inbox/2026-11-18/plan.pdf". */
  path: z.string(),
  /** Its media type: "image/png", "application/pdf". */
  type: z.string(),
  size: z.number().int().nonnegative(),
  /** Whether the model is shown it as a picture, rather than reading it as a file. */
  image: z.boolean()
})
export type Attachment = z.infer<typeof attachmentSchema>

/** What went with something said, as the transcript keeps it: names and sizes, never a path of a device. */
export const attachedSchema = z.object({
  name: z.string(),
  kind: z.enum(['image', 'file', 'folder']),
  size: z.number().int().nonnegative().optional(),
  /** A file's place in the assistant's folder. */
  path: z.string().optional()
})
export type Attached = z.infer<typeof attachedSchema>

/** Something in the assistant's folder. */
export const workspaceEntrySchema = z.object({
  /** Where it is in the folder, its parts joined by "/". */
  path: z.string(),
  name: z.string(),
  kind: z.enum(['folder', 'file']),
  /** In bytes. For a folder, how many things are in it. */
  size: z.number().int().nonnegative(),
  /** When it last changed: an ISO 8601 date in UTC. */
  modified: z.string(),
  /** Where it is on the core's computer, as that system names it: to open it there, or show it in its folder. */
  location: z.string()
})
export type WorkspaceEntry = z.infer<typeof workspaceEntrySchema>

/** The media type a file's name says, by its extension. Nothing when its extension says nothing. */
export function mediaTypeOf(name: string): string | undefined {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? undefined : MEDIA_TYPES[name.slice(dot + 1).toLowerCase()]
}

const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  heic: 'image/heic',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  pdf: 'application/pdf',
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  html: 'text/html',
  htm: 'text/html',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm'
}
