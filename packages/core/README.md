# @repo/core

The assistant itself: the channel, threads and projects, memory, personas, the library of saved views, the schedule, and access to the computer with its approval cards. It is pure logic: everything it needs from outside is an interface in `src/ports` (records, search, files, the harnesses, the browser, the desktop, the clock, the public web), which the adapters implement and `apps/server` wires in.

`createCore` gives a listener what it needs: admit a client, carry out a command, announce an event. Each folder of `src/` serves its own tools to the sessions in its `tools.ts`, gathered in `core.ts`.

A persona is data. `src/personas/defaults.ts` is the only file that contains the default names: behaviour depends on a persona's stance, never on which one it is (`scripts/check-persona-names.ts` enforces it).

- **Runs in:** Anywhere: Node, a browser, a phone. No Node API, no DOM
- **May import:** `@repo/protocol`, `@repo/catalog`
- **Entry points:** `@repo/core`

The import rule is enforced by `biome.jsonc` (docs/SPEC.md, section 14.3).

## Tests

```bash
pnpm --filter @repo/core test
```

The tests sit beside the code, and drive the core through a scripted harness and stand-ins for its ports (`src/replay/`).
