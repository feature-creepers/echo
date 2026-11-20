import { type Client, type Handed, HandOverCancelled, handOver } from '@repo/client'
import { ATTACHMENT_MAX_BYTES, ATTACHMENTS_PER_TURN, mediaTypeOf } from '@repo/protocol'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fitForModel } from './fit-for-model.ts'

/**
 * What the person is about to hand over with the next thing they say (docs/SPEC.md, sections 9.7 and 13.2): files
 * pasted, dropped or picked, sent to the core as soon as they are added so the message goes at once, and folders
 * dropped on a desktop, given by where they are.
 */

/** A file or a folder waiting in the composer. */
export interface Pending {
  key: string
  name: string
  kind: 'image' | 'file' | 'folder'
  /** In bytes, as it is sent. A folder has none. */
  size?: number | undefined
  /** A picture's own look, small, while it waits. */
  thumbnail?: string | undefined
  state: 'sending' | 'sent' | 'failed'
  /** How much of it has arrived, from 0 to 1. */
  progress: number
}

export interface Attachments {
  pending: readonly Pending[]
  /** Why something was not added, in a few quiet words. It goes by itself after a while. */
  notice: string | undefined
  /**
   * Add files, and folders by where they are. Beyond ten, or over 25 MB, they are refused with a notice, as are the
   * ones the device did not read for those reasons (`unread`).
   */
  add(files: readonly File[], folders?: readonly { name: string; path: string }[], unread?: Unread): void
  /** Say why something could not be added. */
  refuse(notice: string): void
  remove(key: string): void
  removeLast(): void
  /**
   * Wait for every file still on its way, then give what goes with the message and empty the composer. Nothing
   * when one of them could not be sent: the composer keeps them, and says so.
   */
  take(): Promise<Handed | undefined>
}

/** Files the device did not read: those over the most a file can be, by name, and how many more than can go. */
interface Unread {
  tooLarge: readonly string[]
  more: number
}

interface Sending {
  cancel: { aborted: boolean }
  done: Promise<void>
  attachment?: string
  path?: string
}

/** How long a notice stays beside the composer. */
const NOTICE_MS = 6000

/** A pasted picture has no name of its own: it is named for when it was pasted, as screenshots are. */
export function pastedName(at: Date, type: string): string {
  const time = [at.getHours(), at.getMinutes(), at.getSeconds()].map((part) => String(part).padStart(2, '0')).join('.')
  const extension = type.split('/')[1]?.replace('jpeg', 'jpg').replace(/\+.*$/, '') ?? 'png'
  return `Pasted image ${time}.${extension}`
}

/** Whether a file manager copied anything the device read, or would have but for the limits. */
export const anyCopied = (copied: { files: readonly unknown[]; folders: readonly unknown[]; tooLarge: readonly unknown[]; more: number }) =>
  copied.files.length + copied.folders.length + copied.tooLarge.length + copied.more > 0

/** A file a file manager copied, read by the device, as the window hands a file over: its kind found by its name. */
export function copiedFile({ name, data }: { name: string; data: Uint8Array }): File {
  return new File([data as Uint8Array<ArrayBuffer>], name, { type: mediaTypeOf(name) ?? '' })
}

/** The largest file, as the person reads it: "25 MB". */
export const LARGEST_FILE = `${Math.round(ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB`

/** Why some of the files given cannot be added, or nothing when all can. */
export function refusalOf(count: number, room: number, tooLarge: readonly string[]): string | undefined {
  const reasons = [
    tooLarge.length === 1 ? `${tooLarge[0]} is over ${LARGEST_FILE}, the most a file can be.` : '',
    tooLarge.length > 1 ? `${tooLarge.length} files are over ${LARGEST_FILE}, the most a file can be.` : '',
    count > room ? `Only ${ATTACHMENTS_PER_TURN} files can go with one message.` : ''
  ]
  return reasons.filter(Boolean).join(' ') || undefined
}

export function useAttachments(client: Client): Attachments {
  const [pending, setPending] = useState<Pending[]>([])
  const [notice, setNotice] = useState<string>()
  const sending = useRef(new Map<string, Sending>())
  const current = useRef(pending)
  current.current = pending
  const made = useRef(0)

  useEffect(() => {
    if (notice === undefined) return
    const timer = setTimeout(() => setNotice(undefined), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  // What waits is let go of with the window: its pictures, and the files on their way.
  useEffect(
    () => () => {
      for (const one of current.current) if (one.thumbnail) URL.revokeObjectURL(one.thumbnail)
      for (const one of sending.current.values()) one.cancel.aborted = true
    },
    []
  )

  const change = useCallback((key: string, next: Partial<Pending>) => {
    setPending((all) => all.map((one) => (one.key === key ? { ...one, ...next } : one)))
  }, [])

  const send = useCallback(
    (key: string, given: File, cancel: { aborted: boolean }) => {
      const entry: Sending = { cancel, done: Promise.resolve() }
      entry.done = (async () => {
        const file = given.type.startsWith('image/') ? await fitForModel(given) : given
        if (cancel.aborted) return
        const thumbnail = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
        change(key, { name: file.name, size: file.size, ...(thumbnail ? { thumbnail } : {}) })
        try {
          const attachment = await handOver(
            client.session,
            { name: file.name, type: file.type, size: file.size, slice: async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer()) },
            { cancel, onProgress: (sent) => change(key, { progress: file.size === 0 ? 1 : sent / file.size }) }
          )
          entry.attachment = attachment.id
          change(key, { state: 'sent', progress: 1 })
        } catch (error) {
          if (!(error instanceof HandOverCancelled)) change(key, { state: 'failed' })
        }
      })()
      sending.current.set(key, entry)
    },
    [client, change]
  )

  const add = useCallback(
    (files: readonly File[], folders: readonly { name: string; path: string }[] = [], unread: Unread = { tooLarge: [], more: 0 }) => {
      const room = ATTACHMENTS_PER_TURN - current.current.length
      const tooLarge = [...files.filter((file) => file.size > ATTACHMENT_MAX_BYTES).map((file) => file.name), ...unread.tooLarge]
      const fitting = [...folders.map((folder) => ({ folder })), ...files.filter((file) => file.size <= ATTACHMENT_MAX_BYTES).map((file) => ({ file }))]
      const taken = fitting.slice(0, Math.max(0, room))
      const refused = refusalOf(fitting.length + unread.more, room, tooLarge)
      if (refused) setNotice(refused)
      if (taken.length === 0) return
      const added: Pending[] = []
      for (const one of taken) {
        made.current += 1
        const key = `pending-${made.current}`
        if ('folder' in one) {
          sending.current.set(key, { cancel: { aborted: false }, done: Promise.resolve(), path: one.folder.path })
          added.push({ key, name: one.folder.name, kind: 'folder', state: 'sent', progress: 1 })
          continue
        }
        const named =
          one.file.name === '' || one.file.name === 'image.png'
            ? new File([one.file], pastedName(new Date(), one.file.type), { type: one.file.type })
            : one.file
        added.push({ key, name: named.name, kind: named.type.startsWith('image/') ? 'image' : 'file', size: named.size, state: 'sending', progress: 0 })
        send(key, named, { aborted: false })
      }
      setPending((all) => [...all, ...added])
    },
    [send]
  )

  const remove = useCallback(
    (key: string) => {
      const entry = sending.current.get(key)
      sending.current.delete(key)
      if (entry) {
        entry.cancel.aborted = true
        // A file already kept is taken back: it does not stay in the inbox unsaid.
        if (entry.attachment) void client.session.run('attachment.discard', { attachment: entry.attachment }).catch(() => undefined)
      }
      setPending((all) => {
        const gone = all.find((one) => one.key === key)
        if (gone?.thumbnail) URL.revokeObjectURL(gone.thumbnail)
        return all.filter((one) => one.key !== key)
      })
    },
    [client]
  )

  const take = useCallback(async (): Promise<Handed | undefined> => {
    const keys = current.current.map((one) => one.key)
    await Promise.all(keys.map((key) => sending.current.get(key)?.done))
    const failed = keys.filter((key) => {
      const entry = sending.current.get(key)
      return entry !== undefined && entry.attachment === undefined && entry.path === undefined
    })
    if (failed.length > 0) {
      setNotice(failed.length === 1 ? 'A file could not be sent: remove it, or add it again.' : 'Some files could not be sent: remove them, or add them again.')
      return undefined
    }
    const entries = keys.flatMap((key) => sending.current.get(key) ?? [])
    for (const key of keys) sending.current.delete(key)
    setPending((all) => {
      for (const one of all) if (keys.includes(one.key) && one.thumbnail) URL.revokeObjectURL(one.thumbnail)
      return all.filter((one) => !keys.includes(one.key))
    })
    return {
      attachments: entries.flatMap((entry) => entry.attachment ?? []),
      folders: entries.flatMap((entry) => entry.path ?? [])
    }
  }, [])

  return useMemo(
    () => ({
      pending,
      notice,
      add,
      refuse: setNotice,
      remove,
      removeLast: () => {
        const last = current.current.at(-1)
        if (last) remove(last.key)
      },
      take
    }),
    [pending, notice, add, remove, take]
  )
}
