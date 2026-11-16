# JARVIS

A personal assistant you talk to. It answers with a short spoken sentence and with interface elements it composes on screen. One assistant, one conversation, on Windows, macOS and Linux.

`JARVIS` is a working name.

## Status

Early build. The workspace, its dependency rules and continuous integration are in place; the assistant itself is not built yet.

- [docs/SPEC.md](docs/SPEC.md) is the product and architecture spec. Section 14 explains the repository layout, section 17 the build order.
- The original proof of concept, by Tommy Sendra, is on the `main` branch.

## Working on it

You need Node 24 or later and pnpm.

```bash
pnpm install
pnpm check        # typecheck, lint (including the dependency rules), formatting, tests
pnpm build
```

## Layout

```
apps/        programs that are built and shipped
packages/    libraries: contracts, the core, adapters, client side
tooling/     shared compiler and lint configuration
docs/        the spec
```

Which package may import which is declared in `tooling/eslint/boundaries.js` and enforced by `pnpm lint`.

## Licence

MIT
