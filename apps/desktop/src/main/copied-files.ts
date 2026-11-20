import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ATTACHMENT_MAX_BYTES, ATTACHMENTS_PER_TURN } from '@repo/protocol'
import type { CopiedFiles } from '../preload/bridge.ts'

/**
 * Files copied in a file manager, where the window is not given them when the person pastes (docs/SPEC.md, section
 * 9.7): Linux's file managers put the files' addresses on the clipboard, never their content, so the app reads the
 * files itself, at the moment the person pastes and only those the clipboard names.
 */

/** The clipboard's formats that name copied files: GNOME's own list, then the one every file manager writes. */
const COPIED_FORMATS = ['x-special/gnome-copied-files', 'text/uri-list'] as const

/** An entry of the clipboard, as Electron reads it. */
export interface ClipboardEntry {
  readonly types: readonly string[]
  getType(type: string): Promise<unknown>
}

/**
 * The lists of copied files on the clipboard, in the order of `COPIED_FORMATS`: each under its own type, or as a raw
 * format of the system, which Electron names `electron application/osclipboard;format="…"`.
 */
export async function copiedLists(entries: readonly ClipboardEntry[]): Promise<string[]> {
  const lists: string[] = []
  for (const format of COPIED_FORMATS) {
    for (const entry of entries) {
      const type = entry.types.find((one) => one === format || one === `electron application/osclipboard;format="${format}"`)
      if (type === undefined) continue
      const value = await entry.getType(type).catch(() => undefined)
      if (typeof value === 'string') lists.push(value)
      else if (value instanceof Blob) lists.push(await value.text())
    }
  }
  return lists
}

/**
 * The places a file manager put on the clipboard, from the first of its lists that names any: GNOME's starts with
 * "copy" or "cut", a list of addresses (`text/uri-list`) may hold comments. Only files of this computer, each once.
 */
export function copiedPaths(lists: readonly string[]): string[] {
  for (const list of lists) {
    const paths = list
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('file://'))
      .flatMap((address) => {
        try {
          return [fileURLToPath(address, { windows: false })]
        } catch {
          // An address of another machine ("file://server/…") is not a file here.
          return []
        }
      })
    if (paths.length > 0) return [...new Set(paths)]
  }
  return []
}

/** Read what was copied: the folders by where they are, the files' bytes, at most as many as go with one message. */
export async function readCopied(paths: readonly string[]): Promise<CopiedFiles> {
  const copied: CopiedFiles = { files: [], folders: [], tooLarge: [], more: 0 }
  let taken = 0
  for (const path of paths) {
    const found = await stat(path).catch(() => undefined)
    if (!found || !(found.isFile() || found.isDirectory())) continue
    if (found.isFile() && found.size > ATTACHMENT_MAX_BYTES) {
      copied.tooLarge.push(basename(path))
      continue
    }
    if (taken === ATTACHMENTS_PER_TURN) {
      copied.more += 1
      continue
    }
    if (found.isDirectory()) copied.folders.push({ name: basename(path), path })
    else {
      const data = await readFile(path).catch(() => undefined)
      if (!data) continue
      copied.files.push({ name: basename(path), data: new Uint8Array(data) })
    }
    taken += 1
  }
  return copied
}
