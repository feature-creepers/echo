/** How much of a CLI's error output is kept while it runs: enough for the last lines, which say why it stopped. */
export const KEPT_OUTPUT = 2000

/** The end of what a program printed, on one line and short enough to show. The first text that is not empty is used. */
export function lastLines(...outputs: string[]): string {
  const text = outputs.find((output) => output.trim() !== '') ?? ''
  return text
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-4)
    .join(' ')
    .slice(0, 400)
}

/** The version out of what a CLI's `--version` prints: "2.1.322 (Claude Code)", "codex-cli 0.130.0". */
export function readVersion(output: string): string | undefined {
  const line = output.trim().split('\n')[0]?.trim()
  return line?.match(/\d+(\.\d+)+\S*/)?.[0] ?? (line || undefined)
}

/** Whether what a CLI printed says the user is not signed in, or no longer. */
export function saysSignedOut(detail: string): boolean {
  return /not logged in|log ?in|sign ?in|authenticat|credential|unauthori[sz]ed|\b401\b/i.test(detail)
}
