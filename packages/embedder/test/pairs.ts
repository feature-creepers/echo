/**
 * Sentences in English and French, as the person says them (the query) and as memory keeps them (the passage). The
 * floor of search by meaning is the similarity that keeps every pair of the first list and drops every pair of the
 * second (`MEANING_FLOOR` in `@repo/core`).
 */

/** Pairs that say the same thing, across the two languages. */
export const SAME: ReadonlyArray<[query: string, passage: string]> = [
  ['The car is parked on level three.', 'La voiture est garée au niveau trois.'],
  ['My sister’s birthday is on the twelfth of March.', 'L’anniversaire de ma sœur est le douze mars.'],
  ['We decided to go to Porto in the spring.', 'Nous avons décidé d’aller à Porto au printemps.'],
  ['The plumber comes on Thursday to fix the leak.', 'Le plombier vient jeudi réparer la fuite.'],
  ['I don’t drink coffee, I prefer green tea.', 'Je ne bois pas de café, je préfère le thé vert.'],
  ['The meeting with the architect was moved to Friday.', 'Le rendez-vous avec l’architecte a été déplacé à vendredi.'],
  ['My daughter starts school in September.', 'Ma fille entre à l’école en septembre.'],
  ['Remind me to call the bank tomorrow morning.', 'Rappelle-moi d’appeler la banque demain matin.'],
  ['My wife is allergic to peanuts.', 'Ma femme est allergique aux cacahuètes.'],
  ['The kids are at their grandmother’s this weekend.', 'Les enfants sont chez leur grand-mère ce week-end.'],
  ['I want to repaint the living room in green.', 'Je veux repeindre le salon en vert.'],
  ['Our flight to Montreal is on the fourth of July.', 'Notre vol pour Montréal est le quatre juillet.'],
  ['I run every morning before work.', 'Je cours tous les matins avant le travail.'],
  ['J’ai perdu les clés de la maison.', 'I lost the house keys.'],
  ['Le train pour Lyon part à huit heures.', 'The train to Lyon leaves at eight o’clock.'],
  ['Mon médecin s’appelle le docteur Martin.', 'My doctor is called Doctor Martin.'],
  ['Le budget pour la cuisine est de dix mille euros.', 'The kitchen budget is ten thousand euros.'],
  ['On a rendez-vous chez le dentiste mardi à quinze heures.', 'We have a dentist appointment on Tuesday at 3 pm.'],
  ['Mon frère habite à Bordeaux.', 'My brother lives in Bordeaux.'],
  ['J’ai arrêté de fumer en janvier.', 'I quit smoking in January.']
]

/** Pairs about different things, some of them close in form ("lost the keys", "lost the phone"). */
export const UNRELATED: ReadonlyArray<[query: string, passage: string]> = [
  ['The car is parked on level three.', 'Ma fille entre à l’école en septembre.'],
  ['What is the weather like today?', 'J’ai perdu les clés de la maison.'],
  ['Play some jazz.', 'L’anniversaire de ma sœur est le douze mars.'],
  ['Comment s’appelle le chien du voisin ?', 'The meeting with the architect was moved to Friday.'],
  ['Where did I park the car?', 'Je ne bois pas de café, je préfère le thé vert.'],
  ['Quand vient le plombier ?', 'We decided to go to Porto in the spring.'],
  ['How much did the new laptop cost?', 'Le train pour Lyon part à huit heures.'],
  ['Mets un minuteur de dix minutes.', 'My doctor is called Doctor Martin.'],
  ['What did we say about the garden?', 'La réunion du conseil municipal est reportée.'],
  ['Tell me a joke.', 'The plumber is coming on Thursday about the leak in the kitchen.'],
  ['The car is parked on level three.', 'La voiture a besoin d’une révision.'],
  ['My sister’s birthday is on the twelfth of March.', 'Mon frère habite à Bordeaux.'],
  ['The plumber comes on Thursday to fix the leak.', 'Le peintre vient lundi pour le salon.'],
  ['Our flight to Montreal is on the fourth of July.', 'Le train pour Lyon part à huit heures.'],
  ['I run every morning before work.', 'Je ne bois pas de café, je préfère le thé vert.'],
  ['Remind me to call the bank tomorrow morning.', 'The meeting with the architect was moved to Friday.'],
  ['Mon médecin s’appelle le docteur Martin.', 'My dentist appointment is on Tuesday.'],
  ['J’ai perdu les clés de la maison.', 'I lost my phone at the station.'],
  ['What should I cook tonight?', 'Ma femme est allergique aux cacahuètes.'],
  ['Quel temps fait-il demain ?', 'Our flight to Montreal is on the fourth of July.']
]
