import { openSession, type Session, type SessionLink } from './session.ts'
import { type DeviceVoice, playSpeech, type SpeechPlayer } from './speech-player.ts'
import { type ChannelState, followChannel } from './state/channel.ts'
import { type EnginesState, followEngines } from './state/engines.ts'
import { followSettings, type SettingsState } from './state/settings.ts'

/** Everything a client holds while it is connected to a core: the exchange, and what it keeps current from it. */
export interface Client {
  session: Session
  settings: SettingsState
  channel: ChannelState
  engines: EnginesState
  speech: SpeechPlayer
  /** Let go of all of it. The link under the session is left as it is. */
  close(): void
}

/**
 * Open a session on a link to a core that has admitted this device, and start following what an interface
 * shows: the settings, the conversation, the harnesses. Sentences are said through `voice`.
 */
export function openClient(link: SessionLink, voice: DeviceVoice): Client {
  const session = openSession(link)
  const settings = followSettings(session)
  const channel = followChannel(session)
  const engines = followEngines(session)
  const speech = playSpeech(channel, voice)
  return {
    session,
    settings,
    channel,
    engines,
    speech,
    close() {
      speech.close()
      engines.unfollow()
      channel.unfollow()
      settings.stop()
      session.close()
    }
  }
}
