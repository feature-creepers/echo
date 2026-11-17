import { release } from 'node:os'
import { type Chrome, CLEAR, type TitleRow } from './chrome.ts'

/** Mica, the material of Windows 11, is drawn behind a window from Windows 11 2022 Update, build 22621. */
const MICA_BUILD = 22621

/**
 * Minimise, maximise and close at the right of the title row, with snap layouts. Their ground is clear: the page's
 * own ground (its dots, the accent's light from the top) runs under them, so the row is one surface from edge to
 * edge. Only the light the system lays over a button under the pointer is drawn.
 */
export const overlay = ({ symbols, height }: TitleRow) => ({
  titleBarStyle: 'hidden' as const,
  titleBarOverlay: { color: CLEAR, symbolColor: symbols, height }
})

/** Windows: the system's buttons over the title row and, where Windows draws it, Mica behind the page. */
export const chrome: Chrome = (row) => {
  const mica = Number(release().split('.')[2] ?? 0) >= MICA_BUILD
  if (!mica) return { options: overlay(row), vibrant: false }
  return { options: { ...overlay(row), backgroundMaterial: 'mica', backgroundColor: CLEAR }, vibrant: true }
}
