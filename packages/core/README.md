# @repo/core

The assistant itself: the channel, the orchestrator, threads, memory and personas. It is pure logic: everything it needs from outside is an interface in `src/ports`.

`createCore` gives what a listener needs: admit a client, carry out a command, announce an event.

The memory (`src/memory`, docs/SPEC.md section 10) has one entry point, `createMemory`. It recalls what bears on each turn with no model call, writes facts while the assistant sleeps (with `Harness.complete` on the `utility` role), keeps a profile for every session, and gives sessions the `memory_search`, `memory_remember` and `memory_forget` tools. Search and timers are ports (`src/ports/search.ts`, `src/ports/clock.ts`); `memorySearch` and `manualTimers` stand in for them in tests.

The library (`src/library`, docs/SPEC.md section 9.8) keeps the views the user saved as records, a version per change and an erasure to delete. It tells every session what is saved and gives threads `library_search`, `library_show`, `library_save`, `library_update` and `library_delete`, so a saved widget comes back as it is when asked for again.

A persona is data. `src/personas/defaults.ts` is the only file that contains the default names, and nothing else in the repository names a persona: behaviour depends on a persona's stance, never on which one it is.

- **Runs in:** Anywhere: Node, a browser, a phone. No Node API, no DOM
- **May import:** `@repo/protocol`, `@repo/catalog`
- **Entry points:** `@repo/core`

The import rule is enforced by `biome.jsonc` and explained in [docs/SPEC.md](../../docs/SPEC.md), section 14.3.
