import type { ProtectedPath } from './harness.ts'

/**
 * The computer the core runs on, as far as the core needs to know it to keep what the user grants: the
 * assistant's own folder, what is at a path, the places never reached, and the files it keeps a version of so
 * the person can undo a change. The harness reaches the files themselves.
 */
export interface Computer {
  /** The assistant's own folder, for the files it makes. It exists. */
  workspace: string
  /**
   * A path as the person gave it (absolute, or from their home folder with `~`) as the system names it, and
   * whether a folder or a file is there. Nothing when there is nothing there.
   */
  locate(path: string): Promise<{ path: string; kind: 'folder' | 'file' } | undefined>
  /** Places never reached on this computer, whatever is granted (docs/SPEC.md, section 12.2). */
  protected: readonly ProtectedPath[]
  /** A file's content, to keep before it is changed. Nothing when there is no file there; `too-large` beyond `limit` bytes. */
  read(path: string, limit: number): Promise<Uint8Array | 'too-large' | undefined>
  /** Put a file's content back, making its folder when it is gone. */
  write(path: string, bytes: Uint8Array): Promise<void>
  /** What a file holds now, as a fingerprint to compare: its SHA-256. Nothing when there is no file there. */
  fingerprint(path: string): Promise<string | undefined>
  /** Move a file to the core's own trash, in a folder of the day. Gives back where it went. */
  trash(path: string): Promise<string>
}
