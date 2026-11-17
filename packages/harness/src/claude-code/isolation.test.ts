import { describe, expect, it } from 'vitest'
import { coreToolName, isolationLeaks } from './isolation.ts'

describe('the isolation of Claude Code', () => {
  it('gives a tool of the core its own name back', () => {
    expect(coreToolName('mcp__core__ui_render')).toBe('ui_render')
    expect(coreToolName('mcp__core__memory__search')).toBe('memory__search')
  })

  it('knows a tool that is not the core’s', () => {
    for (const name of ['Bash', 'mcp__other__ui_render', 'mcp__core__', 'core__ui_render', 42, undefined]) expect(coreToolName(name)).toBeUndefined()
  })

  it('finds nothing wrong with a session that has the core’s tools only', () => {
    const init = { tools: ['mcp__core__ui_render'], mcp_servers: [{ name: 'core', status: 'connected' }], slash_commands: [], skills: [], agents: ['Explore'] }
    expect(isolationLeaks(init)).toEqual([])
    expect(isolationLeaks({})).toEqual([])
  })

  it('names what a session has and should not', () => {
    const init = {
      tools: ['Bash', 'Read', 'mcp__core__ui_render', 'mcp__mail__send'],
      mcp_servers: [{ name: 'core' }, { name: 'mail' }],
      slash_commands: ['review'],
      skills: ['pdf'],
      memory_paths: { auto: '/home/ada/.claude/projects/x/memory/' }
    }
    expect(isolationLeaks(init)).toEqual([
      'its own tools (Bash, Read, mcp__mail__send)',
      'other tool servers (mail)',
      'slash commands',
      'skills',
      'its own memory'
    ])
  })
})
