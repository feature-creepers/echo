/** Sizes, dates and tables as the interface writes them. */

/** A size as a person reads it, the way file managers write it: "812 bytes", "240 KB", "3.4 MB". */
export function sizeWords(bytes: number): string {
  if (bytes < 1000) return bytes === 1 ? '1 byte' : `${bytes} bytes`
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`
}

/** How many things a folder holds: "Empty", "1 item", "12 items". */
export function itemsWords(count: number): string {
  return count === 0 ? 'Empty' : count === 1 ? '1 item' : `${count} items`
}

/** When something changed, as a file manager says it: the time today, "Yesterday", or the date. */
export function modifiedWords(iso: string, now: Date = new Date(), locale?: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((day(now) - day(at)) / 86_400_000)
  const time = at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  if (days === 0) return `Today, ${time}`
  if (days === 1) return `Yesterday, ${time}`
  return at.toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) })
}

/**
 * The rows of a CSV or TSV table: values apart by commas (or tabs), a value in quotes holding commas, line breaks
 * and doubled quotes. At most `limit` rows.
 */
export function tableRows(text: string, separator = ',', limit = 500): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false
  for (let at = 0; at < text.length && rows.length < limit; at++) {
    const character = text[at]
    if (quoted) {
      if (character === '"' && text[at + 1] === '"') {
        value += '"'
        at++
      } else if (character === '"') quoted = false
      else value += character
    } else if (character === '"' && value === '') quoted = true
    else if (character === separator) {
      row.push(value)
      value = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[at + 1] === '\n') at++
      row.push(value)
      rows.push(row)
      row = []
      value = ''
    } else value += character
  }
  if ((value !== '' || row.length > 0) && rows.length < limit) rows.push([...row, value])
  return rows
}
