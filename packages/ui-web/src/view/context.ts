import { createContext, useContext } from 'react'

/** A file the assistant wrote, as a preview reads it. */
export interface FileContent {
  name: string
  mime: string
  format: 'markdown' | 'text' | 'csv'
  version: number
  text: string
}

/** What a block can do besides draw: say something to the assistant on the user's behalf, and read its files. */
export interface ViewActions {
  say(text: string): void
  readFile(file: string): Promise<FileContent>
  /**
   * The GeoJSON a map names, read by the core, which checked it and needs no permission of the page to fetch it.
   * Left out, a map fetches it itself.
   */
  readShapes?(url: string): Promise<unknown>
  /** The JSON document a block's feed names, read by the core. Left out, a fed block shows the figure it was given. */
  readFeed?(url: string): Promise<unknown>
  /**
   * Set when the view may start what it plays by itself: it was just shown in answer to the person. The value
   * is a key for that showing, so drawing the view again does not start it again. Left out, nothing starts.
   */
  autoplay?: string | undefined
  /** What can be done with a file on the computer, by its absolute path. Each is left out where it cannot be done here. */
  files?: FileActions | undefined
}

/** A file on the computer: opened with its app, shown in its folder, or looked at without leaving the app. */
export interface FileActions {
  open?: ((path: string) => void) | undefined
  reveal?: ((path: string) => void) | undefined
  preview?: ((path: string) => void) | undefined
}

export const ViewActionsContext = createContext<ViewActions>({ say: () => undefined, readFile: () => Promise.reject(new Error('No file can be read here.')) })

export const useViewActions = () => useContext(ViewActionsContext)
