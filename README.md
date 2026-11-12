# JARVIS

A personal voice assistant that runs on your Mac. Hold a key and talk; it answers aloud. It can search the web, read your Google Calendar, tell you the weather, brief you in the morning, gather a daily AI news report and play music: FIP radio or your own songs, from a Player panel or by asking. It reads and reports: nothing in it sends email, changes your calendar or edits files. The one thing it can write is text at your cursor, when you ask for that with its own shortcut.

It uses Claude as its brain through the Claude Code command-line tool, on your own Claude subscription. There is no API key to set up.

## What you need

- A Mac running macOS 13 or later (Intel or Apple Silicon).
- [Node.js](https://nodejs.org) 20 or later.
- Apple's Command Line Tools, for the Swift compiler: `xcode-select --install`.
- [Claude Code](https://claude.com/claude-code), installed and signed in with a Claude subscription. Check with `claude --version`.

Optional: connect Google Calendar to your Claude account (claude.ai → Settings → Connectors) if you want calendar reading.

## Install and run

```bash
git clone <this repository> jarvis
cd jarvis
./build-app.sh
open ~/Applications/JARVIS.app
```

`build-app.sh` compiles the native window and puts `JARVIS.app` in `~/Applications`. The first build takes a few minutes; later builds are quick unless `app/main.swift` changed.

On first use macOS asks for the microphone and speech recognition. Allow both.

To run without building the app, for quick work on the interface:

```bash
node server.mjs
```

This opens JARVIS in a Chrome window. Voice input then uses Chrome's recogniser, and the features that need the native window (Mini mode, global shortcuts, other-apps integration) are absent.

## Using it

| Key | What it does |
|---|---|
| Space | Talk, when the text box is empty (hold, or tap, depending on Settings) |
| Enter | Start typing in the text box; Enter again sends |
| Esc | Stop listening, speaking or a reply, and leave the text box |
| N | Open today's news in the reader window |
| D | Display the last answer in the reader window |
| R | Play FIP radio |
| P | Play or pause the music |
| K | Skip to the next station or song |
| T | Show or hide the transcript |
| H, S | Open History, open Settings |
| M | Switch Mini mode on or off |
| Ctrl+Option+Space | Talk from any app |
| Ctrl+Option+Shift+Space | Speak a request and have the result typed at your cursor |

The letter shortcuts work whenever you are not typing, and each is shown on its button. Press Enter (or click the text box) to type; letters are then text until you press Esc. Everything else is in **Settings**: voice and speed, speech language, model, standing instructions, the opening briefing (including whether AI news is spoken as three top stories or shown as a full report), tools, history, startup options, and a Usage view with the estimated cost and token counts for this session, each day and in total.

Say "show me" with a question, or press **Show** after a reply, and JARVIS speaks the gist while the full written answer, with its sources, opens in a separate reader window. The **News** button opens the day's AI news report there too.

Tell JARVIS about yourself in the context file (Settings → Assistant → Context file). Set your town in Settings → Tools and connections.

## How it is put together

| File | Role |
|---|---|
| `app/main.swift` | The native macOS window: frameless window, Mini mode, Apple speech recognition, global shortcuts, menu bar icon, reading the selection and pasting in other apps. |
| `server.mjs` | The local server, with no dependencies. Keeps one Claude Code process running and passes questions to it, speaks replies with the Mac's `say` command, hands songs to the Player, and handles settings, weather and history. Listens on `127.0.0.1` only. |
| `public/index.html` | The whole interface: layout, animation and logic in one file. |
| `public/reader.html` | The reader: a second, plain window that shows the news report or a written answer. |
| `build-app.sh` | Compiles the Swift shell, assembles `JARVIS.app` and signs it for this Mac. |
| `setup-signing.sh` | Run once: creates a local signing certificate so macOS keeps the app's permissions across builds. |
| `workspace/CLAUDE.md` | Template for the context file. |

Your own data lives outside the project, in `~/JARVIS`: `settings.json`, `history/`, `usage.jsonl` (the estimated cost and token counts of each reply), `workspace/memory.md` (lasting facts noted when a conversation ends), `workspace/news/` (the AI news report of each day, one Markdown file per day, opened with the News button), `workspace/` (the context file, and the only folder JARVIS can read), `songs/` (drop audio files here: the Player panel plays them in random order, and one is played after the day's first briefing) and `jarvis.log`.

### What the agent is allowed to do

The Claude process is started with a fixed list of tools: reading files in its workspace, web search and web fetch, and four read-only Google Calendar tools. Calendar write tools and every other connector on your Claude account are explicitly hidden from it. That list is in `server.mjs` (`FILE_TOOLS`, `WEB_TOOLS`, `CONNECTOR_TOOLS`, `HIDDEN_TOOLS`). Widen it with care: the assistant reads web pages and, if you add it, email, which are text written by strangers.

## Changing it

- **Interface or server:** edit `public/index.html` or `server.mjs`, run `./build-app.sh`, reopen the app.
- **Native window:** edit `app/main.swift`, then `./build-app.sh`. This recompiles.
- **Permissions:** without a signing certificate each build looks like a new app to macOS, which asks again for microphone, speech and Accessibility permission. Run `./setup-signing.sh` once to create a local certificate; from then on the permissions you grant stay granted across builds.
- **Personality:** the `persona` function in `server.mjs`.
- **Version:** `VERSION` in `server.mjs` and `CFBundleShortVersionString` in `build-app.sh`.

For a detailed trace of what the Claude process is doing, start the app with `open ~/Applications/JARVIS.app --env JARVIS_DEBUG=1` and read `~/JARVIS/jarvis.log`.

## Where your data goes

- **Stays on your Mac:** settings, history and the context file.
- **Anthropic:** your questions and whatever JARVIS reads to answer them, through Claude Code.
- **Apple:** your voice, when speech recognition is not running on-device.
- **Open-Meteo:** the coordinates of your weather town.
- **Radio France:** requests for the FIP stream and its track details, made by the page when the radio is on. Nothing about you is sent.
- **Hacker News, GitHub and smol.ai:** requests for public pages when the AI news is gathered. Nothing about you is sent.

## Known limits

- macOS only.
- Speech language is chosen in Settings (English UK or French); it is not detected automatically.
- Reading the selection in another app depends on that app exposing it to macOS. Native apps generally do; some browsers and Electron apps do not.
- The app is not notarised. Build it on the Mac that will run it rather than copying a built `JARVIS.app` between machines.
