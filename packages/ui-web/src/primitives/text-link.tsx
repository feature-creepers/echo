import type { ReactNode } from 'react'

/** A link to a web page within text, which opens in the person's browser. */
export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={href.replace(/^https:\/\//, '')}
      className="underline decoration-text/35 underline-offset-4 transition-colors duration-(--duration-quick) ease-soft hover:decoration-text"
    >
      {children}
    </a>
  )
}
