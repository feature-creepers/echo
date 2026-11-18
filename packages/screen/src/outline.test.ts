import { describe, expect, it } from 'vitest'
import { outlineOf, roleOf, type TreeNode } from './outline.ts'

describe('the outline of a window', () => {
  it.each([
    ['ControlType.Button', 'button'],
    ['ControlType.ListItem', 'list item'],
    ['AXTextField', 'text field'],
    ['AXSecureTextField', 'password field'],
    ['AXStaticText', 'text'],
    ['push button', 'button'],
    ['password text', 'password field']
  ])('reads the role %s as "%s"', (role, read) => {
    expect(roleOf(role)).toBe(read)
  })

  const nodes: TreeNode[] = [
    { key: 'k1', role: 'ControlType.Pane', name: '', depth: 0 },
    { key: 'k2', role: 'ControlType.MenuBar', name: 'Application', depth: 1 },
    { key: 'k3', role: 'ControlType.MenuItem', name: 'File', depth: 2 },
    { key: 'k4', role: 'ControlType.Edit', name: 'Text editor', value: 'Dear Ada,', depth: 1 },
    { key: 'k5', role: 'ControlType.Edit', name: 'Password', value: 'hunter2', password: true, depth: 1 },
    { key: 'k6', role: 'ControlType.Button', name: 'Save', enabled: false, depth: 1 }
  ]

  it('keeps what is named or usable, lets the rest give way to its children, and never shows a password', () => {
    const outline = outlineOf(nodes, 10_000)
    expect(outline.text.split('\n')).toEqual([
      '- menu bar "Application" [e1]',
      '  - menu item "File" [e2]',
      '- edit "Text editor" = "Dear Ada," [e3]',
      '- edit "Password" [e4]',
      '- button "Save" (disabled) [e5]'
    ])
    expect(outline.cut).toBe(false)
    expect([...outline.keys]).toEqual([
      ['e1', 'k2'],
      ['e2', 'k3'],
      ['e3', 'k4'],
      ['e4', 'k5'],
      ['e5', 'k6']
    ])
  })

  it('cuts at the length asked, and numbers its references from where it is told', () => {
    const outline = outlineOf(nodes, 70, 40)
    expect(outline.cut).toBe(true)
    expect(outline.text.split('\n')).toEqual(['- menu bar "Application" [e40]', '  - menu item "File" [e41]'])
    expect([...outline.keys.keys()]).toEqual(['e40', 'e41'])
  })
})
