import { type Chrome, CLEAR } from './chrome.ts'

/**
 * Windows: minimise, maximise and close at the right of the title row, with snap layouts. Their ground is clear: the
 * page's own ground runs under them, so the row is one surface from edge to edge. Only the light the system lays
 * over a button under the pointer is drawn.
 */
export const chrome: Chrome = ({ symbols, height }) => ({
  titleBarStyle: 'hidden',
  titleBarOverlay: { color: CLEAR, symbolColor: symbols, height }
})
