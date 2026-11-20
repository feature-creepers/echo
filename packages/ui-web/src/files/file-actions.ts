import { type Client, cell, readFile } from '@repo/client'
import { ATTACHMENT_MAX_BYTES } from '@repo/protocol'
import { useMemo } from 'react'
import { useDevice } from '../device/device.tsx'
import type { FileActions } from '../view/context.ts'

/**
 * What the person can do with a file on the computer, wherever one is shown: open it with its app, show it in its
 * folder, look at it without leaving the app, copy where it is, or save a copy. Opening and showing go through the
 * app that hosts the interface, and are left out where it cannot do them.
 */

/** The file the window's one quick look shows, by its path. Nothing while it is closed. */
export const peeked = cell<string | undefined>(undefined)

/** Show a file in the quick look over the main screen. */
const peek = (path: string) => peeked.set(path)

/** The file actions views are given: what this app can do, and the quick look. */
export function useFileActions(): FileActions {
  const { host } = useDevice()
  return useMemo(() => {
    const files = host?.files
    return {
      ...(files?.open ? { open: (path: string) => void files.open?.(path).catch(() => undefined) } : {}),
      ...(files ? { reveal: (path: string) => void files.reveal(path).catch(() => undefined) } : {}),
      preview: peek
    }
  }, [host])
}

/** Put a text on the clipboard: the system's own, or the window's way when it is refused. True when it is there. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    const copied = document.execCommand('copy')
    area.remove()
    return copied
  }
}

/** Save bytes where the person chooses, with the system's own dialog: the window offers them as a download. */
export function offerDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  // The download has started from the address by then; it is let go of a while later, not at once.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Save a copy of a file where the person chooses. */
export async function saveCopy(client: Client, path: string, name: string): Promise<void> {
  const read = await readFile(client.session, path, ATTACHMENT_MAX_BYTES * 4)
  offerDownload(new Blob([read.bytes as Uint8Array<ArrayBuffer>]), name)
}
