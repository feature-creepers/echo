# @repo/speech

Speech recognition, a voice, and detection of the start and end of speech, running on this machine's processor, behind interfaces that have the same shape on a device and on a server.

- **Runs in:** Node
- **May import:** `@repo/models`
- **Entry points:** `@repo/speech`, and `@repo/speech/process`, the speech service as a program

The import rule is enforced by `biome.jsonc` and explained in [docs/SPEC.md](../../docs/SPEC.md), section 14.3.

## Engines

One native library runs everything: [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (`sherpa-onnx-node`, Apache-2.0), which ships built for Windows, macOS and Linux, on x64 and arm64. Nothing is compiled at install time. The models are downloaded by `@repo/models`, whose README says where they come from and under which licences.

| Port (`src/ports.ts`) | Opened with                               | Model                               | Notes                                                                                                |
| --------------------- | ----------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `Recognizer`          | `openRecognizer({ folder, threads })`     | NVIDIA Parakeet TDT 0.6b v3, 8 bits | 25 European languages, found out by itself. It does not say which one it heard                       |
| `Voice`               | `openVoice({ folder, threads })`          | Supertonic 3, 8 bits                | 31 languages, 10 styles, sound at 44.1 kHz. It must be told the language of the text                 |
| `SpeechDetector`      | `openSpeechDetector({ folder, silence })` | Silero VAD 5                        | Fed with the microphone's sound; says when speech started, and when it ended after `silence` seconds |

`folder` is where model sets are installed. Opening an engine whose set is missing throws a `SpeechError` with the code `not-installed`. Sound at any sample rate is accepted. The engines work off the main thread and answer one request at a time.

Piper and Kokoro voices are not used: since sherpa-onnx 2.0 they cannot pronounce French.

## The speech service

Loading the models takes seconds and several hundred megabytes, and a fault in native code ends its process. So the app does not open engines itself: it starts the speech service in a process of its own and talks to it.

```ts
// In the process that hosts the engines: src/service/process.ts does exactly this.
serveSpeech(port, { folder })

// In the app.
const speech = connectSpeech(port)
await speech.status() // which sets are installed, the hardware tier
await speech.install((progress) => {}) // downloads what is missing
const { text } = await speech.transcribe(sound)
const spoken = await speech.speak('Bonjour.', { style: 'f1', language: 'fr' })
const detector = await speech.listen({ silence: 1 }) // then detector.feed(piece) for each piece of microphone sound
```

- A port is anything with `postMessage` and `on('message')`: an Electron utility process and the `process.parentPort` inside it, a worker thread and its `parentPort`, either end of a `MessageChannel`.
- Messages are checked on both sides against `src/service/protocol.ts`.
- Sound crosses as typed arrays. Their memory is moved where the port can move it (worker threads) and copied where it cannot (Electron). Either way, a sound given to `transcribe` or `feed` stays usable by the caller.
- Engines are loaded at first use and kept; `warmUp()` loads them ahead. The recogniser and the voice each answer one request at a time, in order, and do not wait for each other.
- A failure is a rejection with a `SpeechError`: a code (`not-installed`, `unavailable`, `invalid`, `failed`) and a message written for the user. The cause underneath is written on the service's error output.
- `transcribe`, `speak` and `install` take a `signal`: a request whose turn has not come is dropped, a download is stopped and continues next time.
- When the service's process ends, every waiting request is rejected.

`@repo/speech/process` is the service as a program. It serves on `process.parentPort` in an Electron utility process, on `parentPort` in a worker thread, and takes `--models <folder>` and optionally `--tier <light|standard|performance>`.

### Packaging

The native library is loaded with `require`, not imported, so a bundler leaves it alone. Two things must then be true where the app runs:

- `sherpa-onnx-node` can be resolved from the bundled file, so the app that bundles this package declares it as a dependency of its own.
- The package for the system, `sherpa-onnx-<darwin|linux|win>-<x64|arm64>`, sits beside `sherpa-onnx-node` in the same `node_modules`, as real files: in an Electron app, outside the `asar` archive, all of it. It holds the addon and the shared libraries the addon loads from its own folder.

## Tests

- `pnpm --filter @repo/speech test` needs no model. It checks the service over a real message channel with fake engines, the service started as a program in a worker thread, and that the native library loads and computes on the system it runs on.
- `SPEECH_MODELS=<folder> pnpm --filter @repo/speech test` also runs the engines with their real models, alone and through the service: sentences are spoken in English and French, detected and heard back. `<folder>` holds the sets as `installModelSet` lays them out. Run it through the package, as written: `pnpm test` at the root does not pass the variable on.
