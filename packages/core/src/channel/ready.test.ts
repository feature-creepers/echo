import { describe, expect, it } from 'vitest'
import { readySentence } from './ready.ts'

describe('the sentence that says answers are ready', () => {
  it.each([
    [['Recipe'], 'en', "By the way, it's ready: Recipe."],
    [['Recipe', 'Housing form'], 'en', 'By the way, these are ready: Recipe and Housing form.'],
    [['Recipe', 'Housing form', 'Trip'], 'en', 'By the way, these are ready: Recipe, Housing form, and Trip.'],
    [['Recette'], 'fr', "Au fait, c'est prêt : Recette."],
    [['Recette', 'Voyage'], 'fr', "Au fait, c'est prêt : Recette et Voyage."],
    [['Receta', 'Viaje'], 'es', 'Por cierto, ya están listos: Receta y Viaje.'],
    [['Rezept'], 'de', 'Übrigens, das ist fertig: Rezept.'],
    [['Ricetta'], 'it', 'A proposito, è pronto: Ricetta.'],
    [['Receita'], 'pt', 'A propósito, está pronto: Receita.'],
    [['Recept'], 'nl', 'Trouwens, het is klaar: Recept.'],
    // A language the core has no words for, or none known, is said in English.
    [['Recipe'], 'ja', "By the way, it's ready: Recipe."],
    [['Recipe'], undefined, "By the way, it's ready: Recipe."],
    // A title that ends a sentence of its own does not end it twice.
    [['What to cook tonight?'], 'en', "By the way, it's ready: What to cook tonight."]
  ] as const)('names %j in %s', (titles, language, sentence) => {
    expect(readySentence(titles, language)).toBe(sentence)
  })
})
