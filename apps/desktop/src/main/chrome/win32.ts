import { release } from 'node:os'
import { type Chrome, CLEAR, type TitleRow } from './chrome.ts'

/** Mica, the material of Windows 11, is drawn behind a window from Windows 11 2022 Update, build 22621. */
const MICA_BUILD = 22621

/** Minimise, maximise and close at the right of the title row, with snap layouts, in the row's colours. */
export const overlay = ({ background, symbols, height }: TitleRow) => ({
  titleBarStyle: 'hidden' as const,
  titleBarOverlay: { color: background, symbolColor: symbols, height }
})

/**
 * Windows: the system's buttons over the title row and, where Windows draws it, Mica behind the page. The
 * buttons' ground is then clear too, so the row is one surface from edge to edge.
 */
export const chrome: Chrome = (row) => {
  const mica = Number(release().split('.')[2] ?? 0) >= MICA_BUILD
  if (!mica) return { options: overlay(row), vibrant: false }
  return { options: { ...overlay({ ...row, background: CLEAR }), backgroundMaterial: 'mica', backgroundColor: CLEAR }, vibrant: true }
}
