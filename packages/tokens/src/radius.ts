/**
 * Corner radii, in pixels. Small on purpose: the look is flat and precise, not soft. The largest is for
 * what holds other things (a panel, the composer, a dialog); everything inside it is rounder by less.
 */
export const radius = { xs: 2, sm: 3, md: 4, lg: 6 } as const

export type RadiusName = keyof typeof radius
