import type { Chrome } from './chrome.ts'

/** Windows: minimise, maximise and close at the right of the title row, with snap layouts, in the row's colours. */
export const chrome: Chrome = ({ background, symbols, height }) => ({
  titleBarStyle: 'hidden',
  titleBarOverlay: { color: background, symbolColor: symbols, height }
})
