/** The longest name given to an exported answer, before its extension, so it fits every system's file names. */
const NAME_LENGTH = 80

/** Names Windows keeps for its devices, whatever the extension: a file cannot take them. */
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i

/**
 * The name of the Markdown file an answer is exported to, from what it is about: the thread's title, or what the
 * person asked. Every system can keep it: no character Windows refuses, no control character, no dot or space
 * at its end, and no longer than a title is read. Nothing usable gives "Full answer".
 */
export function answerFileName(about: string | undefined): string {
  let name = (about ?? '')
    // Characters no file name may hold on one system or another, and control characters, become spaces.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this removes.
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (name.length > NAME_LENGTH) {
    const cut = name.slice(0, NAME_LENGTH)
    const space = cut.lastIndexOf(' ')
    name = space > NAME_LENGTH / 2 ? cut.slice(0, space) : cut
  }
  name = name.replace(/[. ]+$/, '')
  if (name === '' || RESERVED.test(name)) name = name === '' ? 'Full answer' : `${name} answer`
  return `${name}.md`
}
