import { z } from 'zod'
import { BLOCKS } from './catalog.ts'
import { signature } from './signature.ts'

/** The name of the tool that shows a view, and of the one that removes it. */
export const SHOW_TOOL = 'ui_render'
export const CLEAR_TOOL = 'ui_clear'
/** The name of the tool that pauses, resumes or stops the media player. */
export const MEDIA_TOOL = 'media_control'

/** A small view, complete, to show a model the format and the manner. Its subject is arbitrary on purpose. */
const EXAMPLE = {
  root: 'all',
  elements: {
    all: { type: 'Stack', props: {}, children: ['title', 'now', 'week'] },
    title: { type: 'Heading', props: { text: 'Lyon, this week', level: 1 } },
    now: { type: 'Row', props: { gap: 'loose' }, children: ['sun', 'temp', 'wind'] },
    sun: {
      type: 'Drawing',
      props: {
        width: 48,
        height: 48,
        size: 'icon',
        label: 'Sun',
        shapes: [
          { shape: 'circle', cx: 24, cy: 24, r: 9, stroke: 'accent', fill: 'accent' },
          { shape: 'line', x1: 24, y1: 3, x2: 24, y2: 9, stroke: 'accent' },
          { shape: 'line', x1: 24, y1: 39, x2: 24, y2: 45, stroke: 'accent' },
          { shape: 'line', x1: 3, y1: 24, x2: 9, y2: 24, stroke: 'accent' },
          { shape: 'line', x1: 39, y1: 24, x2: 45, y2: 24, stroke: 'accent' }
        ]
      }
    },
    temp: { type: 'Metric', props: { label: 'Now', value: '21', unit: '°C', detail: 'Clear sky' } },
    wind: { type: 'Metric', props: { label: 'Wind', value: '12', unit: 'km/h', tone: 'soft' } },
    week: {
      type: 'Chart',
      props: {
        kind: 'line',
        unit: '°C',
        series: [
          {
            name: 'High',
            points: [
              { x: 'Mon', y: 21 },
              { x: 'Tue', y: 23 },
              { x: 'Wed', y: 19 },
              { x: 'Thu', y: 17 },
              { x: 'Fri', y: 20 }
            ]
          }
        ]
      }
    }
  }
}

/**
 * The catalogue described for a model: how a view is written, every block with its properties, and how to
 * compose well. It is part of the instructions of every session that can show things.
 */
export function describeCatalog(): string {
  const blocks = Object.entries(BLOCKS).map(([name, block]) => {
    const props = signature(z.toJSONSchema(block.props, { io: 'input' }) as Parameters<typeof signature>[0])
    return `- ${name} ${props}${block.children ? ' with children' : ''}\n  ${block.description}`
  })

  return [
    'The screen',
    '',
    `You have a screen beside your voice. Show things on it with the ${SHOW_TOOL} tool; remove what is shown with ${CLEAR_TOOL}.`,
    'Say the point aloud first, in a sentence or two, then put what is detailed, numerous or visual on the screen while you are heard. Never describe the screen aloud.',
    'Show something when the answer has several items, steps, a comparison, a plan, a document, media to play, or anything better seen than heard. For small talk and one-line facts, speak only.',
    'Offer the visual yourself, without being asked, whenever it fits: a map for anything about places or how a figure varies from one area to another, a chart for numbers over time or side by side, a table for items that share properties, a drawing for a shape, a diagram or how something works.',
    'You can show maps, charts, tables and drawings: never say you cannot show one. When the data is not in hand, find it with your web tools first, then show it.',
    'Aloud, talk about the answer, never about how you made it: no sources, files, codes or corrections, unless asked.',
    "A view is as concise as the voice: what matters at a glance, never everything you found. Tomorrow's weather is the sky and the temperature, not humidity, wind and sources.",
    'When you explain something at length, show it as you go: call the tool again with the next stage of the view while you speak, so the screen follows what you say.',
    'Each new view replaces the previous one, so a view is complete in itself.',
    '',
    'A view is a flat map of elements. Each element names a block, gives its properties, and lists the elements inside it:',
    '{ "root": "<id>", "elements": { "<id>": { "type": "<Block>", "props": { … }, "children": ["<id>", …] } } }',
    '',
    'The blocks, with their properties (a ? marks one you may leave out):',
    ...blocks,
    '',
    'How to compose:',
    '- Nothing is ready-made for any subject. Compose every view from these blocks for the answer at hand, the way a designer would lay it out.',
    '- Lead with what matters most: one Heading, then the key figure or the answer itself. A view is an answer, not a document: a handful of blocks, no filler, no source list unless asked.',
    '- Group what belongs together in Cards, compare figures with Metrics in a Grid or a Row, show change over time with a Chart, order with Steps or a Timeline.',
    '- When a picture would help, draw it with Drawing: a pictogram, a diagram, a sketch. Keep pictograms simple: a few bold shapes.',
    '- Figures by area (votes, incomes, prices, populations by country, state, department) go on a RegionMap: find a public GeoJSON of the areas, read a little of it to learn the property that holds each code, then give one value per code. Where things are (cities, venues, an itinerary, "where is…", "where are…") goes on a PlaceMap, with the coordinates you know or find: a list alone does not say where. Put a Heading above the map and, if useful, the few figures that matter in Metrics beside it.',
    '- To play something (a radio, a podcast, a video), find the address of the stream itself with your web tools and play it in a Media block. Never show a link to a web player instead. Do not test the stream first: the player tells the person itself if it does not play. It plays on when its view goes: to pause or stop it, call media_control.',
    '- Colours are roles, not hues: accent for the one thing that matters, ok, warn and danger for states, soft and faint for what is secondary.',
    '- Write real content in the language the person speaks. Never placeholder text.',
    `- If ${SHOW_TOOL} answers with problems, correct the view and call it again.`,
    '',
    'An example of the format and the manner (the subject is arbitrary):',
    JSON.stringify(EXAMPLE)
  ].join('\n')
}

/** The input of the tool that shows a view, as a JSON Schema. The view itself is checked by `validateView`, which explains what is wrong. */
export const SHOW_TOOL_INPUT = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'A few words saying what the view is about.' },
    view: {
      type: 'object',
      description: 'The view: { "root": "<id>", "elements": { "<id>": { "type", "props", "children" } } }.',
      properties: { root: { type: 'string' }, elements: { type: 'object' } },
      required: ['root', 'elements']
    }
  },
  required: ['title', 'view']
} as const

/** The example view, for tests and for showing a renderer something real. */
export const EXAMPLE_VIEW = EXAMPLE
