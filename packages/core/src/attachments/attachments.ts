import { ATTACHMENT_MAX_BYTES, type Attachment, type CommandError, decodeBase64, MODEL_IMAGE_MAX_BYTES, MODEL_IMAGE_TYPES, mediaTypeOf } from '@repo/protocol'
import type { NewFile, Workspace } from '../ports/workspace.ts'

/**
 * Files the person hands over with what they say: pasted, dropped or picked (docs/SPEC.md, section 9.7). Each
 * arrives in pieces and is kept at once in the inbox of the assistant's folder, in a folder for the day, under its
 * own name or the first free one like it. It then waits for the thing said that names it, and goes with that turn.
 */

/** The folder of the assistant's folder where handed-over files are kept, one folder a day under it. */
const INBOX = 'inbox'

/** A file handed over, kept, and ready to go with a turn. */
export interface HandedOver extends Attachment {
  /** Where it is on the computer, absolute. */
  location: string
}

type Outcome<Output> = { ok: true; output: Output } | { ok: false; error: CommandError }

export interface Attachments {
  /** Make room for a file in today's inbox. */
  open(asked: { name: string; type: string; size: number }): Promise<Outcome<{ attachment: string }>>
  /** Write its next piece, in base64. */
  write(attachment: string, data: string): Promise<Outcome<{ received: number }>>
  /** Every piece has arrived: the file is kept, and waits for a turn. */
  close(attachment: string): Promise<Outcome<{ attachment: Attachment }>>
  /** Take a file back: what arrived of it is removed. */
  discard(attachment: string): Promise<void>
  /** Those of the files named that are not kept, or no longer: a restart forgets the files waiting for a turn. */
  missing(attachments: readonly string[]): string[]
  /** The kept files named, for the turn they go with: each goes with one turn only. Those not kept are left out. */
  take(attachments: readonly string[]): HandedOver[]
}

export interface AttachmentsOptions {
  /** The assistant's folder. Left out, nothing can be handed over: a core with no folder of its own. */
  workspace?: Workspace | undefined
  now: () => Date
  newId: () => string
  /** The person's time zone, which says what day a file arrived on. Left out, the machine's. */
  timeZone?: () => string
  /** Told when a file is kept in the folder or taken out of it, by its path there. */
  onChange?: (path: string) => void
}

/** How many files may be on their way at once: more than one turn's worth, so a turn can start while the last arrives. */
const OPEN_AT_ONCE = 30

/** Names Windows keeps for its devices: a file cannot be called that, whatever its extension. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/**
 * A name a file can be kept under on any system: no folder in it, none of the characters a system refuses, not
 * ending in a dot or a space, not a device's name, and not so long that a system cuts it. Its extension is kept.
 */
export function keepableName(name: string): string {
  const last = name.split(/[\\/]/).at(-1) ?? ''
  // Control characters, and those a system refuses in a name, become spaces.
  const refused = (character: string) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || '<>:"|?*'.includes(character)
  let kept = [...last]
    .map((character) => (refused(character) ? ' ' : character))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  kept = kept.replace(/[. ]+$/, '').replace(/^\.+/, '')
  const dot = kept.lastIndexOf('.')
  const [base, extension] = dot > 0 ? [kept.slice(0, dot), kept.slice(dot)] : [kept, '']
  const shortExtension = extension.length > 16 ? '' : extension
  const shortBase = base.slice(0, 120 - shortExtension.length).trim()
  if (shortBase === '') return `file${shortExtension}`
  return RESERVED.test(shortBase) ? `_${shortBase}${shortExtension}` : `${shortBase}${shortExtension}`
}

/** The day, as the inbox's folders are named: "2026-11-18", in the person's time zone. */
export function dayOf(at: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', ...(timeZone ? { timeZone } : {}) }).formatToParts(at)
  const part = (type: string) => parts.find((one) => one.type === type)?.value ?? '00'
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** The media type a file is kept with: the one the device gave, else the one its name says, else bytes of no kind. */
export function typeOf(name: string, given: string): string {
  const type = given.trim().toLowerCase()
  return /^[a-z]+\/[a-z0-9.+-]+$/.test(type) ? type : (mediaTypeOf(name) ?? 'application/octet-stream')
}

/** Whether a file is shown to the model as a picture: a kind it takes, small enough. */
export function seenAsImage(type: string, size: number): boolean {
  return (MODEL_IMAGE_TYPES as readonly string[]).includes(type) && size <= MODEL_IMAGE_MAX_BYTES
}

const invalid = (message: string): { ok: false; error: CommandError } => ({ ok: false, error: { code: 'invalid-input', message } })
const failed = (error: unknown): { ok: false; error: CommandError } => ({
  ok: false,
  error: { code: 'failed', message: error instanceof Error ? error.message : String(error) }
})

export function createAttachments({ workspace, now, newId, timeZone, onChange }: AttachmentsOptions): Attachments {
  /** Files on their way: the file being written, what it was said to weigh, and what has arrived. */
  const arriving = new Map<string, { file: NewFile; type: string; size: number; received: number; writing: Promise<unknown> }>()
  /** Files kept and not yet gone with a turn. */
  const kept = new Map<string, HandedOver>()

  return {
    async open({ name, type, size }) {
      if (!workspace) return invalid('This assistant has no folder of its own to keep files in.')
      if (size > ATTACHMENT_MAX_BYTES) return invalid(`A file can weigh ${ATTACHMENT_MAX_BYTES} bytes at most.`)
      if (arriving.size >= OPEN_AT_ONCE) return invalid('Too many files are on their way at once.')
      const keptName = keepableName(name)
      try {
        const file = await workspace.create(`${INBOX}/${dayOf(now(), timeZone?.())}`, keptName)
        const id = newId()
        arriving.set(id, { file, type: typeOf(keptName, type), size, received: 0, writing: Promise.resolve() })
        return { ok: true, output: { attachment: id } }
      } catch (error) {
        return failed(error)
      }
    },

    async write(id, data) {
      const arrival = arriving.get(id)
      if (!arrival) return invalid(`No file "${id}" is on its way.`)
      const bytes = decodeBase64(data)
      if (!bytes) return invalid('A piece of a file must be base64.')
      if (arrival.received + bytes.length > arrival.size) return invalid('The file is larger than it was said to be.')
      arrival.received += bytes.length
      // Pieces are written in the order they came, even when the next arrives before the last is on disk.
      const written = arrival.writing.then(() => arrival.file.write(bytes))
      arrival.writing = written.catch(() => undefined)
      try {
        await written
        return { ok: true, output: { received: arrival.received } }
      } catch (error) {
        return failed(error)
      }
    },

    async close(id) {
      const arrival = arriving.get(id)
      if (!arrival) return invalid(`No file "${id}" is on its way.`)
      if (arrival.received !== arrival.size) return invalid(`Only ${arrival.received} of the file's ${arrival.size} bytes arrived.`)
      arriving.delete(id)
      try {
        await arrival.writing
        const item = await arrival.file.close()
        const attachment: Attachment = {
          id,
          name: arrival.file.name,
          path: arrival.file.path,
          type: arrival.type,
          size: item.size,
          image: seenAsImage(arrival.type, item.size)
        }
        kept.set(id, { ...attachment, location: item.location })
        onChange?.(attachment.path)
        return { ok: true, output: { attachment } }
      } catch (error) {
        return failed(error)
      }
    },

    async discard(id) {
      const arrival = arriving.get(id)
      arriving.delete(id)
      if (arrival) {
        await arrival.writing
        await arrival.file.abort()
        return
      }
      const file = kept.get(id)
      kept.delete(id)
      if (file && workspace) {
        await workspace.remove(file.path)
        onChange?.(file.path)
      }
    },

    missing: (ids) => ids.filter((id) => !kept.has(id)),

    take(ids) {
      const taken: HandedOver[] = []
      for (const id of ids) {
        const file = kept.get(id)
        kept.delete(id)
        if (file && !taken.some((one) => one.id === id)) taken.push(file)
      }
      return taken
    }
  }
}
