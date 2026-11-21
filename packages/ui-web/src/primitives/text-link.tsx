import type { ReactNode } from 'react'

/** A link to a web page within text, which opens in the person's browser. */
export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={href.replace(/^https:\/\//, '')}
      className="rounded-xs underline decoration-white/25 underline-offset-4 transition-colors duration-(--duration-quick) ease-soft hover:decoration-white/70 focus-visible:outline-1 focus-visible:outline-accent focus-visible:outline-offset-2"
    >
      {children}
    </a>
  )
}
