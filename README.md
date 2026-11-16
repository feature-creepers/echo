# JARVIS

A personal assistant you talk to. It answers with a short spoken sentence and with interface elements it composes on screen. One assistant, one conversation, on Windows, macOS and Linux.

`JARVIS` is the code name of this repository. In the product, Jarvis is one of the assistant's personalities, like HAL; the product itself will have a name of its own.

## Status

Early build. The workspace, its dependency rules and continuous integration are in place. The desktop app starts the core as a separate program and connects to it. The assistant itself (voice, threads, memory, generated interface) is not built yet.

- [docs/SPEC.md](docs/SPEC.md) is the product and architecture spec. Section 14 explains the repository layout, section 17 the build order.
- The original proof of concept is on the `main` branch.

## Working on it

You need Node 24 or later and pnpm.

```bash
pnpm install
pnpm check                           # typecheck, lint (including the dependency rules), formatting, tests
pnpm build
pnpm --filter @repo/desktop dev      # run the desktop app
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
