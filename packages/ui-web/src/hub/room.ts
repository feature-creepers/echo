/** The hub's sidebar, in pixels, as it is drawn (w-56). */
const HUB_SIDEBAR = 224

/** The narrowest the hub's page is read at beside the side sheet, in pixels. */
const HUB_PAGE_LEAST = 512

/** What the hub keeps for itself beside the side sheet: its sidebar and a readable page. */
export const HUB_KEEPS = HUB_SIDEBAR + HUB_PAGE_LEAST

/** What the conversation keeps for itself beside the side sheet: the core, the caption and a card readable. */
export const STAGE_KEEPS = 480
