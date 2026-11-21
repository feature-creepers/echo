import { openSession, type Session, type SessionLink } from './session.ts'
import { type DeviceVoice, playSpeech, type SpeechPlayer } from './speech-player.ts'
import { type Activity, followActivity } from './state/activity.ts'
import { type ChannelState, followChannel } from './state/channel.ts'
import { type EnginesState, followEngines } from './state/engines.ts'
import type { Followed } from './state/followed.ts'
import { followEvents, type Logged } from './state/inspector.ts'
import { followLibrary, type LibraryState } from './state/library.ts'
import { followMemory, type MemoryState } from './state/memory.ts'
import { followSettings, type SettingsState } from './state/settings.ts'
import { followThreads, type ThreadsState } from './state/threads.ts'
import { followTopics, type TopicsState } from './state/topics.ts'

/** Everything a client holds while it is connected to a core: the exchange, and what it keeps current from it. */
export interface Client {
  session: Session
  settings: SettingsState
  channel: ChannelState
  /** What the assistant is doing for the turn under way: the tool calls it is making. */
  activity: Followed<Activity>
  engines: EnginesState
  /** The topics of the conversation and their answers: what the main screen shows. */
  topics: TopicsState
  threads: ThreadsState
  /** Every event the core sent, for the inspector. */
  events: Followed<readonly Logged[]>
  /** What the assistant knows about the user, and whether it is asleep. */
  memory: MemoryState
  /** The widgets the user saved, and the ones pinned beside the conversation. */
  library: LibraryState
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
  const activity = followActivity(session)
  const engines = followEngines(session)
  const topics = followTopics(session)
  const threads = followThreads(session)
  const events = followEvents(session)
  const memory = followMemory(session)
  const library = followLibrary(session)
  const speech = playSpeech(channel, voice)
  return {
    session,
    settings,
    channel,
    activity,
    engines,
    topics,
    threads,
    events,
    memory,
    library,
    speech,
    close() {
      speech.close()
      library.unfollow()
      memory.unfollow()
      topics.unfollow()
      threads.unfollow()
      events.unfollow()
      engines.unfollow()
      activity.unfollow()
      channel.unfollow()
      settings.unfollow()
      session.close()
    }
  }
}
