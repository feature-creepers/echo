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

export const CheckGlyph = () => (
  <Glyph>
    <path d="m3.5 8.5 3 3 6-7" />
  </Glyph>
)

export const BackGlyph = () => (
  <Glyph>
    <path d="M10 3.5 5.5 8l4.5 4.5" />
  </Glyph>
)
