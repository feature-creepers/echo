import type { Client } from '@repo/client'
import type { Allowance, ProtectedPlace } from '@repo/protocol'
import { useEffect, useState } from 'react'

interface StandingRules {
  /** What was allowed for this session, until the app quits. */
  allowances: Allowance[]
  /** The places never reached on the core's computer. */
  protected: ProtectedPlace[]
  /** Nothing read yet. */
  loading: boolean
  forget(allowance: string): Promise<void>
}

/**
 * What stands besides the settings: the approvals given for this session, kept current as the core gives and
 * ends them, and the places never reached on the core's computer.
 */
export function useStandingRules(client: Client): StandingRules {
  const [rules, setRules] = useState<{ allowances: Allowance[]; protected: ProtectedPlace[] }>()

  useEffect(() => {
    let live = true
    const stop = client.session.onEvent((event) => {
      if (event.name === 'allowances.changed') setRules((known) => ({ protected: known?.protected ?? [], allowances: event.allowances }))
    })
    client.session.run('access.read', {}).then(
      (read) => live && setRules(read),
      () => live && setRules({ allowances: [], protected: [] })
    )
    return () => {
      live = false
      stop()
    }
  }, [client])

  return {
    allowances: rules?.allowances ?? [],
    protected: rules?.protected ?? [],
    loading: rules === undefined,
    async forget(allowance) {
      setRules(await client.session.run('access.forget', { allowance }))
    }
  }
}
