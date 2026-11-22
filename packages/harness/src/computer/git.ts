import { execFile } from 'node:child_process'
import type { Signal } from '@repo/core'
import { platform } from '../process/platform/index.ts'

interface GitOptions {
  /** How long it may take, in milliseconds. `null` for no limit: a large checkout takes minutes, and a deadline would leave it half made. */
  timeout?: number | null
  /** Stops it, with the programs it started, when aborted. */
  signal?: Signal | undefined
}

/**
 * Run git in a folder and give back what it printed, as bytes. Rejects when it fails, is stopped or is not there, with
 * what git said as the error's message. Long paths are let through on Windows, where a work tree deep in a folder
 * passes 260 characters.
 */
export function git(folder: string, args: readonly string[], { timeout = 20_000, signal }: GitOptions = {}): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const stop = () => platform.terminate(child)
    const child = execFile(
      'git',
      ['-C', folder, '-c', 'core.longpaths=true', ...args],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...(timeout === null ? {} : { timeout }) },
      (error, printed, said) => {
        signal?.removeEventListener('abort', stop)
        if (!error) return resolve(new Uint8Array(printed))
        const words = text(said).trim()
        reject(words === '' ? error : new Error(words, { cause: error }))
      }
    )
    if (signal?.aborted) stop()
    else signal?.addEventListener('abort', stop, { once: true })
  })
}

export const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
