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
}
