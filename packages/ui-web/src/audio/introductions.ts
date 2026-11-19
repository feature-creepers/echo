import type { LanguageCode } from '@repo/protocol'

/** A persona introducing itself, in each language the voice speaks: what it says to be heard there before it is picked. */
const INTRODUCTIONS: Record<LanguageCode, (name: string) => string> = {
  en: (name) => `Hello, I am ${name}. This is how I sound.`,
  fr: (name) => `Bonjour, je suis ${name}. Voici ma voix.`,
  ar: (name) => `مرحبًا، أنا ${name}. هكذا يبدو صوتي.`,
  bg: (name) => `Здравейте, аз съм ${name}. Ето как звучи гласът ми.`,
  hr: (name) => `Dobar dan, ja sam ${name}. Ovako zvuči moj glas.`,
  cs: (name) => `Dobrý den, jsem ${name}. Takhle zní můj hlas.`,
  da: (name) => `Goddag, jeg er ${name}. Sådan lyder min stemme.`,
  nl: (name) => `Hallo, ik ben ${name}. Zo klinkt mijn stem.`,
  et: (name) => `Tere, mina olen ${name}. Nii kõlab minu hääl.`,
  fi: (name) => `Hei, olen ${name}. Tältä ääneni kuulostaa.`,
  de: (name) => `Guten Tag, ich bin ${name}. So klingt meine Stimme.`,
  el: (name) => `Γεια σας, είμαι ${name}. Έτσι ακούγεται η φωνή μου.`,
  hi: (name) => `नमस्ते, मैं ${name} हूँ। मेरी आवाज़ ऐसी है।`,
  hu: (name) => `Jó napot, ${name} vagyok. Így hangzik a hangom.`,
  id: (name) => `Halo, saya ${name}. Beginilah suara saya.`,
  it: (name) => `Buongiorno, sono ${name}. Questa è la mia voce.`,
  ja: (name) => `こんにちは、${name}です。これが私の声です。`,
  ko: (name) => `안녕하세요, 저는 ${name}입니다. 제 목소리는 이렇습니다.`,
  lv: (name) => `Labdien, es esmu ${name}. Tāda ir mana balss.`,
  lt: (name) => `Laba diena, aš esu ${name}. Taip skamba mano balsas.`,
  pl: (name) => `Dzień dobry, jestem ${name}. Tak brzmi mój głos.`,
  pt: (name) => `Olá, eu sou ${name}. Esta é a minha voz.`,
  ro: (name) => `Bună ziua, sunt ${name}. Așa sună vocea mea.`,
  ru: (name) => `Здравствуйте, я ${name}. Так звучит мой голос.`,
  sk: (name) => `Dobrý deň, som ${name}. Takto znie môj hlas.`,
  sl: (name) => `Pozdravljeni, sem ${name}. Tako zveni moj glas.`,
  es: (name) => `Hola, soy ${name}. Así suena mi voz.`,
  sv: (name) => `Hej, jag heter ${name}. Så här låter min röst.`,
  tr: (name) => `Merhaba, ben ${name}. Sesim böyle duyuluyor.`,
  uk: (name) => `Добрий день, я ${name}. Так звучить мій голос.`,
  vi: (name) => `Xin chào, tôi là ${name}. Đây là giọng nói của tôi.`
}

/** What a persona says to be heard in a language; in English for a language the voice does not speak. */
export function introduction(language: string, name: string): string {
  return (INTRODUCTIONS[language as LanguageCode] ?? INTRODUCTIONS.en)(name)
}
