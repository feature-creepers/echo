import type { ReactNode } from 'react'

/**
 * The glyphs of files and of what can be done with them, drawn as strokes like the rest of the app's chrome, so
 * they take the colour of their text. Nothing the assistant shows uses them: it draws its own.
 */
function Glyph({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

type Sized = { size?: number }
const sized = ({ size }: Sized) => (size === undefined ? {} : { size })

export const PaperclipGlyph = (props: Sized) => (
  <Glyph {...sized(props)}>
    <path d="M10.5 4.5 5.6 9.4a1.4 1.4 0 0 0 2 2l5-5a2.8 2.8 0 0 0-4-4l-5 5a4.2 4.2 0 0 0 6 6l4.4-4.4" />
  </Glyph>
)

export const FolderGlyph = (props: Sized) => (
  <Glyph {...sized(props)}>
    <path d="M2 4.5V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5H3a1 1 0 0 0-1 1Z" />
  </Glyph>
)

export const FileGlyph = (props: Sized) => (
  <Glyph {...sized(props)}>
    <path d="M4 2.5h5L12.5 6v7.5a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5v-11A.5.5 0 0 1 4 2.5ZM9 2.5V6h3.5" />
  </Glyph>
)

/** Look at something without opening it: an eye. */
export const PreviewGlyph = (props: Sized) => (
  <Glyph {...sized(props)}>
    <path d="M1.8 8s2.3-4.3 6.2-4.3S14.2 8 14.2 8 11.9 12.3 8 12.3 1.8 8 1.8 8Z" />
    <circle cx="8" cy="8" r="1.9" />
  </Glyph>
)

/** Show something in its folder: a folder with an arrow pointing into it. */
export const RevealGlyph = (props: Sized) => (
  <Glyph {...sized(props)}>
    <path d="M2 4.5V12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3.5H3a1 1 0 0 0-1 1Z" />
    <path d="M6.5 9h3.5M8.6 7.6 10 9l-1.4 1.4" />
  </Glyph>
)

export const CopyGlyph = (props: Sized) => (
  <Glyph {...sized(props)}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.2" />
    <path d="M10.5 3.5v-.3a.7.7 0 0 0-.7-.7H3.2a.7.7 0 0 0-.7.7v6.6a.7.7 0 0 0 .7.7h.3" />
  </Glyph>
)

export const DownloadGlyph = (props: Sized) => (
  <Glyph {...sized(props)}>
    <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
  </Glyph>
)

export const RefreshGlyph = (props: Sized) => (
  <Glyph {...sized(props)}>
    <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.8h-2.8" />
  </Glyph>
)

/** The versions kept of a file: a clock whose hand turns back. */
export const VersionsGlyph = (props: Sized) => (
  <Glyph {...sized(props)}>
    <path d="M2.8 8a5.2 5.2 0 1 0 1.5-3.7M2.5 2.5v2.3h2.3M8 5v3l2 1.3" />
  </Glyph>
)

/** Open something with its own app: an arrow out of a frame. */
export const OpenGlyph = (props: Sized) => (
  <Glyph {...sized(props)}>
    <path d="M9.5 2.5h4v4M13.5 2.5 8 8M11.5 9.5V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5h3.5" />
  </Glyph>
)

/** Something folded open or shut in a list: a small chevron pointing right, turned down when open. */
export const DisclosureGlyph = (props: Sized) => (
  <Glyph {...sized(props)}>
    <path d="m6.5 4.5 3.5 3.5-3.5 3.5" />
  </Glyph>
)
