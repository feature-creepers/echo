# @repo/screen

The adapters for the rest of the computer, through each system's own means. `createDesktop` implements the core's `Desktop` port: the windows of other apps, read through the system's accessibility tree and operated by element (UI Automation on Windows, System Events on macOS, AT-SPI on Linux). `createClipboard`, `createDrives` and `createPrinters` implement the `Clipboard`, `Drives` and `Printers` ports. What the assistant may do with them, and what is asked first, is decided by the core.

- **Runs in:** Node
- **May import:** `@repo/core`
- **Entry points:** `@repo/screen`

The import rule is enforced by `biome.jsonc` (docs/SPEC.md, section 14.3). Code that differs by system sits in `src/system/`, `src/drives/` and `src/printers/`, one file per system behind an `index.ts`.

## Tests

```bash
pnpm --filter @repo/screen test
ASSISTANT_DESKTOP=1 pnpm --filter @repo/screen test    # also the real clipboard and, on Windows, the real desktop
```

The tests of `src/` run anywhere, with tables of what each system's helper says. `test/real.test.ts` opens a small window of its own, reads it and types in it, so it runs only when asked, on a machine with a desktop.
