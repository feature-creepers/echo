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
}

export const ViewActionsContext = createContext<ViewActions>({ say: () => undefined, readFile: () => Promise.reject(new Error('No file can be read here.')) })

export const useViewActions = () => useContext(ViewActionsContext)
