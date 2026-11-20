/** A text on one line, cut to `most` characters with an ellipsis: a line of a list, a notification, a step of a plan. */
export function shorten(text: string, most: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > most ? `${flat.slice(0, most - 1).trimEnd()}…` : flat
}

/** A text cut to `most` characters, saying so on a line of its own, for a model or the person to know it goes on. */
export function cutText(text: string, most: number): string {
  return text.length > most ? `${text.slice(0, most)}\n[…cut]` : text
}
