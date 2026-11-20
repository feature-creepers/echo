import { useEffect, useState } from 'react'

/**
 * The time now, again every half minute, so what a page says of it stays true while it is open: "last slept 3
 * minutes ago", or "Today" turning to "Tomorrow".
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}
