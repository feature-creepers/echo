import { createContext, useContext } from 'react'

/** What a block can do besides draw: say something to the assistant on the user's behalf. */
export interface ViewActions {
  say(text: string): void
}

export const ViewActionsContext = createContext<ViewActions>({ say: () => undefined })

export const useViewActions = () => useContext(ViewActionsContext)
