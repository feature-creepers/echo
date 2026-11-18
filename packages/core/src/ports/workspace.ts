/**
 * The assistant's own folder, as the person browses it and hands files into it (docs/SPEC.md, section 9.7). A
 * place in it is named by its path from the top of the folder, its parts joined by "/"; the empty path is the
 * folder itself. Nothing outside the folder is reached through a path, links included.
 */
export interface Workspace {
  /** Where the folder is on this computer, as the system names it. */
  location: string
  /** What is in a folder of it. Nothing when there is no such folder. */
  list(path: string): Promise<WorkspaceItem[] | undefined>
  /** What is at a path of it. Nothing when there is nothing there. */
  stat(path: string): Promise<WorkspaceItem | undefined>
  /**
   * What is at a place of the computer, inside the folder or not: the files a session writes wherever it was
   * allowed to, named on the card that lists them. Nothing when there is nothing there.
   */
  about(location: string): Promise<WorkspaceItem | undefined>
  /** The path in the folder of a place on the computer, when it is inside the folder. */
  pathOf(location: string): string | undefined
  /** A piece of a file, of the folder or of the computer, read from `offset`. Nothing when there is no such file. */
  read(where: { path: string } | { location: string }, offset: number, length: number): Promise<{ bytes: Uint8Array; item: WorkspaceItem } | undefined>
  /**
   * Start a new file in a folder of it, made when missing, under `name` or, when that is taken, the first free
   * name like it ("plan (2).pdf"). Nothing is replaced.
   */
  create(folder: string, name: string): Promise<NewFile>
  /** Remove a file of the folder. Nothing happens when it is not there. */
  remove(path: string): Promise<void>
}

/** A folder or a file, as the folder's browser and the cards of written files show it. */
export interface WorkspaceItem {
  /** Its path in the folder, or, outside it, where it is on the computer. */
  path: string
  name: string
  kind: 'folder' | 'file'
  /** In bytes. For a folder, how many things are in it. */
  size: number
  /** When it last changed: an ISO 8601 date in UTC. */
  modified: string
  /** Where it is on the computer, as the system names it. */
  location: string
}

/** A file being written, piece after piece. */
export interface NewFile {
  /** Its path in the folder, with the name it was given. */
  path: string
  name: string
  write(bytes: Uint8Array): Promise<void>
  /** Every piece is written: the file is complete. */
  close(): Promise<WorkspaceItem>
  /** Leave it unfinished: what was written of it is removed. */
  abort(): Promise<void>
}
