import { z } from 'zod'
import { BLOCKS } from './catalog.ts'
import { signature } from './signature.ts'

/** The name of the tool that shows a view, and of the one that removes it. */
export const SHOW_TOOL = 'ui_render'
export const CLEAR_TOOL = 'ui_clear'
/** How many cards one answer shows at most, side by side (docs/SPEC.md, section 9.2). */
export const CARDS_PER_ANSWER = 4
/** The name of the tool that drives the media player: pause, resume, stop, volume, seeking and the queue. */
export const MEDIA_TOOL = 'media_control'

/**
 * A small view, complete, to show a model the format and the manner. Its subject is arbitrary on purpose. Tests use
 * it too, as a view that is real.
 */
export const EXAMPLE_VIEW = {
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
    `You have a screen beside your voice. Show things on it with ${SHOW_TOOL}: up to ${CARDS_PER_ANSWER} cards per answer, side by side, one call each with a short \`card\` name, each about one thing. The same name replaces a card; your next answer replaces them all. Remove them with ${CLEAR_TOOL}.`,
    'They lie on a row of twelve columns: give the main card `width` "two-thirds" and what supports it "third", two equals "half" each, a table, a map or Questions "full". Left out, the cards share the row evenly.',
    'What you say aloud is shown as the headline over your cards; they carry what is detailed, numerous or visual. Never describe the screen aloud.',
    'Show something when the answer has several items, steps, a comparison, a plan, a document, media to play, or anything better seen than heard. For small talk and one-line facts, speak only.',
    'Offer the visual yourself, without being asked, whenever it fits: a map for places or figures by area, a chart for numbers over time or side by side, a table for items that share properties, a drawing for a shape or how something works.',
    'You can show maps, charts, tables and drawings: never say you cannot show one. When the data is not in hand, find it with your web tools first, then show it.',
    'Aloud, talk about the answer, never about how you made it: no sources, files, codes or corrections, unless asked.',
    "A card carries few words: what matters at a glance, labels of one to three words, figures rather than sentences, never a sentence that repeats what you said. Tomorrow's weather is the sky and the temperature, not humidity, wind and sources.",
    'When you explain at length, show it as you go: call again with the next stage of a card while you speak.',
    '',
    'A view is a flat map of elements. Each element names a block, gives its properties, and lists the elements inside it:',
    '{ "root": "<id>", "elements": { "<id>": { "type": "<Block>", "props": { … }, "children": ["<id>", …] } } }',
    '',
    'The blocks, with their properties (a ? marks one you may leave out):',
    ...blocks,
    '',
    'How to compose:',
    '- Nothing is ready-made for any subject. Compose every view from these blocks for the answer at hand, the way a designer would lay it out.',
    '- Lead with what matters most: the key figure or the answer itself. A view is an answer, not a document: a handful of blocks, no filler, no source list unless asked.',
    '- Group what belongs together in Cards, compare figures with Metrics in a Grid or a Row, show change over time with a Chart, order with Steps or a Timeline.',
    '- Figures by area (votes, incomes, populations by country, state, department) go on a RegionMap: find a public GeoJSON of the areas, read a little of it to learn the property that holds each code, then give one value per code. Where things are (cities, venues, an itinerary) goes on a PlaceMap, with the coordinates you know or find: a list alone does not say where. The few figures that matter go in Metrics beside the map.',
    "- A changing figure (a price, odds, a score) stays current once pinned, with no call to you: give its Metric or Progress a `feed`, a public JSON API's address and the `path` to the figure, keys and indices joined by dots (`scale` 100 makes a share a percentage). A Chart series' `feed` has a `path` to an array whose items give `x` and `y`.",
    '- To play something (a radio, a podcast, a video), find the address of the stream itself with your web tools and play it in a Media block. Never show a link to a web player instead. Do not test the stream first: the player says when it does not play. It plays on when its view goes: to pause, stop, change its volume, seek or queue what plays next, call media_control.',
    '- To ask the person anything that decides what you do next (which way, which option, whether to go ahead with a plan), show Questions, say the question aloud in one short sentence, and stop: never ask in written text, never with a lone button. Ask all you need at once.',
    '- Colours are roles, not hues: accent for the one thing that matters, ok, warn and danger for states, soft and faint for what is secondary.',
    '- Write real content in the language the person speaks. Never placeholder text.',
    `- If ${SHOW_TOOL} answers with problems, correct the view and call it again.`,
    '',
    'An example of the format and the manner (the subject is arbitrary):',
    JSON.stringify(EXAMPLE_VIEW)
  ].join('\n')
}

/** The input of the tool that shows a view, as a JSON Schema. The view itself is checked by `validateView`, which explains what is wrong. */
export const SHOW_TOOL_INPUT = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'A few words saying what the view is about.' },
    card: { type: 'string', description: 'A short name for this card of your answer: "weather", "chart". Left out, the answer is one card.' },
    view: {
      type: 'object',
      description: 'The view: { "root": "<id>", "elements": { "<id>": { "type", "props", "children" } } }.',
      properties: { root: { type: 'string' }, elements: { type: 'object' } },
      required: ['root', 'elements']
    }
  },
  required: ['title', 'view']
} as const
