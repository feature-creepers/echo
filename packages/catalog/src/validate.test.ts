import { describe, expect, it } from 'vitest'
import { EXAMPLE_VIEW } from './instructions.ts'
import { MAX_DEPTH, validateView } from './validate.ts'

const problems = (written: unknown) => {
  const result = validateView(written)
  return result.ok ? [] : result.problems
}

const view = (elements: Record<string, { type: string; props?: unknown; children?: string[] }>, root = 'all') => ({ root, elements })

describe('validateView', () => {
  it('accepts the example given to models, and fills in the defaults', () => {
    const result = validateView(EXAMPLE_VIEW)
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.spec.elements.all).toEqual({ type: 'Stack', props: { gap: 'normal', align: 'stretch' }, children: ['title', 'now', 'week'] })
    expect(result.spec.elements.temp?.props).toMatchObject({ label: 'Now', value: '21', unit: '°C', tone: 'normal' })
  })

  it('explains the format when what was written is not a view at all', () => {
    expect(problems('a weather card')).toHaveLength(1)
    expect(problems({ root: 'all' })[0]).toContain('"root"')
  })

  it('names the blocks that exist when one does not', () => {
    const [problem] = problems(view({ all: { type: 'WeatherCard' } }))
    expect(problem).toContain('there is no block named "WeatherCard"')
    expect(problem).toContain('Metric')
  })

  it('says which property of which element is wrong', () => {
    const found = problems(view({ all: { type: 'Stack', children: ['m'] }, m: { type: 'Metric', props: { label: 'Now', value: 21 } } }))
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(/^"m" \(Metric\): value: /)
  })

  it('refuses a property the block does not have, so a model learns it does nothing', () => {
    const found = problems(view({ all: { type: 'Text', props: { text: 'Hello', color: 'red' } } }))
    expect(found.join(' ')).toContain('color')
  })

  it('refuses colours that are not roles of the app', () => {
    const found = problems(view({ all: { type: 'Text', props: { text: 'Hello', tone: '#ff0000' } } }))
    expect(found[0]).toMatch(/^"all" \(Text\): tone: /)
  })

  it.each([
    ['a root that does not exist', view({ a: { type: 'Divider' } }, 'missing'), 'The root "missing" is not one of the elements.'],
    ['a child that does not exist', view({ all: { type: 'Stack', children: ['ghost'] } }), '"all" contains "ghost", which is not one of the elements.'],
    [
      'children in a block that takes none',
      view({ all: { type: 'Text', props: { text: 'x' }, children: ['b'] }, b: { type: 'Divider' } }),
      '"all" (Text) cannot contain other elements.'
    ],
    ['an element that contains itself', view({ all: { type: 'Stack', children: ['all'] } }), '"all" contains itself: all → all.'],
    [
      'an element in two places',
      view({
        all: { type: 'Stack', children: ['a', 'b'] },
        a: { type: 'Stack', children: ['x'] },
        b: { type: 'Stack', children: ['x'] },
        x: { type: 'Divider' }
      }),
      '"x" is inside two elements. An element goes in one place.'
    ],
    [
      'an element that would never show',
      view({ all: { type: 'Stack' }, lost: { type: 'Divider' } }),
      'These elements are in no other element and are not the root, so they would not show: lost.'
    ],
    [
      'a card directly inside a card',
      view({ all: { type: 'Card', children: ['inner'] }, inner: { type: 'Card' } }),
      '"all" is a Card directly inside a Card ("inner"). Use a Section, or put the cards side by side.'
    ]
  ])('refuses %s', (_what, written, problem) => {
    expect(problems(written)).toContain(problem)
  })

  it('refuses a view nested too deep', () => {
    const elements: Record<string, { type: string; children?: string[] }> = {}
    for (let level = 0; level <= MAX_DEPTH; level++) elements[`n${level}`] = { type: 'Stack', children: level < MAX_DEPTH ? [`n${level + 1}`] : [] }
    expect(problems({ root: 'n0', elements }).join(' ')).toContain('levels deep')
  })

  it('reports every problem at once', () => {
    const found = problems(view({ all: { type: 'Stack', children: ['a', 'b'] }, a: { type: 'Nope' }, b: { type: 'Metric', props: {} } }))
    expect(found.length).toBeGreaterThanOrEqual(3)
  })

  it('refuses a drawing whose path is anything else than path commands', () => {
    const drawing = (d: string) => view({ all: { type: 'Drawing', props: { width: 10, height: 10, label: 'x', shapes: [{ shape: 'path', d }] } } })
    expect(problems(drawing('M0 0 L10 10 Z'))).toEqual([])
    expect(problems(drawing('M0 0" onload="alert(1)')).length).toBeGreaterThan(0)
  })

  it('refuses an image that is not served over https', () => {
    const image = (url: string) => view({ all: { type: 'Image', props: { url, alt: 'x' } } })
    expect(problems(image('https://example.com/a.png'))).toEqual([])
    expect(problems(image('javascript:alert(1)')).length).toBeGreaterThan(0)
    expect(problems(image('file:///etc/passwd')).length).toBeGreaterThan(0)
  })
})
