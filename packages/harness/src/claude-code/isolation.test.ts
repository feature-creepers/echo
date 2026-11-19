import { describe, expect, it } from 'vitest'
import { coreToolName, isolationArguments, isolationLeaks, reportedToolName, sessionSettings } from './isolation.ts'

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

  it('keeps the CLI’s own web tools only for a session given the web, and reports them by neutral names', () => {
    const files = { instructions: 'i.txt', settings: 's.json' }
    const tools = (args: string[]) => args[args.indexOf('--tools') + 1]
    expect(tools(isolationArguments('haiku', files))).toBe('')
    expect(tools(isolationArguments('haiku', { ...files, web: true }))).toBe('WebSearch,WebFetch')

    expect(reportedToolName('WebSearch', { web: true })).toBe('web_search')
    expect(reportedToolName('WebFetch', { web: true })).toBe('web_read')
    expect(reportedToolName('WebSearch', { web: false })).toBeUndefined()
    expect(reportedToolName('Bash', { web: true })).toBeUndefined()
    expect(reportedToolName('mcp__core__ui_render', { web: true })).toBe('ui_render')
  })

  it("gives a project's session the CLI's own to-do list, and counts it a leak in any other", () => {
    const files = { instructions: 'i.txt', settings: 's.json' }
    const tools = (args: string[]) => args[args.indexOf('--tools') + 1]
    expect(tools(isolationArguments('haiku', { ...files, plan: true }))).toBe('TodoWrite')
    expect(tools(isolationArguments('haiku', files))).toBe('')
    expect(isolationLeaks({ tools: ['TodoWrite'] }, { plan: true })).toEqual([])
    expect(isolationLeaks({ tools: ['TodoWrite'] })).toEqual(['its own tools (TodoWrite)'])
  })

  it('sets how hard the model reasons only when a level was chosen', () => {
    const files = { instructions: 'i.txt', settings: 's.json' }
    const effort = (args: string[]) => (args.includes('--effort') ? args[args.indexOf('--effort') + 1] : undefined)
    expect(effort(isolationArguments('opus', files))).toBeUndefined()
    expect(effort(isolationArguments('opus', files, 'xhigh'))).toBe('xhigh')
  })

  it('takes the web tools for a leak only when the session was not given the web', () => {
    const init = { tools: ['WebSearch', 'WebFetch', 'mcp__core__ui_render'] }
    expect(isolationLeaks(init, { web: true })).toEqual([])
    expect(isolationLeaks(init)).toEqual(['its own tools (WebSearch, WebFetch)'])
  })

  it("gives a thread the CLI's own sub-agents, reports their calls as subagent, and counts them a leak in any other session", () => {
    const files = { instructions: 'i.txt', settings: 's.json' }
    const tools = (args: string[]) => args[args.indexOf('--tools') + 1]
    expect(tools(isolationArguments('haiku', { ...files, agents: true }))).toBe('Task')
    expect(tools(isolationArguments('haiku', { ...files, web: true, plan: true, agents: true }))).toBe('WebSearch,WebFetch,TodoWrite,Task')
    // The CLI names the tool Task when it starts; the model calls it Agent.
    for (const name of ['Task', 'Agent']) {
      expect(reportedToolName(name, { agents: true })).toBe('subagent')
      expect(reportedToolName(name)).toBeUndefined()
    }
    expect(isolationLeaks({ tools: ['Task'] }, { agents: true })).toEqual([])
    expect(isolationLeaks({ tools: ['Task'] })).toEqual(['its own tools (Task)'])
  })

  it("asks about every call of the core's tools in a session with sub-agents, so a sub-agent's can be refused", () => {
    const ask = (settings: Record<string, unknown>) => (settings.permissions as { ask?: string[] } | undefined)?.ask
    expect(ask(sessionSettings([]))).toBeUndefined()
    expect(ask(sessionSettings([], undefined, true))).toEqual(['mcp__core'])
    expect(ask(sessionSettings(['Read', 'Bash'], undefined, true))).toEqual(['Read', 'Bash', 'mcp__core'])
    expect(ask(sessionSettings(['Read']))).toEqual(['Read'])
  })
})
