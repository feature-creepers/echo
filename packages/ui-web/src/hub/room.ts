import { clampSheetWidth, sheetBounds } from '../shell/sheet-width.ts'

/** The hub's sidebar, in pixels, as it is drawn (w-56). */
const HUB_SIDEBAR = 224

/** The narrowest the hub's page is read at beside the side sheet, in pixels. */
const HUB_PAGE_LEAST = 512

/** What the hub keeps for itself beside the side sheet when it makes room for it: its sidebar and a readable page. */
export const HUB_KEEPS = HUB_SIDEBAR + HUB_PAGE_LEAST

/**
 * Whether the hub makes room for the side sheet in a window this wide, so nothing of its page is under the sheet:
 * when the sheet, at the width it is drawn at, still leaves the sidebar and a readable page beside it. Narrower,
 * the sheet lies over the page as it does over the main screen, and closing it shows what is under it.
 */
export function hubMakesRoom(windowWidth: number, sheetWidth: number): boolean {
  return windowWidth - clampSheetWidth(sheetWidth, sheetBounds(windowWidth)) >= HUB_KEEPS
}
