import type { LibraryState } from '@repo/client'
import { createContext, useContext } from 'react'

/** What a view's controls need to save it, pin it, and open it among the widgets in the library. */
export interface LibraryControls {
  library: LibraryState
  /** Open the library on its widgets page, on a widget if one is given. */
  open(widget?: string): void
}

export const LibraryContext = createContext<LibraryControls | undefined>(undefined)

/** The library's controls, where the app provides them. Nothing in a place that cannot save, such as first launch. */
export const useLibraryControls = (): LibraryControls | undefined => useContext(LibraryContext)
