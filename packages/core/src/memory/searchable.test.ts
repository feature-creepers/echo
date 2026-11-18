import { describe, expect, it } from 'vitest'
import { EXCHANGE } from '../channel/channel.ts'
import { FACT } from './facts.ts'
import { keywordsOf, searchableText } from './searchable.ts'

const exchange = { turn: 't1', at: '2026-11-17T08:00:00.000Z', persona: 'first', said: 'My sister lives in Lyon', replied: 'Noted.', outcome: 'done' }

describe('the text a record is found by', () => {
  it('is what both sides said, for an exchange', () => {
    expect(searchableText({ type: EXCHANGE, payload: exchange })).toBe('My sister lives in Lyon\nNoted.')
    expect(searchableText({ type: EXCHANGE, payload: { ...exchange, replied: '' } })).toBe('My sister lives in Lyon')
  })

  it('is the statement, for a fact', () => {
    const fact = { fact: 'f', text: 'The user likes tea.', kind: 'preference', origin: 'told', sources: [], since: exchange.at }
    expect(searchableText({ type: FACT, payload: fact })).toBe('The user likes tea.')
  })

  it('is nothing for an erased record, or one of another type', () => {
    expect(searchableText({ type: EXCHANGE, payload: null })).toBeUndefined()
    expect(searchableText({ type: FACT, payload: null })).toBeUndefined()
    expect(searchableText({ type: 'settings', payload: { said: 'x' } })).toBeUndefined()
  })
})

describe('the words searched for', () => {
  it('leave out the words that carry nothing, in English and in French', () => {
    expect(keywordsOf('What did we decide about the trip in March?')).toEqual(['decide', 'trip', 'march'])
    expect(keywordsOf("Qu'est-ce que j'ai dit à propos de ma sœur Élodie ?")).toEqual(['propos', 'sœur', 'elodie'])
  })

  it('folds case and accents, and keeps each word once', () => {
    expect(keywordsOf('Café CAFÉ cafe 2026')).toEqual(['cafe', '2026'])
    expect(keywordsOf('   ?!  ')).toEqual([])
  })
})
