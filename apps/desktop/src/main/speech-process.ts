import { connectSpeech, type SpeechService } from '@repo/speech'
import { utilityProcess } from 'electron'

export interface SpeechProcess {
  service: SpeechService
  /** Stop the engines' process. */
  stop(): void
}

/**
 * The speech engines run in a process of their own: they block while they work, and the window and the
 * core must not wait on them. Their models are kept in `models`, which belongs to this device.
 */
export function startSpeech(script: string, models: string): SpeechProcess {
  const child = utilityProcess.fork(script, ['--models', models], { serviceName: 'Speech', stdio: ['ignore', 'pipe', 'pipe'] })
  // The causes of engine failures are written here.
  child.stderr?.setEncoding('utf8').on('data', (text: string) => process.stderr.write(text))
  child.stdout?.resume()
  const service = connectSpeech(child)
  return {
    service,
    stop() {
      service.close()
      child.kill()
    }
  }
}
