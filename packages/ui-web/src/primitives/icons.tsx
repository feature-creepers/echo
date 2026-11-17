import type { ReactNode } from 'react'

/**
 * The few glyphs the frame of the app needs, drawn here as strokes so they take the colour of their text.
 * They are part of the app's own chrome. Nothing the assistant shows uses them: it draws its own.
 */
function Glyph({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const SettingsGlyph = () => (
  <Glyph>
    <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
    <circle cx="10" cy="4.5" r="1.5" />
    <circle cx="6" cy="11.5" r="1.5" />
  </Glyph>
)

export const TranscriptGlyph = () => (
  <Glyph>
    <path d="M3 4h10M3 8h7M3 12h9" />
  </Glyph>
)

export const MicGlyph = ({ size }: { size?: number }) => (
  <Glyph {...(size === undefined ? {} : { size })}>
    <rect x="6" y="2" width="4" height="7.5" rx="2" />
    <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2" />
  </Glyph>
)

export const SendGlyph = () => (
  <Glyph>
    <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
  </Glyph>
)

export const StopGlyph = () => (
  <Glyph>
    <rect x="4" y="4" width="8" height="8" rx="1.5" />
  </Glyph>
)

export const CloseGlyph = () => (
  <Glyph>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Glyph>
)

export const CheckGlyph = ({ size = 16 }: { size?: number }) => (
  <Glyph size={size}>
    <path d="m3.5 8.5 3 3 6-7" />
  </Glyph>
)

export const BackGlyph = () => (
  <Glyph>
    <path d="M10 3.5 5.5 8l4.5 4.5" />
  </Glyph>
)

export const PauseGlyph = () => (
  <Glyph>
    <path d="M5.5 3.5v9M10.5 3.5v9" />
  </Glyph>
)

export const PlayGlyph = () => (
  <Glyph>
    <path d="M5 3.5v9l7-4.5z" />
  </Glyph>
)

export const BookmarkGlyph = ({ filled = false }: { filled?: boolean }) => (
  <Glyph>
    <path d="M4.5 2.5h7v11L8 10.8l-3.5 2.7z" fill={filled ? 'currentColor' : 'none'} />
  </Glyph>
)

export const PinGlyph = ({ filled = false }: { filled?: boolean }) => (
  <Glyph>
    <path d="M6 2.5h4l-.6 3.8 2.6 2.2H4l2.6-2.2z" fill={filled ? 'currentColor' : 'none'} />
    <path d="M8 8.5v5" />
  </Glyph>
)

/** The side sheet: a window with its right part set apart. */
export const SheetGlyph = () => (
  <Glyph>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M10 3v10" />
  </Glyph>
)

export const MoreGlyph = () => (
  <Glyph>
    <circle cx="3.5" cy="8" r="0.6" fill="currentColor" />
    <circle cx="8" cy="8" r="0.6" fill="currentColor" />
    <circle cx="12.5" cy="8" r="0.6" fill="currentColor" />
  </Glyph>
)

export const SearchGlyph = () => (
  <Glyph>
    <circle cx="7" cy="7" r="4" />
    <path d="m10 10 3.5 3.5" />
  </Glyph>
)

export const VolumeGlyph = ({ muted = false }: { muted?: boolean }) => (
  <Glyph>
    <path d="M2.5 6h2.5l3.5-3v10l-3.5-3H2.5z" />
    {muted ? <path d="m11 6 3 3m0-3-3 3" /> : <path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4" />}
  </Glyph>
)

export const TrashGlyph = () => (
  <Glyph>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
  </Glyph>
)

export const ArrowGlyph = () => (
  <Glyph>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </Glyph>
)

/** What a card is dragged by: two columns of dots. */
export const GripGlyph = () => (
  <Glyph>
    <circle cx="6" cy="4" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="10" cy="4" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="6" cy="8" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="10" cy="8" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="6" cy="12" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="10" cy="12" r="0.9" fill="currentColor" stroke="none" />
  </Glyph>
)

/** Something that folds open downwards. Turned, it folds the other way. */
export const ChevronGlyph = () => (
  <Glyph>
    <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
  </Glyph>
)

/** Bring something to the stage: a frame with an arrow going into it. */
export const ExpandGlyph = () => (
  <Glyph>
    <path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" />
  </Glyph>
)

/** Fold a panel away to the edge it came from. */
export const CollapseGlyph = () => (
  <Glyph>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M10 3v10M5.5 6.5 7 8l-1.5 1.5" />
  </Glyph>
)

/** The pinned widgets: a window with a panel down each side of its content, as the docks stand beside the conversation. */
export const WidgetsGlyph = () => (
  <Glyph>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <rect x="4" y="5.25" width="2" height="5.5" rx="0.5" />
    <rect x="10" y="5.25" width="2" height="5.5" rx="0.5" />
  </Glyph>
)
