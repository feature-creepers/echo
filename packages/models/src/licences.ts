import type { Licence } from './model-set.ts'

/**
 * The licences the models of the catalogue are published under, read at their hosts. What each asks is said in a
 * sentence for the person who downloads a model; a licence that forbids uses keeps them in its own words, since the
 * person agrees to them by downloading the model.
 */

/** Creative Commons Attribution 4.0: free to use and share, with credit to the makers and a word on any change. */
export const CC_BY_4: Licence = {
  name: 'CC BY 4.0',
  url: 'https://creativecommons.org/licenses/by/4.0/legalcode.en',
  asks: 'free to use and share, crediting its makers.'
}

export const MIT: Licence = {
  name: 'MIT',
  url: 'https://opensource.org/license/mit',
  asks: 'free to use and share, keeping its copyright notice.'
}

/**
 * BigScience's Open RAIL-M of 18 August 2022, as Supertone publishes it beside its model. Its paragraph 5 has those who
 * pass the model on require every user to keep to the restrictions of its Attachment A, quoted here whole.
 */
export const OPENRAIL_M: Licence = {
  name: 'OpenRAIL-M',
  url: 'https://huggingface.co/Supertone/supertonic-3/blob/3cadd1ee6394adea1bd021217a0e650ede09a323/LICENSE',
  asks: 'free to use, except in the ways it forbids, which you agree to by downloading it.',
  restrictions: {
    lead: 'You agree not to use the Model or Derivatives of the Model:',
    uses: [
      'In any way that violates any applicable national, federal, state, local or international law or regulation;',
      'For the purpose of exploiting, harming or attempting to exploit or harm minors in any way;',
      'To generate or disseminate verifiably false information and/or content with the purpose of harming others;',
      'To generate or disseminate personal identifiable information that can be used to harm an individual;',
      'To generate or disseminate information and/or content (e.g. images, code, posts, articles), and place the information and/or content in any context (e.g. bot generating tweets) without expressly and intelligibly disclaiming that the information and/or content is machine generated;',
      'To defame, disparage or otherwise harass others;',
      'To impersonate or attempt to impersonate (e.g. deepfakes) others without their consent;',
      'For fully automated decision making that adversely impacts an individual’s legal rights or otherwise creates or modifies a binding, enforceable obligation;',
      'For any use intended to or which has the effect of discriminating against or harming individuals or groups based on online or offline social behavior or known or predicted personal or personality characteristics;',
      'To exploit any of the vulnerabilities of a specific group of persons based on their age, social, physical or mental characteristics, in order to materially distort the behavior of a person pertaining to that group in a manner that causes or is likely to cause that person or another person physical or psychological harm;',
      'For any use intended to or which has the effect of discriminating against individuals or groups based on legally protected characteristics or categories;',
      'To provide medical advice and medical results interpretation;',
      'To generate or disseminate information for the purpose to be used for administration of justice, law enforcement, immigration or asylum processes, such as predicting an individual will commit fraud/crime commitment (e.g. by text profiling, drawing causal relationships between assertions made in documents, indiscriminate and arbitrarily-targeted use).'
    ]
  }
}
