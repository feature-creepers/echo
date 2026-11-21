import type { ReactNode } from 'react'

/**
 * The few glyphs the frame of the app needs, drawn here as strokes so they take the colour of their text, with square
 * ends and corners as the rest of the interface has.
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
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/**
 * Library and settings: a page of content, as a square with three lines of text in it, the last one
 * shorter. Its strokes sit on half pixels, so at 16 pixels each one covers a whole row of the screen.
 */
export const LibraryGlyph = () => (
  <Glyph>
    <rect x="2.5" y="2.5" width="11" height="11" />
    <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
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
    <rect x="2.5" y="3.5" width="11" height="9" />
    <path d="M9.5 3.5v9" />
  </Glyph>
)

/** The transcript: lines of what was said, alternating sides, as a conversation reads. */
export const TranscriptGlyph = ({ size = 14 }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M2.5 4h7M6.5 8h7M2.5 12h5" />
  </Glyph>
)

/** The threads: one line that branches into others, as work handed on does. */
export const ThreadsGlyph = ({ size = 14 }: { size?: number }) => (
  <Glyph size={size}>
    <rect x="2.5" y="2" width="3" height="3" />
    <rect x="2.5" y="11" width="3" height="3" />
    <rect x="10.5" y="6.5" width="3" height="3" />
    <path d="M4 5v6M4 8h6.5" />
  </Glyph>
)

/** The inspector: a pulse, as the events going by. */
export const InspectorGlyph = ({ size = 14 }: { size?: number }) => (
  <Glyph size={size}>
    <path d="M1.5 8h3l2-4.5 3 9 2-4.5h3" />
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

export const EditGlyph = () => (
  <Glyph>
    <path d="M10.5 3.5 12.5 5.5M3.5 12.5l.5-2.5 6.5-6.5 2 2-6.5 6.5-2.5.5Z" />
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

/** What a card is dragged by: two columns of small squares. */
export const GripGlyph = () => (
  <Glyph>
    <rect x="5" y="3" width="2" height="2" fill="currentColor" stroke="none" />
    <rect x="9" y="3" width="2" height="2" fill="currentColor" stroke="none" />
    <rect x="5" y="7" width="2" height="2" fill="currentColor" stroke="none" />
    <rect x="9" y="7" width="2" height="2" fill="currentColor" stroke="none" />
    <rect x="5" y="11" width="2" height="2" fill="currentColor" stroke="none" />
    <rect x="9" y="11" width="2" height="2" fill="currentColor" stroke="none" />
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

/**
 * The pinned widgets: four tiles of different heights in two columns, a tall one over a short one and a short one
 * over a tall one, as widgets of different sizes docked in columns. Four equal squares would read as a grid view.
 */
export const WidgetsGlyph = () => (
  <Glyph>
    <rect x="2.5" y="2.5" width="4.5" height="6" />
    <rect x="9" y="2.5" width="4.5" height="3" />
    <rect x="9" y="7.5" width="4.5" height="6" />
    <rect x="2.5" y="10.5" width="4.5" height="3" />
  </Glyph>
)
