import { z } from 'zod'
import { ATTACHMENT_MAX_BYTES, attachmentIdSchema, attachmentSchema, FILE_PIECE_BYTES, workspaceEntrySchema } from '../files.ts'

/** A piece of a file in base64: four characters for every three bytes. */
const pieceSchema = z
  .string()
  .max(Math.ceil(FILE_PIECE_BYTES / 3) * 4)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/)

export const fileCommands = {
  /**
   * Start handing a file over to the assistant: its name, its media type as the device knows it, and its size. The
   * core makes room for it in the inbox of the assistant's folder and answers with what names it until it is sent.
   */
  'attachment.open': {
    input: z.object({
      name: z.string().trim().min(1).max(255),
      type: z.string().max(255).default(''),
      size: z.number().int().nonnegative().max(ATTACHMENT_MAX_BYTES)
    }),
    output: z.object({ attachment: attachmentIdSchema })
  },

  /** The next piece of a file being handed over, in order. Answers with how many bytes have arrived. */
  'attachment.write': {
    input: z.object({ attachment: attachmentIdSchema, data: pieceSchema }),
    output: z.object({ received: z.number().int().nonnegative() })
  },

  /** Every piece has been sent: the file is kept, and goes with the next thing said that names it. */
  'attachment.close': {
    input: z.object({ attachment: attachmentIdSchema }),
    output: z.object({ attachment: attachmentSchema })
  },

  /** The person took a file back before saying anything: what arrived of it is removed. */
  'attachment.discard': {
    input: z.object({ attachment: attachmentIdSchema }),
    output: z.object({})
  },

  /** What is in a folder of the assistant's own: the folder itself, and its contents, folders first, then by name. */
  'workspace.list': {
    input: z.object({ path: z.string().max(4096).default('') }),
    output: z.object({ folder: workspaceEntrySchema, entries: z.array(workspaceEntrySchema) })
  },

  /**
   * Read a piece of a file, to preview or save it: one in the assistant's folder, by its path there, or one the
   * assistant may read on the computer, by where it is. Answers with the piece in base64 and the file's whole size.
   */
  'workspace.read': {
    input: z.object({
      path: z.string().min(1).max(4096),
      offset: z.number().int().nonnegative().default(0),
      length: z.number().int().min(1).max(FILE_PIECE_BYTES).default(FILE_PIECE_BYTES)
    }),
    output: z.object({ data: z.string(), size: z.number().int().nonnegative(), entry: workspaceEntrySchema })
  }
}
