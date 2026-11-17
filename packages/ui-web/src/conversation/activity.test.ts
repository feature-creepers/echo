import { describe, expect, it } from 'vitest'
import { doing } from './activity.ts'

describe('what the assistant is doing', () => {
  it('names the tools a person waits on, and leaves routing to "Thinking"', () => {
    expect(doing('web_search')).toBe('Searching the web')
    expect(doing('thread_open')).toBeUndefined()
    expect(doing('a_new_tool')).toBe('Working')
    expect(doing(undefined)).toBeUndefined()
  })
})
