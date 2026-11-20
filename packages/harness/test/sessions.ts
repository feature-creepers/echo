import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Log, Session, SessionEvent } from '@repo/core'

/** What the adapters' tests share: a stand-in CLI to start, a folder to work in, and a way to follow a session. */

/** The command that starts a stand-in CLI of this folder with the Node that runs the tests. */
export function fake(name: 'fake-claude.ts' | 'fake-codex.ts'): string[] {
  return [process.execPath, fileURLToPath(new URL(name, import.meta.url))]
}

const folders: string[] = []

/** A new empty folder, removed by `removeFolders`. */
export function folder(): string {
  const created = mkdtempSync(join(tmpdir(), 'harness-test-'))
  folders.push(created)
  return created
}

/**
 * Remove the folders made for the tests. On Windows a stand-in CLI that was just stopped can still hold its
 * working folder for a moment; what cannot be removed then is left to the system's temporary folder, since a
 * test's outcome does not depend on it.
 */
export function removeFolders(): void {
  for (const created of folders.splice(0)) {
    try {
      rmSync(created, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    } catch {
      // Still held: left behind in the temporary folder.
    }
  }
}

/** A log that keeps what it is told. */
export function recordingLog(): Log & { errors: string[] } {
  const errors: string[] = []
  return { errors, error: (message) => void errors.push(message) }
}

/** Resolves once `check` holds. A test that waits for ever is stopped by its own time limit. */
export async function eventually(check: () => boolean): Promise<void> {
  while (!check()) await new Promise((resolve) => setTimeout(resolve, 20))
}

interface Followed {
  /** Every event so far, in order. */
  events: SessionEvent[]
  /** Resolves once `count` events of a type have arrived. */
  until(type: SessionEvent['type'], count?: number): Promise<void>
  /** The reply so far: the pieces of text, end to end. */
  text(): string
  /** The events as short words, to compare a whole conversation at a glance. */
  outline(): string[]
}

/** Listen to a session and keep what it says. */
export function follow(session: Session): Followed {
  const events: SessionEvent[] = []
  let changed: Array<() => void> = []
  session.onEvent((event) => {
    events.push(event)
    const waiting = changed
    changed = []
    for (const wake of waiting) wake()
  })
  return {
    events,
    async until(type, count = 1) {
      while (events.filter((event) => event.type === type).length < count) await new Promise<void>((resolve) => changed.push(resolve))
    },
    text: () => events.map((event) => (event.type === 'text' ? event.text : '')).join(''),
    outline: () =>
      events.map((event) => {
        if (event.type === 'text') return `text:${event.text}`
        if (event.type === 'tool') return `tool:${event.name}:${event.phase}`
        if (event.type === 'failed') return `failed:${event.reason}`
        return event.type
      })
  }
}
