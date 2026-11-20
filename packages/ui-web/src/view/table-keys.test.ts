import type { ViewSpec } from '@repo/catalog'
import { describe, expect, it } from 'vitest'
import { tableKeys } from './table-keys.ts'

/** A view of one Table, with these columns and rows. */
const table = (keys: string[], rows: Record<string, string | number>[]): ViewSpec => ({
  root: 'table',
  elements: {
    table: { type: 'Table', props: { columns: keys.map((key) => ({ key, label: key.toUpperCase(), align: 'start' })), rows }, children: [] }
  }
})

/** The Table's properties as the renderer is given them. */
const drawn = (spec: ViewSpec) => tableKeys(spec).elements.table?.props as { columns: { key: string; label: string }[]; rows: unknown[] }

describe("a Table's column keys", () => {
  it.each([
    { name: 'a plain key', keys: ['name'], rows: [{ name: 'Lyon' }], columns: ['0'], cells: [{ '0': 'Lyon' }] },
    { name: '$state, read as an expression otherwise', keys: ['$state'], rows: [{ $state: '/x' }], columns: ['0'], cells: [{ '0': '/x' }] },
    { name: '$template', keys: ['$template'], rows: [{ $template: 'Hello' }], columns: ['0'], cells: [{ '0': 'Hello' }] },
    { name: '$computed', keys: ['$computed'], rows: [{ $computed: 'sum' }], columns: ['0'], cells: [{ '0': 'sum' }] },
    { name: '$bindState', keys: ['$bindState'], rows: [{ $bindState: '/y' }], columns: ['0'], cells: [{ '0': '/y' }] },
    { name: 'a key no column names, left out', keys: ['city'], rows: [{ city: 'Lyon', hidden: 3 }], columns: ['0'], cells: [{ '0': 'Lyon' }] },
    { name: 'a row missing a column, still missing it', keys: ['city', 'rain'], rows: [{ rain: 2 }], columns: ['0', '1'], cells: [{ '1': 2 }] }
  ])('become their positions: $name', ({ keys, rows, columns, cells }) => {
    const props = drawn(table(keys, rows))
    expect(props.columns.map((column) => column.key)).toEqual(columns)
    expect(props.columns.map((column) => column.label)).toEqual(keys.map((key) => key.toUpperCase()))
    expect(props.rows).toEqual(cells)
  })

  it('leave a view with no Table as the same objects', () => {
    const view: ViewSpec = {
      root: 'all',
      elements: { all: { type: 'Stack', props: { gap: 'normal' }, children: ['line'] }, line: { type: 'Text', props: { text: 'Hi' }, children: [] } }
    }
    const keyed = tableKeys(view)
    expect(keyed).toBe(view)
    expect(keyed.elements.all).toBe(view.elements.all)
    expect(keyed.elements.line).toBe(view.elements.line)
  })

  it('leave the other elements of a view with a Table as the same objects', () => {
    const view = table(['name'], [{ name: 'Lyon' }])
    const line = { type: 'Text' as const, props: { text: 'Hi' }, children: [] }
    expect(tableKeys({ ...view, elements: { ...view.elements, line } }).elements.line).toBe(line)
  })
})
