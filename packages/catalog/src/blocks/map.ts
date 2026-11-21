import { z } from 'zod'
import { type Block, TONES } from '../block.ts'

/** A web address the app may load: https only, as for every address a view names. */
const https = z.string().regex(/^https:\/\/\S+$/, 'Give an https:// address.')

const height = z.enum(['short', 'normal', 'tall']).default('normal')

/** A region and its figure. `region` matches the `key` property of one feature of the shapes. */
const regionValue = z.object({
  region: z.union([z.string().min(1), z.number()]).transform(String),
  value: z.number(),
  /** The figure as it should read, when the number alone would not say it: '27.8 %', '1st'. */
  label: z.string().optional()
})

const place = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  label: z.string().min(1),
  /** A few words shown when the place is pointed at: an address, an opening time, a figure. */
  detail: z.string().optional(),
  tone: z.enum(TONES).default('accent')
})

/**
 * Maps are generic: any regions with any figures, any places with any labels. Nothing here knows a country,
 * an election or a subject; the assistant finds the shapes and the figures for the answer at hand.
 */
export const mapBlocks = {
  RegionMap: {
    description:
      'A map of areas coloured by a figure (a choropleth): countries, states, departments, districts, any regions. `shapes` is the https address of a public GeoJSON FeatureCollection of the areas (prefer a simplified, low-resolution file); `key` is the feature property that each `values[].region` matches, such as a code; `name` the property holding the area name. One value per area; areas with none stay empty, or are left out with `onlyValued`. `sequential` for an amount, `diverging` for above and below a `midpoint`.',
    props: z.object({
      shapes: https,
      key: z.string().min(1),
      name: z.string().min(1).optional(),
      values: z.array(regionValue).min(1).max(5000),
      scale: z.enum(['sequential', 'diverging']).default('sequential'),
      /** The value at the centre of a diverging scale. Left out, 0. */
      midpoint: z.number().optional(),
      /** The colour of the high end, and of the low end of a diverging scale. */
      tone: z.enum(TONES).default('accent'),
      lowTone: z.enum(TONES).default('danger'),
      /** The lowest and highest values the colours cover. Left out, those of `values`. */
      domain: z.tuple([z.number(), z.number()]).optional(),
      /** Draw and frame only the areas given a value: a few countries picked out of a file of the whole world. */
      onlyValued: z.boolean().default(false),
      /** What the colour shows, as the legend's title: 'Share of the vote, first round'. */
      legend: z.string().optional(),
      unit: z.string().optional(),
      height
    }),
    children: false
  },
  PlaceMap: {
    description:
      'Places on a map, each a marker with its label: cities, venues, stops, sightings, anything with coordinates. Drawn on a quiet street map framed to fit them all, or over the areas of a GeoJSON `outline` (https) instead. `route` joins them in order, for an itinerary.',
    props: z.object({
      places: z.array(place).min(1).max(500),
      outline: https.optional(),
      route: z.boolean().default(false),
      height
    }),
    children: false
  }
} satisfies Record<string, Block>
