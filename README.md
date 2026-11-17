# Echo

A personal assistant you talk to. It answers with a short spoken sentence and with interface elements it composes on screen. One assistant, one conversation, on Windows, macOS and Linux.

The assistant has personalities, and you call it by the name of the one in use. Two come with it, named Jarvis and HAL until you rename them: the first goes along with you, the second questions you before a risky move.

## Status

Early build. The desktop app starts the core as a separate program and connects to it. At first launch it asks you to name the personalities and pick the one that answers; the core keeps your choice in its store, and settings let you change it. The assistant itself (voice, threads, memory, generated interface) is not built yet.

- [docs/SPEC.md](docs/SPEC.md) is the product and architecture spec. Section 14 explains the repository layout, section 14.8 what is built, section 17 the build order.
- The original proof of concept, called JARVIS, is on the `main` branch.

## Working on it

You need Node 24 or later and pnpm.

```bash
pnpm install
pnpm check                           # typecheck, lint (including the dependency rules), formatting, tests
pnpm build
pnpm --filter @repo/desktop dev      # run the desktop app
pnpm --filter @repo/desktop package  # package it for this system, into apps/desktop/release
```

Each app and package has a README of its own.

## Layout

```
apps/        programs that are built and shipped
packages/    libraries: contracts, the core, adapters, client side
tooling/     shared compiler and lint configuration
docs/        the spec
```

Which package may import which is declared in `tooling/eslint/boundaries.js` and enforced by `pnpm lint`.

## Credits

Created by Tommy Sendra and Rodolphe Barbanneau.

Tommy wrote the original proof of concept, which this rewrite grows from.

## Licence

MIT. Copyright Tommy Sendra and Rodolphe Barbanneau.
