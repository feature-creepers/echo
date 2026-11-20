# @repo/models

Catalogue and download of model files, and detection of the hardware tier.

- **Runs in:** Node
- **May import:** Nothing from this repository
- **Entry points:** `@repo/models`

The import rule is enforced by `biome.jsonc` (docs/SPEC.md, section 14.3).

## Model sets

A model set is the files one engine needs. The catalogue (`src/catalogue.ts`) records, for each file, where it is downloaded from, its size and its SHA-256. Every address names one commit of a Hugging Face repository, so it can never serve other bytes than the ones recorded.

| Set                         | Used for           | Download | Licence    | Files from                                                                                                                                  | Model by                                                                |
| --------------------------- | ------------------ | -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `parakeet-tdt-0.6b-v3-int8` | Speech recognition | 671 MB   | CC BY 4.0  | [csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8](https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8)       | [NVIDIA](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)            |
| `supertonic-3-int8`         | Voice              | 145 MB   | OpenRAIL-M | [csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11](https://huggingface.co/csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11) | [Supertone](https://huggingface.co/Supertone/supertonic-3)              |
| `silero-vad-v5`             | Speech detection   | 2.3 MB   | MIT        | [csukuangfj/vad](https://huggingface.co/csukuangfj/vad)                                                                                     | [Silero](https://github.com/snakers4/silero-vad), the file they publish |

Together: 818 MB, downloaded once. The two large sets are the models as converted for sherpa-onnx, the library `@repo/speech` runs them with, with weights reduced to 8 bits.

To change a model, record the new commit, sizes and hashes together. A set already on a device no longer matches the catalogue then, and is downloaded again: only the files that changed.

## Downloading

`installModelSet(folder, set, { onProgress, signal })` downloads a set into `<folder>/<set.id>/`.

- A file is written under a `.part` name, checked against its size and SHA-256, and only then given its final name. A file with its final name is always whole.
- A download that was cut off continues from where it stopped, with a range request, by itself while the connection keeps delivering, and at the next call otherwise.
- A file that arrives damaged is fetched again once. Then the call fails with a `ModelDownloadError`, whose message is written for the user.
- `signal` stops it. What was received stays on disk for the next call.
- When every file is in place, `installed.json` is written in the set's folder. `isInstalled(folder, set)` reads it and the size of each file: nothing is hashed, so it can be asked at every launch.
- Calling it again does nothing when the set is installed. Two calls at once for the same set download it once.

Two processes downloading the same set into the same folder at the same time are not guarded against: one process should own the model folder.

## Hardware tier

`detectTier()` gives `light`, `standard` or `performance` from the number of processors and the memory, as docs/SPEC.md section 8.2 describes them. The rules are in `src/hardware/tier.ts`:

| Tier        | Machine                                     | Threads for a model engine |
| ----------- | ------------------------------------------- | -------------------------- |
| Light       | Four processors or fewer, or less than 7 GB | 2 at most                  |
| Performance | Eight processors or more, and 30 GB or more | 6 at most                  |
| Standard    | Everything between                          | 4 at most                  |

`detectEngineThreads(tier)` never gives more than half the processors. The limits were measured: the recogniser is fastest with 6 threads on a 6-core machine and slower beyond, the voice gains nothing past 4. The graphics card is not looked at: the engines of this version run on the processor.

Node reports processors and memory the same way on Windows, macOS and Linux, so there is no per-system code here.

## Tests

`pnpm --filter @repo/models test` runs the download against a local HTTP server that can cut connections, ignore ranges and send damaged bytes. `MODELS_NETWORK=1 pnpm --filter @repo/models test` also downloads the smallest set from its real address.
