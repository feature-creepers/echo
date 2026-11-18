import { describe, expect, it } from 'vitest'
import type { ComputerUse } from '../ports/harness.ts'
import { readCommand } from './commands.ts'
import { type Decision, decide, type Policy } from './policy.ts'

const FOLDER = '/home/person/project'

const run = (command: string, reach: 'read' | 'write' = 'write'): ComputerUse => ({ action: 'run', tool: 'Bash', paths: [FOLDER], command, reach })
const file = (action: 'create' | 'change' | 'delete'): ComputerUse => ({ action, tool: 'Write', paths: [`${FOLDER}/notes.md`] })

const guarded = (approvals: Policy['approvals']): Policy => ({ approvals, askDestroying: true, askPublishing: true })
const open = (approvals: Policy['approvals']): Policy => ({ approvals, askDestroying: false, askPublishing: false })

const RUNS = (because: 'read-only' | 'level' | 'session'): Decision => ({ run: true, because })
const ASKS = (destructive: boolean, session: boolean): Decision => ({ run: false, destructive, session })

/** Each case: what is done, under which policy, whether a yes for the session covers it, and the decision. */
const CASES: [string, ComputerUse, Policy, boolean, Decision][] = [
  ['a read, at any level', { action: 'read', tool: 'Read', paths: [FOLDER] }, guarded('ask'), false, RUNS('read-only')],
  ['a command that only reads', run('git status'), guarded('ask'), false, RUNS('read-only')],
  ['a change, asked at ask', file('change'), guarded('ask'), false, ASKS(false, true)],
  ['a change, covered for the session', file('change'), guarded('ask'), true, RUNS('session')],
  ['a change, made at trust', file('change'), guarded('trust'), false, RUNS('level')],
  ['a command, asked at trust', run('pnpm test'), guarded('trust'), false, ASKS(false, true)],
  ['a command, run at auto where it may change', run('pnpm test'), guarded('auto'), false, RUNS('level')],
  ['a command naming a read-only place, asked at auto', run('pnpm test', 'read'), guarded('auto'), false, ASKS(false, true)],
  ['deleting, guarded: asked at auto, never for the session', run('rm notes.md'), guarded('auto'), false, ASKS(true, false)],
  ['a file deleted, guarded: asked at auto', file('delete'), guarded('auto'), false, ASKS(true, false)],
  ['publishing, guarded: asked at auto', run('git push'), guarded('auto'), false, ASKS(false, true)],
  ['publishing, guarded: covered for the session', run('git push'), guarded('auto'), true, RUNS('session')],
  ['deleting, unguarded: run at auto', run('rm notes.md'), open('auto'), false, RUNS('level')],
  ['deleting, unguarded: asked at trust, and may be allowed for the session', run('rm notes.md'), open('trust'), false, ASKS(true, true)],
  ['deleting, unguarded: covered for the session', run('rm notes.md'), open('trust'), true, RUNS('session')],
  ['a file deleted, unguarded: made at trust', file('delete'), open('trust'), false, RUNS('level')],
  ['a file deleted, unguarded: asked at ask', file('delete'), open('ask'), false, ASKS(false, true)],
  ['publishing, unguarded: run at auto', run('git push'), open('auto'), false, RUNS('level')],
  ['publishing, unguarded: asked at trust', run('git push'), open('trust'), false, ASKS(false, true)],
  ['deleting with only publishing unguarded: still asked', run('rm notes.md'), { ...guarded('auto'), askPublishing: false }, false, ASKS(true, false)]
]

describe('deciding a use', () => {
  it.each(CASES)('%s', (_, use, policy, covered, expected) => {
    const reading = use.action === 'run' ? readCommand(use.command ?? '', 'posix') : undefined
    expect(decide(use, policy, reading, covered)).toEqual(expected)
  })
})
