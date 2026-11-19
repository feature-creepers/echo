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
  /**
   * A file's content: to keep its version before it is changed, or a project's instructions. Nothing when there is
   * no file there; `too-large` beyond `limit` bytes.
   */
  read(path: string, limit: number): Promise<Uint8Array | 'too-large' | undefined>
  /** Put a file's content back, making its folder when it is gone. */
  write(path: string, bytes: Uint8Array): Promise<void>
  /** What a file holds now, as a fingerprint to compare: its SHA-256. Nothing when there is no file there. */
  fingerprint(path: string): Promise<string | undefined>
  /** Move a file to the core's own trash, in a folder of the day. Gives back where it went. */
  trash(path: string): Promise<string>
  /**
   * Watch a folder, not its subfolders, for files that arrive, change or leave: `changed` is given their paths as
   * the system reports them, often many times for one file being written, and the core waits for them to settle.
   * Returns a function that stops watching. Left out, nothing is watched, and no job rings on files.
   */
  watch?(folder: string, changed: (paths: readonly string[]) => void): () => void
  /** What a file is now: its size in bytes. Nothing when there is no file there, or a folder. */
  fileAt?(path: string): Promise<{ size: number } | undefined>
  /**
   * The names of the files directly in a folder, not its subfolders, as the system names them. Nothing when there is
   * no folder there. Left out, the core cannot look into a folder, and brings in nothing that needs it.
   */
  list?(folder: string): Promise<string[] | undefined>
  /**
   * What a folder holds now, to tell once a command run in it ended what it changed there (docs/SPEC.md, section
   * 12.2): in a git work tree, the files git sees, from where the work tree starts; elsewhere, the folder's files,
   * within limits. Nothing when it cannot be looked at. Left out, what a command changes is not known.
   */
  snapshot?(folder: string): Promise<FolderSnapshot | undefined>
}

/** A folder as a command found it. */
export interface FolderSnapshot {
  /** The files changed since, each with what it held before and holds now, at most a few hundred. */
  changes(): Promise<FoundChange[]>
}

/** A file a command changed: what it held before (no file, or not known) and what it holds now (no file, or too large to keep). */
export interface FoundChange {
  path: string
  before: Uint8Array | 'none' | 'unknown'
  after: Uint8Array | 'none' | 'too-large'
}
