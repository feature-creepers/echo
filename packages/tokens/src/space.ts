/** The spacing scale, in pixels. Every gap and padding is one of these. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48, huge: 64 } as const

export type SpaceName = keyof typeof space

/** Corner radii, in pixels. Small: the look is flat and digital, not rounded. */
export const radius = { control: 4, panel: 6 } as const
