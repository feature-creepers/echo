/** Corner radii, in pixels. Small: the look is flat and precise, not soft. */
export const radius = { sm: 4, md: 8, lg: 12, xl: 18 } as const

export type RadiusName = keyof typeof radius
