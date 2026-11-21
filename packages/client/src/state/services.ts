import type { CommandRequest, ServicesView } from '@repo/protocol'
import type { Session } from '../session.ts'
import { cell, type Followed } from './followed.ts'

/** The services connected for widget apps, kept current for as long as they are followed. Nothing until the core has answered. */
export interface ServicesState extends Followed<ServicesView | undefined> {
  /** Connect a service: with a token, or by signing in in the system's browser. Rejects with why not, in the core's words. */
  connect(asked: CommandRequest<'services.connect'>): Promise<void>
  disconnect(connection: string): Promise<void>
  unfollow(): void
}

/** Read the services from the core and follow their changes, from this device or another. */
export function followServices(session: Session): ServicesState {
  const services = cell<ServicesView | undefined>(undefined)
  const stopEvents = session.onEvent((event) => {
    if (event.name === 'services.changed') services.set(event.services)
  })
  session.run('services.read', {}).then(
    ({ services: view }) => services.set(view),
    () => undefined
  )
  return {
    current: services.current,
    subscribe: services.subscribe,
    async connect(asked) {
      services.set((await session.run('services.connect', asked)).services)
    },
    async disconnect(connection) {
      services.set((await session.run('services.disconnect', { connection })).services)
    },
    unfollow: stopEvents
  }
}
