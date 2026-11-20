import { describe, expect, it } from 'vitest'
import { type MenuEntry, sectionsOf } from './menu.tsx'

const divider: MenuEntry = { divider: true }
const entry = (label: string, checked?: boolean): MenuEntry => ({ label, onSelect: () => undefined, ...(checked === undefined ? {} : { checked }) })

/** Each group as words: a hairline above it, its heading, its entries by label and key. */
const read = (items: readonly MenuEntry[]) =>
  sectionsOf(items).map(
    (section) => `${section.divided ? '— ' : ''}${section.heading ?? '·'}: ${section.entries.map(({ key, item }) => `${item.label}@${key}`).join(' ')}`
  )

describe('the groups of a menu', () => {
  it.each([
    { name: 'entries alone, one group', items: [entry('Open'), entry('Remove')], groups: ['·: Open@0 Remove@1'] },
    {
      name: 'a heading naming the entries under it',
      items: [{ heading: 'Scope' }, entry('Mine', true), entry('Everything', false)],
      groups: ['Scope: Mine@1 Everything@2']
    },
    {
      name: 'a divider then a heading, one group under a hairline',
      items: [entry('Claude Code', true), divider, { heading: 'Model' }, entry('Haiku', true), divider, entry('Settings…')],
      groups: ['·: Claude Code@0', '— Model: Haiku@3', '— ·: Settings…@5']
    },
    {
      name: 'two headings in a row, the second its own group',
      items: [{ heading: 'One' }, { heading: 'Two' }, entry('Last')],
      groups: ['One: ', 'Two: Last@2']
    }
  ] satisfies { name: string; items: MenuEntry[]; groups: string[] }[])('makes $name', ({ items, groups }) => {
    expect(read(items)).toEqual(groups)
  })
})
