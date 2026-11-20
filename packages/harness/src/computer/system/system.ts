import type { ProtectedPath } from '@repo/core'

/** Where the person's things are on this system: their home folder, and the variables that name its folders. */
export interface Where {
  home: string
  env: Readonly<Record<string, string | undefined>>
}

/** What differs from one system to the next about reaching the computer. */
export interface ComputerSystem {
  /** Places never reached on this system, whatever is granted, besides those every system has. */
  protectedPaths(where: Where): ProtectedPath[]
  /** A path as the system's own tools name it, from the way a command wrote it: Git Bash's `/c/Users` is `C:\Users` on Windows. */
  shellPath(path: string): string
  /** Whether names are found whatever their capitals. */
  caseless: boolean
  /**
   * Whether `..` goes up from where a link leads, as macOS and Linux follow a path part by part. Windows takes `..`
   * away as words before it follows a junction.
   */
  upFromLinks: boolean
  /**
   * Whether the system watches a folder with all its subfolders at once (Windows, macOS). Linux watches each folder
   * on its own, so a large tree is watched only in part.
   */
  watchesTrees: boolean
  /**
   * Whether the system starts watching a folder some time after it is asked to, and tells its changes late, through one
   * stream for every folder a process watches (FSEvents on macOS, for a folder watched alone or with its subfolders).
   * A change is then known to be told only once a probe written after it is.
   */
  watchesLate: boolean
  /**
   * Folders of the home folder where apps keep their own data, changing all the time of their own accord: passed
   * over when what a command changes is watched there (`AppData`, `Library`). Folders whose name starts with a dot,
   * on every system, are passed over too.
   */
  appData(where: Where): string[]
  /**
   * Whether the system itself can hold a command to what was granted: Claude Code's sandbox, Seatbelt on macOS and
   * bubblewrap on Linux. It has none on Windows, where the paths a command names and the approval card are the check.
   */
  confines: boolean
  /**
   * Folders the person's programs write to on their own while a command runs: package caches and stores, and the
   * temporary folder. A confined command may change them, or `npm install` and a build would fail outside the scope.
   */
  caches(where: Where): string[]
  /**
   * What a command reads to run the person's own programs, besides the system's: the folders of their search path
   * (`pnpm`, `cargo`, `python` installed for them alone) and their git settings, without which git will not start. A
   * confined command that may read only the places granted may read these too.
   */
  programs(where: Where): string[]
}
