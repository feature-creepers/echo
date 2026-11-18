import { readPersonaName, STANCES, samePersonaName } from '@repo/protocol'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PERSONAS } from './defaults.ts'

describe('the personas a new user starts with', () => {
  it('each have an identifier of their own', () => {
    const ids = DEFAULT_PERSONAS.map((persona) => persona.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('have names the user could have typed', () => {
    for (const persona of DEFAULT_PERSONAS) expect(readPersonaName(persona.name)).toEqual({ ok: true, name: persona.name })
  })

  it('are never called the same', () => {
    for (const [index, persona] of DEFAULT_PERSONAS.entries()) {
      for (const other of DEFAULT_PERSONAS.slice(index + 1)) expect(samePersonaName(persona.name, other.name)).toBe(false)
    }
  })

  it('offer every stance', () => {
    expect(new Set(DEFAULT_PERSONAS.map((persona) => persona.stance))).toEqual(new Set(STANCES))
  })
})
