/**
 * The computer the core runs on, as far as the core needs to know it to keep what the user grants: the
 * assistant's own folder, and what is at a path. The harness reaches the files themselves.
 */
export interface Computer {
  /** The assistant's own folder, for the files it makes. It exists. */
  workspace: string
  /**
   * A path as the person gave it (absolute, or from their home folder with `~`) as the system names it, and
   * whether a folder or a file is there. Nothing when there is nothing there.
   */
  locate(path: string): Promise<{ path: string; kind: 'folder' | 'file' } | undefined>
}
