import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { folder, removeFolders } from '../../test/sessions.ts'
import { codexChoices, codexModels, modelName } from './models.ts'

afterAll(() => removeFolders())

function home(cache?: unknown): string {
  const at = folder()
  if (cache !== undefined) writeFileSync(join(at, 'models_cache.json'), JSON.stringify(cache))
  return at
}

describe('the models Codex offers', () => {
  it('are named for a person, and described in plain words', () => {
    expect(modelName('gpt-6.1-terra')).toBe('GPT-6.1 Terra')
    expect(modelName('gpt-7')).toBe('GPT-7')
    expect(modelName('o9-mini')).toBe('O9 Mini')
  })

  it('come from the list Codex keeps, in its order, without the hidden ones, the balanced one by default', async () => {
    const choices = await codexChoices(
      home({
        models: [
          { slug: 'gpt-7-sol', display_name: 'gpt-7-sol', description: 'Frontier agentic coding model.', visibility: 'list' },
          { slug: 'gpt-7-terra', visibility: 'list' },
          { slug: 'secret', visibility: 'hide' },
          { slug: 'gpt-7-nova', display_name: 'Nova', description: 'Something new.', visibility: 'list' }
        ]
      })
    )
    expect(choices.default).toBe('gpt-7-terra')
    expect(choices.models.map((model) => model.id)).toEqual(['gpt-7-sol', 'gpt-7-terra', 'gpt-7-nova'])
    expect(choices.models[0]).toMatchObject({ name: 'GPT-7 Sol', description: expect.stringContaining('most capable') })
    expect(choices.models[2]).toEqual({ id: 'gpt-7-nova', name: 'Nova', description: 'Something new.' })
  })

  it('fall back to a built-in list when Codex has not written its own', async () => {
    const choices = await codexChoices(home())
    expect(choices.default).toBe('gpt-6.1-terra')
    expect(choices.models.map((model) => model.id)).toEqual(['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna'])
  })

  it('give the roles their model: the balanced one answers, the fast one routes and summarises', async () => {
    expect(await codexModels(home())).toEqual({ orchestrator: 'gpt-6-luna', thread: 'gpt-6.1-terra', utility: 'gpt-6-luna' })
    expect(await codexModels(home(), { thread: 'gpt-6.1-sol' })).toMatchObject({ thread: 'gpt-6.1-sol', orchestrator: 'gpt-6-luna' })
  })
})
