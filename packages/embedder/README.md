# @repo/embedder

The adapter that runs the model of search by meaning for the core (docs/SPEC.md, section 10.4): multilingual-e5-small, with [transformers.js](https://github.com/huggingface/transformers.js) on ONNX Runtime (`onnxruntime-node`), in a worker thread of the core's process. It implements the `Embedder` port of `@repo/core`; the vectors themselves are kept by `@repo/store`.

- **Runs in:** Node (the core's process; in the desktop app, an Electron utility process)
- **May import:** `@repo/core`, `@repo/models`
- **Entry points:** `@repo/embedder`, and `@repo/embedder/worker`, the worker's script, which the desktop app builds beside the bundled core as `embedder-worker.js`

The import rule is enforced by `biome.jsonc` (docs/SPEC.md, section 14.3).

## Use

```ts
import { createEmbedder } from '@repo/embedder'

const embedder = createEmbedder({ folder: join(data, 'models'), log })
await embedder.install((state) => show(state), signal) // only when the person asks
const [vector] = await embedder.embed(['Où est garée la voiture ?'], 'query')
await embedder.close()
```

| Option   | Meaning                                                                                    |
| -------- | ------------------------------------------------------------------------------------------ |
| `folder` | The core's model folder, in its data folder: not the device's, where speech keeps its own. |
| `log`    | Where the adapter reports what the core is not told: a runtime that could not start.       |
| `idleMs` | How long the worker stays with nothing to do. Left out, five minutes.                      |
| `worker` | The worker's script. Left out, the one beside the module. For tests.                       |
| `set`    | The model's files. Left out, `E5_SMALL` of `@repo/models`. For tests.                      |

## What it promises

- **The model.** `E5_SMALL` of `@repo/models`, downloaded with `installModelSet`: progress, resume after a cut and the checks are the speech models' own. Before downloading, the worker is started once to load transformers.js and ONNX Runtime: on a system they do not run on (onnxruntime-node has no build for macOS on Intel), the state is `unavailable`, with why, and nothing is downloaded.
- **The worker.** Started at the first texts, closed after `idleMs` with nothing to do and by `close()`. It loads `@huggingface/transformers` itself, never the core's thread, with `env.allowRemoteModels` off and the model folder as `env.localModelPath` and `env.cacheDir`, so it fetches nothing. It runs `pipeline('feature-extraction', …, { dtype: 'q8' })` with mean pooling and normalisation, on one processor thread on the light tier and two otherwise, so it never takes the processors speech needs. Requests are answered one at a time, in order; one the caller stopped waiting for is skipped if its turn has not come.
- **Prefixes.** e5 was trained to read `"query: "` before what is looked for and `"passage: "` before what is looked in: the adapter adds them, since they belong to the model.
- **Vectors.** 384 numbers each, of length one, kept with the name `multilingual-e5-small-q8`. The model reads the first 512 tokens of a text.

## Tests

```bash
pnpm --filter @repo/embedder test
EMBEDDER_MODELS=<folder> pnpm --filter @repo/embedder test
```

The tests of `src/` run anywhere, with a worker that stands for the real one (`test/echo-worker.ts`, `test/broken-worker.ts`). `test/real.test.ts` runs the real model from `EMBEDDER_MODELS`, downloading it there first when it is missing (135 MB): it checks that sentences saying the same thing in English and French score at least the floor of search by meaning (`MEANING_FLOOR` in `@repo/core`), and that unrelated ones score under it (`test/pairs.ts`).
