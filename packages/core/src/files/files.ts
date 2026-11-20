import { z } from 'zod'
import type { Blobs } from '../ports/blobs.ts'
import type { Records } from '../ports/records.ts'
import type { Tool } from '../tools/tools.ts'

/**
 * The files the assistant writes: documents, lists, letters. Each change is a new version, so the user can
 * take a file and edit it while the assistant carries on (docs/SPEC.md, section 9.7). The content is kept by
 * its hash; a record says which file, which version, and of what kind.
 */

/** The type of the record written for each version of a file. */
const FILE_VERSION = 'file.version'

/** The kinds of file the assistant writes, and the media type each is read as. */
const MEDIA_TYPES = { markdown: 'text/markdown', text: 'text/plain', csv: 'text/csv' } as const
const formatSchema = z.enum(['markdown', 'text', 'csv'])

const versionSchema = z.object({
  file: z.string(),
  name: z.string(),
  format: formatSchema,
  version: z.number().int().positive(),
  hash: z.string(),
  bytes: z.number().int().nonnegative(),
  thread: z.string().optional(),
  at: z.string()
})
type FileVersion = z.infer<typeof versionSchema>

/** A file as a client reads it: its latest version and the text. */
interface FileContent extends FileVersion {
  mime: string
  text: string
}

/** The longest file the assistant may write, in characters. */
const MAX_LENGTH = 400_000

const writeInput = z.object({
  name: z.string().trim().min(1).max(120),
  format: formatSchema.default('markdown'),
  content: z.string().max(MAX_LENGTH),
  file: z.string().optional()
})
const readInput = z.object({ file: z.string().min(1) })

interface Files {
  read(file: string): FileContent | undefined
  /** The tools a thread writes and reads files with. */
  tools(thread: () => string | undefined): Tool[]
}

export function createFiles({ records, blobs, now, newId }: { records: Records; blobs: Blobs; now: () => Date; newId: () => string }): Files {
  const latest = (file: string): FileVersion | undefined =>
    records
      .read([FILE_VERSION])
      .flatMap((record) => {
        const version = versionSchema.safeParse(record.payload)
        return version.success && version.data.file === file ? [version.data] : []
      })
      .at(-1)

  const read = (file: string): FileContent | undefined => {
    const version = latest(file)
    const bytes = version ? blobs.get(version.hash) : undefined
    if (!version || !bytes) return undefined
    return { ...version, mime: MEDIA_TYPES[version.format], text: new TextDecoder().decode(bytes) }
  }

  return {
    read,
    tools: (thread) => [
      {
        definition: {
          name: 'file_write',
          description:
            'Write a document the person can keep: a letter, a list, a plan, a table. It is kept as a file with versions. Give `file` to write a new version of one you wrote before. Answers with its id: show it with a FilePreview block so the person can read and download it.',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'The file name, without extension: "Letter to the landlord".' },
              format: { type: 'string', enum: ['markdown', 'text', 'csv'] },
              content: { type: 'string' },
              file: { type: 'string', description: 'The id of a file to write a new version of.' }
            },
            required: ['name', 'content']
          }
        },
        run(input) {
          const asked = writeInput.safeParse(input)
          if (!asked.success) return { ok: false, text: 'file_write takes a name, a format ("markdown", "text" or "csv") and the content.' }
          const before = asked.data.file ? latest(asked.data.file) : undefined
          if (asked.data.file && !before) return { ok: false, text: `There is no file "${asked.data.file}". Leave out \`file\` to write a new one.` }
          const bytes = new TextEncoder().encode(asked.data.content)
          const working = thread()
          const version: FileVersion = {
            file: before?.file ?? newId(),
            name: asked.data.name,
            format: asked.data.format,
            version: (before?.version ?? 0) + 1,
            hash: blobs.put(bytes),
            bytes: bytes.length,
            at: now().toISOString(),
            ...(working === undefined ? {} : { thread: working })
          }
          records.append([{ type: FILE_VERSION, payload: version }])
          return {
            ok: true,
            text: `Written: file "${version.file}", version ${version.version}. Show it with { "type": "FilePreview", "props": { "file": "${version.file}" } }.`
          }
        }
      },
      {
        definition: {
          name: 'file_read',
          description: 'Read the latest version of a file you wrote, to change it or answer about it.',
          inputSchema: { type: 'object', properties: { file: { type: 'string' } }, required: ['file'] }
        },
        run(input) {
          const asked = readInput.safeParse(input)
          const content = asked.success ? read(asked.data.file) : undefined
          if (!content) return { ok: false, text: 'There is no such file.' }
          return { ok: true, text: `"${content.name}", version ${content.version}, ${content.format}:\n\n${content.text}` }
        }
      }
    ]
  }
}
