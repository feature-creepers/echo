import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { folder, removeFolders } from '../../test/sessions.ts'
import { createCli, NotInstalled } from './cli.ts'
import { locate } from './locate.ts'
import { platform } from './platform/index.ts'

afterEach(removeFolders)

/** A file a system would run, named the way this system names programs. */
function program(at: string, name: string): string {
  const file = join(at, platform.fileNames(name, {})[0] ?? name)
  writeFileSync(file, '')
  chmodSync(file, 0o755)
  return file
}

describe('finding a program', () => {
  it('finds it in a folder of the search path, the first one that has it', () => {
    const [empty, first, second] = [folder(), folder(), folder()]
    const expected = program(first, 'assistant-cli')
    program(second, 'assistant-cli')

    expect(locate('assistant-cli', { PATH: [empty, first, second].join(delimiter) }, [])).toBe(expected)
  })

  it('finds it where it is usually installed when the search path does not have it', () => {
    const usual = program(folder(), 'assistant-cli')
    expect(locate('assistant-cli', { PATH: folder() }, [join(folder(), 'missing'), usual])).toBe(usual)
  })

  it('does not take a folder for a program', () => {
    const at = folder()
    mkdirSync(join(at, platform.fileNames('assistant-cli', {})[0] ?? ''))
    expect(locate('assistant-cli', { PATH: at }, [at])).toBeUndefined()
  })

  it('finds nothing when it is nowhere', () => {
    expect(locate('assistant-cli', { PATH: '' }, [])).toBeUndefined()
  })
})

describe('the user’s CLI', () => {
  const options = (env: Record<string, string>, usual: string[] = []) => ({
    program: 'assistant-cli',
    usualLocations: () => usual,
    notInstalled: 'It is not installed.',
    env
  })

  it('is started where it was found, in the environment given', async () => {
    const at = folder()
    const file = program(at, 'assistant-cli')
    const launch = await createCli(options({ PATH: at, CLAUDECODE: '1' })).launch()

    expect(launch).toEqual({ command: { program: file, leading: [] }, env: { PATH: at } })
  })

  it('is started with the command given instead, when there is one', async () => {
    const cli = createCli({ ...options({ PATH: '' }), command: ['node', 'fake.ts'] })
    expect((await cli.launch()).command).toEqual({ program: 'node', leading: ['fake.ts'] })
  })

  it('rejects, with words for the user, when it is not installed', async () => {
    const cli = createCli(options({ PATH: folder() }))
    await expect(cli.launch()).rejects.toThrow(NotInstalled)
    await expect(cli.launch()).rejects.toThrow('It is not installed.')
    expect(await cli.find()).toBeUndefined()
  })

  it('is found once installed, without starting over', async () => {
    const at = folder()
    const cli = createCli(options({ PATH: at }))
    await expect(cli.launch()).rejects.toThrow(NotInstalled)

    const file = program(at, 'assistant-cli')
    expect((await cli.launch()).command.program).toBe(file)
  })

  it('is looked for where the environment says the user’s home is', async () => {
    const seen: string[] = []
    const cli = createCli({
      ...options({ PATH: '', HOME: '/home/ada', USERPROFILE: '/home/ada' }),
      usualLocations: (home) => {
        seen.push(home)
        return []
      }
    })
    await cli.find()

    expect(seen).toEqual(['/home/ada'])
  })
})
