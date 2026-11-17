import { useEffect, useState } from 'react'
import type { About, DeviceHost } from '../device/host.ts'

/** The app's version and where it keeps its data, once the app has said. */
export function useAbout(host: DeviceHost | undefined): About | undefined {
  const [about, setAbout] = useState<About>()
  useEffect(() => {
    host
      ?.about()
      .then(setAbout)
      .catch(() => undefined)
  }, [host])
  return about
}
