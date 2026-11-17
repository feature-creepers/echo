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
  /**
   * Set when the view may start what it plays by itself: it was just shown in answer to the person. The value
   * is a key for that showing, so drawing the view again does not start it again. Left out, nothing starts.
   */
  autoplay?: string | undefined
}

export const ViewActionsContext = createContext<ViewActions>({ say: () => undefined, readFile: () => Promise.reject(new Error('No file can be read here.')) })

export const useViewActions = () => useContext(ViewActionsContext)
