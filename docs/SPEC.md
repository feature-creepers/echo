# Echo: product and architecture spec

Draft 0.3, 17 November 2026, on branch `rodolphe`.
Sections 2 and 3 describe what existed before this branch. Section 14.8 says what is built. Everything else is a proposal.

**Changed since draft 0.2**

- The product is named Echo (decision 13).
- Personas are data. The user names them, at first launch and in settings, and no code names a persona (section 11, decision 14).
- The catalogue of the generated interface holds generic building blocks only (section 9.6, decision 15).
- Memory is processed while the assistant sleeps, when the user sets it to (section 10.6, decision 16).
- The first messages after the handshake exist: commands, results and events, carrying the user's settings (section 14.4).
- The store exists: SQLite through Node's built-in module, holding immutable records (sections 10.3 and 14.7).
- Tommy Sendra and Rodolphe Barbanneau are credited as co-authors (decision 12).
- Settings cover what matters, split as section 5.2 says: on this computer the microphone, speakers, voice, listening, shortcuts, start and tray; with the user the AI program preferred and the model it answers with (decision 17).
- The app updates itself from the project's GitHub releases, which a tag publishes as a draft (section 14.7).
- The catalogue has a Media block, and one player serves the app (section 9.6). Saved widgets form a library the assistant brings back from (section 9.8). Everything the assistant shows stays in the centre; pinned widgets float on the right of the main screen, and a sheet over the stage holds the advanced views (sections 9.3 and 13.2).

## 0. Summary

Echo is a personal assistant you talk to. It answers with a short spoken sentence and with interface elements it composes on screen for that answer. The user has one assistant and one conversation. Which AI tool runs, how many conversations exist behind the scenes and what is remembered are all managed for them, and can be inspected on request.

Five findings from the analysis shape this document:

1. **The original repo is a proof of concept, not a monorepo.** It is 15 files and about 4,500 lines: one Swift file, one dependency-free Node server, one HTML page. It works and has good ideas (section 2.4), but its structure cannot carry the new architecture.
2. **Speak already has most of the plumbing the proof of concept lacks**: a harness abstraction for Claude Code and Codex, live sessions whose tools are served by the app, local speech recognition for strong machines, permissions with undo, and a shell for three systems. The proof of concept brings what Speak lacks: voice output, the low-power speech route, and an assistant with a presence.
3. **UI SDK is not a framework for AI-generated interfaces.** It is a library of interaction behaviours for building components, announced in beta on 12 November 2026. The Vercel project that does what you describe is json-render. Section 9 uses json-render for generation, with UI SDK underneath for the components.
4. **Harnesses do keep memory of their own**, each in its own format, so it has to be turned off and replaced by ours. One catch: the single Claude Code flag that does this (`--bare`) also refuses subscription sign-in, so isolation has to be done setting by setting. Section 10 uses one local SQLite file with full-text and vector search.
5. **The proof of concept's second character is only a costume**: a tone of voice, a red theme and an easter egg. The critical persona you describe is a different way of deciding, and needs its own mechanism (section 11).

## 1. Product

### 1.1 Principles

The design is checked against these.

1. **One assistant, one channel.** The user never creates, names, picks or closes a conversation.
2. **Voice first.** Speech is the main way in and out. Typing and clicking stay possible everywhere.
3. **Say little, show much.** A spoken reply is as short as a person's would be. Detail goes on screen as interface elements, not as text to read. Long output, spoken or written, happens only when asked for.
4. **The screen follows the conversation.** What is shown belongs to the current reply and changes as the talk moves on.
5. **Simple first, depth on request.** A new user sees the assistant and its answers. Transcript, activity, threads, memory and raw events are each one step further in, and never hidden.
6. **Harnesses first, API keys possible.** The AI runs through the user's own Claude Code or Codex. Direct API keys can be added later without redesign.
7. **Nothing important lives in the harness.** Conversation state, memory, persona and tools are ours, so changing harness loses nothing.
8. **Three systems from the first version.** Windows, macOS and Linux are equal targets. A feature ships on all three, or is declared specific to one.
9. **Weak machine to strong machine.** Every heavy component has a light alternative, chosen automatically.
10. **The core can move.** It runs on the user's machine today. The same core must later run on a server, with the desktop app and a phone app as its clients, without redesign.
11. **The user is in charge.** The assistant may question a request, but it always carries out a confirmed one and never acts against the user's interest.

### 1.2 Terms

| Term              | Meaning                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| Harness           | An AI agent program the app drives, such as Claude Code or Codex                                                   |
| Core              | The assistant itself: conversation, threads, memory, tools. One per user. It has no interface and owns no hardware |
| Client            | An app on a device that connects to the core: the desktop app now, a phone app later                               |
| Device capability | Something a client offers the core: microphone, speaker, screen, local files, other apps, notifications            |
| Channel           | The single conversation the user has with the assistant                                                            |
| Turn              | One thing the user says, and the assistant's response to it                                                        |
| Thread            | A hidden working conversation about one topic or task                                                              |
| Orchestrator      | The session that hears every turn and either answers it or passes it to a thread                                   |
| View              | What a thread shows on screen: a description of interface elements and their data                                  |
| Stage             | The screen area showing the view of the thread in focus                                                            |
| Aside             | A side question, answered without leaving the current topic                                                        |
| Persona           | One of the characters the assistant can be: a name the user chooses, a stance and a look. Two ship by default      |
| Hardware tier     | Light, standard or performance: which speech and memory components a machine runs                                  |
| Inspector         | The technical view of threads, events, memory and cost                                                             |

## 2. The original proof of concept (`main`)

Written by Tommy Sendra in 23 commits between 11 and 16 November 2026. Version 0.10.0, macOS only.

### 2.1 Structure

```
app/main.swift            545 lines   native macOS window and system integration
server.mjs              1,404 lines   local server: agent, voice output, data, settings
public/index.html       1,854 lines   the whole interface: styles, markup and logic
public/reader.html        220 lines   second window for written answers and the news
kokoro-tts.mjs            102 lines   helper for the optional local voice model
showcase/index.html       343 lines   scripted demo page for a website
workspace/CLAUDE.md                   template of the user's context file
build-app.sh  setup-signing.sh  setup-kokoro.sh  start.command
```

There is no package manifest, no dependency, no test, and no build step other than compiling the Swift file. User data lives outside the repo, in `~/JARVIS`.

```
Swift shell (WKWebView)   loads   index.html   talks over 127.0.0.1:4317 to   server.mjs
  Apple speech recognition          core animation, panels,                     one long-lived `claude` process
  global shortcuts, menu bar        settings, music player                      macOS `say` or Kokoro for voice
  selection and paste in other apps                                             weather, news, history, usage
```

### 2.2 Features

| Area          | What it does                                                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Talking       | Hold or tap Space, or a global shortcut from any app. Typing as an alternative. English (UK) or French, chosen in settings                                           |
| Answering     | Spoken replies of one to three sentences, voiced sentence by sentence, stoppable at any time                                                                         |
| Dashboard     | Fixed panels: weather, system gauges (processor, memory, disk, network, busiest processes), agent status with tool chips, an animated core, transcript, music player |
| Reader window | "Show me" puts a written answer with its sources in a second window. Earlier answers can be brought back                                                             |
| Briefing      | At launch and on greeting: a dry line about its own systems, the date, weather, calendar, AI news, then a song                                                       |
| AI news       | A daily report gathered from Hacker News, GitHub and smol.ai, one file per day                                                                                       |
| Music         | FIP radio (12 stations) and local songs, by button or by voice                                                                                                       |
| Tools         | Read-only: files in its workspace folder, web search and fetch, four Google Calendar read tools through the Claude account connector                                 |
| Other apps    | Reads the selected text and types a result at the cursor, on a separate shortcut                                                                                     |
| Memory        | The conversation resets after 30 idle minutes. A small model then rewrites a notes file of 1,500 characters that every new conversation receives                     |
| Characters    | JARVIS (butler) and HAL (red theme, eye-shaped core, a pod-bay-doors easter egg)                                                                                     |
| Housekeeping  | Settings, 90 days of history, a usage and cost view, Mini mode, menu bar mode, launch at login                                                                       |

### 2.3 Technology choices

| Choice                                                  | What it buys                                                                                                                                                                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code as the brain, on the user's subscription    | No API key. One process is kept alive, so replies start fast and account connectors stay connected                                                                                                                           |
| Apple's speech recogniser, in the Swift shell           | The main low-power workaround: no model to download or run. Partial results while speaking, and a vocabulary list for names. Recognition can go through Apple's servers when the language is not installed for on-device use |
| macOS `say` for voice output                            | No model either. It uses the Premium and Enhanced system voices                                                                                                                                                              |
| Kokoro as an optional voice                             | A local model, about 750 MB in memory, English voices. It runs at full precision because the smaller variants were slower than real time on Intel                                                                            |
| WKWebView rather than Electron                          | A small memory footprint, at the price of a Mac-only shell                                                                                                                                                                   |
| Commands inside the reply text                          | The model writes `<screen>…</screen>` blocks and `[[music: …]]` commands in its answer. The server strips them from speech and acts on them                                                                                  |
| Read-only by design                                     | The agent has no tool that can send, edit or delete                                                                                                                                                                          |
| Local server bound to 127.0.0.1 with a per-launch token | Only the app's own page can reach the agent                                                                                                                                                                                  |

### 2.4 What to keep and what to leave

Keep, as ideas to re-implement:

- Apple speech and `say` as the macOS speech engines of the light tier.
- A warm, long-lived harness process.
- The split between what is spoken and what is shown, and the rule of short spoken replies.
- The context block attached to each message (time, weather, player state) and the context file the user can edit.
- Sentence-by-sentence speech with an instant stop.
- Careful measurement: each system reading is cached for its own interval, and nothing is measured while nobody looks.
- The hygiene rules: web pages, files and selected text are information, never instructions, and memory is taken only from what the user said or confirmed.
- The core animation as the assistant's presence, Mini mode, the briefing, the usage view.

Leave behind:

- The single-file server and single-file page.
- Fixed dashboard panels. Views the assistant composes, and the ones the user pins, replace them.
- Commands inside the reply text. Tool calls replace them.
- One conversation that resets on idle, with a 1,500-character memory.
- What is tied to Claude alone: Claude model names in settings, and the claude.ai connector as the only route to a calendar.
- The macOS-only shell.

## 3. Speak (`rodolphebarbanneau/speak`)

Version 0.5.1, MIT licence. Voice dictation for Windows, macOS and Linux, built with Electron 45, React 19 and TypeScript, about 25,000 lines. It has three modes on three shortcuts: dictate (write what was said, cleaned up), compose (write what was asked for) and control (act on the computer).

### 3.1 Structure

```
src/main/              Electron main process
  ai/                  harness adapters for Claude Code and Codex, and the prompts
  stt/                 whisper.cpp install and server, Parakeet, the model catalogue
  control/             control mode: live AI session, approvals, tools served over MCP
    screen/            windows, screenshots, input and accessibility on each system
  platform/            focus, paste, selection, keyboard, autostart
  controller.ts        the pipeline: record, transcribe, AI, preview or paste
src/renderer/          recording pill, preview dialog, main window, control panel
src/themes/            seasonal themes: palettes, pixel sprites, sounds, schedule
src/shared/            types and the typed contract between processes
```

### 3.2 What to reuse

| Piece                                                                                                                              | Where in Speak                         | Use here                                           |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------- |
| Harness adapter: status, sign-in, model list, one-shot completion                                                                  | `src/main/ai/`                         | Starting point of the harness layer (section 6)    |
| Live sessions: Claude Code over `stream-json` with its permission prompts routed to the app, Codex over `codex app-server`         | `src/main/control/agents.ts`           | The session half of the harness layer              |
| The app's own tools served to the harness as an MCP server on 127.0.0.1 with a token                                               | `src/main/control/`                    | How every assistant tool is delivered (section 12) |
| Isolation: no user settings, no user MCP servers, no slash commands, no session files; Codex memories and multi-agent switched off | same                                   | The basis of principle 7                           |
| Scopes, approval levels and undo                                                                                                   | `src/main/control/`                    | The permission model                               |
| Local speech recognition: whisper.cpp with CUDA or Metal, Parakeet, Silero voice detection, model download                         | `src/main/stt/`                        | Recognition on all three systems                   |
| Global shortcuts, hold to talk, paste at cursor, reading the selection, on three systems                                           | `hotkeys.ts`, `platform/`              | Taken as the cross-platform device layer           |
| Screen control on three systems                                                                                                    | `src/main/control/screen/`             | A later capability: "do it for me"                 |
| Packaging, signing, auto-update, hardening, guided setup, bug report                                                               | build files, `updater.ts`, `setup.tsx` | Taken as they are                                  |
| Seasonal themes and the secret theme                                                                                               | `src/themes/`                          | Ported once the base look is settled               |

Speak has no assistant voice (only the browser's built-in synthesis in the control panel), no memory, no generated interface and no continuous presence. Those come from the proof of concept or are new.

### 3.3 Why it struggles on old Macs

I have not measured this, so treat it as the likely cause. Speak's speech recognition is always a local model, and its recommended one, Whisper large-v3-turbo, depends on a GPU: CUDA on NVIDIA, Metal on Apple Silicon. An Intel Mac has neither. The proof of concept avoids the problem by not running a model at all. The new product needs both routes behind one interface (section 8).

### 3.4 Visual style

Tokyo Night palette, JetBrains Mono everywhere, flat surfaces without shadows, thin rules, bracketed actions such as `[ copy ]`, and keyboard hints along the foot of each window. Seasonal themes add pixel sprites and sounds.

## 4. Architecture overview

```
        CLIENTS, one per device                               CORE, one per user
┌───────────────────────────────────────────┐        ┌─────────────────────────────────────────────┐
│ desktop app    Windows · macOS · Linux    │        │ channel · orchestrator · threads · triggers │
│ phone app      iOS · Android     (later)  │        │ memory · views · personas · permissions     │
│                                           │        │                                             │
│ draws the interface and offers            │protocol│ tool server (MCP)                           │
│ device capabilities:                      │◀──────▶│ store: SQLite records, search, files        │
│   microphone · speaker · screen           │        │ harness adapters                            │
│   local speech engines · local files      │        │        │                                    │
│   other apps · shortcuts · notifications  │        │        ▼                                    │
└───────────────────────────────────────────┘        │ Claude Code · Codex · API keys (later)      │
                                                     └─────────────────────────────────────────────┘
  transport: a local pipe when the core is on the same machine, a secure WebSocket when it is remote (later)
```

Five ideas hold this together.

**Core and client are separate programs from the first day.** The desktop app does not contain the core. It starts the same core program a server would run and connects to it the way a remote client would. The remote case is therefore exercised every day, and cannot quietly stop working.

**The core owns no hardware.** Microphone, speaker, screen, local files, other apps, shortcuts and notifications belong to a client, which declares them as capabilities when it connects. The core asks for them through the protocol. A phone declares a different set from a desktop.

**Reply text is speech; tool calls are the screen.** Whatever the model writes as its answer is spoken. Everything visual, and every action, goes through tools the core serves. This replaces the proof of concept's commands inside the text, and works the same on every harness.

**The store is the truth; harness sessions are caches.** Any session can be thrown away and rebuilt from the store. That is what allows switching harness or model at any time, and what keeps long-running threads within context limits.

**Everything observable is one event stream.** The interface, the transcript and the inspector are readers of the same typed events. A recorded stream can be replayed through the core without a window, which is how the orchestrator is tested.

## 5. Cloud and mobile: prepared now, built later

You want to be able to add a paid service later: sync of the user's content, a hosted core on a server in place of the user's machine, and a native phone app. None of it is in the first version. This section fixes what the first version must respect so that none of it requires a redesign.

### 5.1 The shape

```
 phone app ────┐
               ├── secure WebSocket ──▶ hosted core, one per user ──▶ harness or API
 desktop app ──┘                              │
                                              └── records and files ──▶ service storage
 desktop app with its own local core ◀── records and files ──────────────┘
```

- **One core per user.** The core is written for a single user. A hosted service runs one isolated instance per customer, not one program for everyone. The core stays identical in both places, and customers' data and agent processes never share a process.
- **One active core at a time.** A user's turns go to one core: the one on their machine or the hosted one. The other copy receives the records and can take over. Two orchestrators never answer the same conversation.
- **A phone is always a client.** A phone cannot run a harness, so the phone app connects to a core elsewhere: the hosted one, or later the user's own desktop through a relay.
- **The paid service is separate from the core.** Accounts, billing, provisioning, the relay and storage are programs of their own. The local product never depends on them.
- **Several devices at once.** The device that last captured speech is the active one: it listens and speaks. Other connected devices show the same views silently.

### 5.2 Rules the first version follows

| Rule now                                                                                                                                                                                                                      | What it allows later                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Core and client are separate programs, speaking a versioned protocol through a transport interface                                                                                                                            | A remote core is a second transport, not a rewrite                                    |
| A connection opens with a handshake: protocol version, kind of client, device identifier, capabilities, credential                                                                                                            | Accounts, several devices, older clients still in use                                 |
| The core reaches hardware only through device capabilities                                                                                                                                                                    | A phone, or a desktop far from its core                                               |
| Input is text or audio. Speech output is text for the device to voice, or audio                                                                                                                                               | Speech engines on the device or on the server, chosen per device                      |
| Every durable record is immutable and carries a global identifier, the core that wrote it and a sequence number. A change is a new record; a deletion is a tombstone                                                          | Sync is "send the records the other side lacks", with no conflict to resolve          |
| Files are stored by content hash. Records refer to hashes, never to local paths                                                                                                                                               | Files sync through any object storage, and a path on one machine never breaks another |
| Search indexes and vectors are derived data, rebuilt by each core                                                                                                                                                             | They are not synced, and each core may use its own embedding model                    |
| Settings are split into user settings (personas, the AI program preferred and the model it answers with, memory options) and device settings (microphone, speakers, voice, listening, shortcuts, how the app starts, updates) | User settings follow the user; device settings stay with the device                   |
| The view format and the catalogue contain nothing specific to the web                                                                                                                                                         | One catalogue, a web renderer now and a React Native renderer later                   |
| Client logic (connection, state, speech playback) lives in a package with no web or Node dependency                                                                                                                           | The phone app reuses it                                                               |
| Secrets (harness sign-in, tokens) are never written to the store                                                                                                                                                              | Nothing sensitive replicates by accident                                              |
| Triggers run in the core and deliver through a "notify" capability                                                                                                                                                            | A hosted core can wake a phone with a push notification                               |

These rules cost little now. Anything beyond them (accounts, billing, the relay, encryption of synced content) waits for the design of the service itself.

### 5.3 Questions that belong to the service design

- **Model access on a hosted core.** Either the user signs in to their own harness on their instance, or the service uses API keys through the API adapter and bills for usage. Which is permitted is a terms question for each vendor. The API adapter is the route that does not depend on the answer.
- **Encryption.** When the service only stores a copy, records and files can be encrypted on the device so the service cannot read them. A hosted core has to read its user's data to work, inside that user's own instance.
- **Phone stack.** React Native is the natural choice: it shares the language, the protocol, the client logic and the catalogue, and json-render ships a React Native renderer for the same catalogue. Components are written twice, for web and for phone; format and behaviour once. Speech on the phone uses each system's own recogniser and voice; on iOS that is the Apple framework the proof of concept already uses.

## 6. Harnesses

### 6.1 The interface

```ts
interface Harness {
  id: string // 'claude-code', 'codex', later 'anthropic-api', …
  status(): Promise<HarnessStatus> // installed, signed in, version
  login(): Promise<void> // opens the vendor's own sign-in
  models(): Promise<Model[]>
  capabilities: {
    textStreaming: boolean // reply text arrives as it is written
    toolInputStreaming: boolean // tool input arrives as it is written
    resume: boolean // can reopen one of its own sessions
    images: boolean
    webSearch: boolean // has its own web search
    reportsCost: boolean
  }
  complete(req: OneShot): Promise<Completion> // no tools, no state: summaries, titles, memory extraction
  open(req: SessionRequest): Session // live and multi-turn
}

interface Session {
  send(input: TurnInput): void // accepted while a turn is running
  interrupt(): void
  close(): void
  on(event: 'text' | 'tool' | 'approval' | 'turnEnd' | 'usage' | 'failed', handler): void
}
```

Speak's `Agent` and `ControlAgent` interfaces already cover most of this for Claude Code and Codex, on all three systems.

### 6.2 Rules

1. **A harness is an engine.** We give it a system prompt, the address of our tool server and the turn's input. We take back text, tool calls and usage figures.
2. **Everything the harness would add by itself is switched off**: its memory, the user's settings and project files, the user's own MCP servers and connectors, slash commands, plugins and its own sub-agents.
3. **Roles map to models.** The orchestrator runs a fast model, threads the model the user chose for the answers, utility calls the cheapest. Each harness adapter carries its defaults and the list it offers: with Claude Code the answers run on Haiku unless the user picks Sonnet or Opus; with Codex, on its balanced Terra model unless the user picks another of the models Codex lists for the account. The orchestrator stays on the fast model whatever is chosen: it hears every utterance before anyone answers, so its delay is added to every reply, and routing needs no depth. A choice is a user setting kept by the core, and applies from the next session. When both harnesses are ready, the user's preferred one runs; otherwise the first ready.
4. **Web search stays with the harness when it has one**, since it comes with the subscription. The adapter maps it to a common tool name. Otherwise our own tool is used.
5. **API keys are one more adapter.** It implements the same interface with its own agent loop or the vendor's agent SDK. Nothing above this layer changes, which is why principle 6 costs nothing now and why a hosted core has a route that needs no CLI.

### 6.3 Known constraints

- **Isolation under subscription sign-in.** `claude --bare` skips auto-memory and CLAUDE.md discovery, but its help text says it accepts API-key authentication only. With a subscription we use the set Speak uses (`--setting-sources ""`, `--strict-mcp-config`, `--disable-slash-commands`, `--system-prompt-file`, a private working folder) and must verify that auto-memory stays off. Codex has explicit switches (`--disable memories`, `--disable multi_agent`, `project_doc_max_bytes=0`), which Speak already passes.
- **Start-up time.** A harness process is slow to start, so sessions are kept warm. Each warm session costs memory, which limits how many the light tier can hold.
- **Usage.** An orchestrator plus several threads consumes more of a subscription's allowance than one conversation.
- **Terms of use.** Both vendors' terms should be checked for driving their CLI from an app distributed to other people. Speak already depends on this.

## 7. One channel, hidden threads

### 7.1 The path of a turn

1. **Capture.** Speech is recognised into text, with partial words shown while the user talks.
2. **Local intents.** Commands that need no intelligence never reach a model: stop, pause, next, louder, repeat, show the transcript, switch persona. A small grammar per language handles them instantly.
3. **Context.** The core assembles the time and place, the thread in focus, the index of open threads (title, one-line state) and the memories most relevant to this utterance.
4. **Orchestrator.** A warm session on a fast model reads the utterance and makes one of four moves:
   - answer directly, with speech and optionally a view, for small talk and quick facts;
   - `thread.send`, to continue an existing thread;
   - `thread.open`, to start a new thread or an aside;
   - `thread.focus`, to bring an earlier thread's view back ("back to the document").
5. **Thread.** The chosen thread works in its own session with its own tools and answers in three layers (section 7.2): it says the short answer, shows its view, and keeps its full written answer.
6. **Record.** The utterance, the spoken reply, the view and the thread are appended to the channel log.

Dispatch does not block. Once the orchestrator has passed a turn on, it is free to hear the next one, so the user can keep talking while a thread works.

### 7.2 Who speaks

The thread in focus speaks directly: its reply text streams straight to the voice, without passing back through the orchestrator. Going back would add a second model round trip to every answer. The orchestrator receives a compact note of what was said, so it stays informed.

The user still hears one voice, because every session receives the same persona and all speech goes through one queue. The queue plays one speaker at a time, gives priority to the thread in focus, and holds results from background threads until a pause.

**An answer has three layers**, produced in this order so the voice starts first and the rest arrives while it is heard:

1. **What is said.** Short, as a friend says it (section 8.5): the session's text, spoken sentence by sentence as it is written, and the caption. A thread writes it before any tool call except a search.
2. **What is shown.** The view (`ui_render`), drawn while the voice speaks.
3. **The full work.** The complete written answer, in Markdown, with figures, sources and details (`answer_write`), and every tool call with its input and its whole output (a web search's results, a page read, a view shown). It is kept with the exchange and the thread, and read only in the side sheet (section 13.3). Small talk has none, so a simple answer costs nothing more.

The order is held by the instructions, by a reminder at the end of each request, and by the core: a call to `ui_render` or `answer_write` before anything was said is sent back once ("say the short answer first"), after which the model speaks at once and keeps the order for the rest of its thread. A layer is a tool rather than a marker in the text, because tool calls are what both harnesses deliver reliably and in order.

**Nothing is said twice.** Each speaker's words are cut into sentences of their own (a thread's first sentence never runs into the orchestrator's last); what the orchestrator said before passing a turn on is told to the thread, which carries on from it; a sentence already said in a turn is not said again; once the full answer is written, a recap in other words is not voiced; and a thread brought back says only what was not heard of its answer. The double voice users heard came from the orchestrator greeting and then passing the briefing to a thread that greeted again, through one shared sentence cutter, and from a thread repeating its answer after its tool calls.

### 7.3 Threads

| State    | Meaning                                                                |
| -------- | ---------------------------------------------------------------------- |
| Working  | A turn is running                                                      |
| Waiting  | The thread asked the user a question                                   |
| Parked   | Idle, with a summary. Its harness session may be closed to free memory |
| Archived | Finished or long inactive. Its lasting facts have been moved to memory |

- A thread owns its transcript, its view, its files and a rolling summary.
- A parked thread's session is closed after a delay that depends on the hardware tier. It is rebuilt on the next use from the persona, the summary, the last exchanges and the relevant memories.
- The orchestrator sees the most recent threads in its context and can search older ones (`thread.search`), so "that recipe from last week" finds an archived thread.
- Harness sub-agents are not used. Threads must persist across days, run on different models or harnesses, and be visible in the inspector, none of which a harness's own sub-agents allow.
- The number of threads working at once is capped by hardware tier.

### 7.4 Background results

When a thread finishes while another is in focus, its result does not interrupt. A "ready" chip appears over the view, in the centre column, with a soft sound. The assistant mentions it at the next pause ("Your recipe is ready, by the way"), or the user asks for it. This is a setting: mention, chip only, or speak at once.

### 7.5 Asides

An aside is a question that does not change the topic: "By the way, what time is it in Montreal?"

- **Trigger.** A spoken marker ("by the way", "quick question", their French equivalents), the orchestrator's own judgement when a short unrelated question arrives mid-task, or an optional modifier on the talk shortcut.
- **On screen.** A compact card with the answer appears in the centre column, over the view of the topic, which stays where it is. Nothing moves aside: the core and the view stay centred.
- **Its topic.** An aside records the topic on the stage when it was asked, its parent. The side sheet lists it under that topic; opened there, it shows its work like any thread, and "Show the card" brings its card back beside the stage.
- **After.** The card is dismissed with its close button, or saved to the library and pinned like any view (section 9.8). It can be promoted to a full thread ("tell me more about that"). Leaving by itself after a while, on "thanks" or on Esc, is not built yet.
- **Behind.** The orchestrator answers it directly, or opens a short-lived thread that is archived at once.

### 7.6 Example

```
"I have guests coming tonight, what's a good recipe?"
   orchestrator   no thread fits: opens A "Dinner for guests", focus on A
   thread A       checks memory for the guests' diets, searches, renders a recipe view
                  says: "A mushroom risotto would work. Forty minutes, and it suits your vegetarian guest."

"I was filling out a document earlier and I need help with the admin side."
   orchestrator   finds B "Housing form", parked yesterday: focus on B, the stage shows its document preview
   thread B       resumes from its summary
                  says: "We stopped at the income section. Do you have last year's tax notice?"

"By the way, what time is it in Montreal?"
   orchestrator   an aside: answers directly, a card over B's view, focus stays on B

"And for the risotto, can I use white wine instead?"
   orchestrator   sends to A, focus on A, the stage shows the recipe again
```

### 7.7 Proactive turns

The assistant can start a turn itself: the briefing at launch or on greeting, a reminder, a background result. Each is a thread opened by a trigger (time, app start, greeting, thread finished) rather than by an utterance. The proof of concept's briefing and daily news become two such triggers.

### 7.8 Routing cost

Every utterance passes through the orchestrator, so work that goes to a thread costs two model calls: the routing, then the answer. Direct answers cost one. If measurement shows the routing step is too slow for a user who stays on one task, the fallback is sticky focus: utterances go straight to the thread in focus, which hands back to the orchestrator when the subject is not its own. Version 1 keeps the simple path, and the first build step measures it.

## 8. Voice and audio

### 8.1 Input

- **Version 1: push to talk.** A key in the app, or a global shortcut from anywhere once the user records one, starts listening; a pause ends the take (short, normal or long, as the user sets), or the key pressed again when the user sets it never to stop by itself. A soft tone marks the start and the end, unless turned off. Both keys are recorded by pressing them in settings; the global one is refused, with the reason, when the system or another app holds it. Holding the key while speaking is not offered: Electron's global shortcuts report no key release, and a keyboard hook (Speak's) is a native dependency not worth it yet.
- **Exact keys.** A key in the window fires only with exactly its modifiers, no more and no fewer, and never on the repeats of a key held down. The shortcut from any app is off until the user records one: a global shortcut takes its keys from every other program, and the former default, Ctrl+Shift+Space, is an editor's own (parameter hints). Settings written by earlier versions let go of that default, and keep any keys the user chose.
- **The microphone** is the system's default unless the user picks one. It is found again by its name when its identifier changes, and the system's default is used while it is unplugged. Settings show its live level, so the user sees it hears them before talking.
- **Later: open conversation.** The microphone stays open, speech is detected automatically, and talking over the assistant interrupts it. This needs echo cancellation and careful end-of-speech detection, and is its own project.
- **Typing** is always available on the input line, which doubles as the live caption of what is being recognised.

### 8.2 Engines, by system and hardware tier

Measured and chosen on 17 November 2026: one library, sherpa-onnx, runs every engine on the processor, on Windows, macOS and Linux, in a process of its own on the device.

| Purpose          | Engine                            | Languages             | Measured on a 6-core desktop processor | Download |
| ---------------- | --------------------------------- | --------------------- | -------------------------------------- | -------- |
| Recognition      | NVIDIA Parakeet TDT 0.6B v3, int8 | 25 European, detected | 6 s of speech heard in 0.35 s          | 671 MB   |
| Voice            | Supertonic 3, int8, ten styles    | 31, told per sentence | 6 s of speech made in 1 s              | 145 MB   |
| Speech detection | Silero VAD v5                     | Any                   | 9 s of sound in 33 ms                  | 2 MB     |

- **The models are downloaded once**, at first launch or later from settings, with progress, and resumed if interrupted. Nothing is sent anywhere: voice never leaves the device.
- **The voice's language is told per sentence.** The core tells each sentence's language from its words (English or French), since Parakeet does not report the language it heard.
- **Each persona speaks in its stance's style** until the user picks one: a calm voice for the accommodating stance, a deeper one for the critical stance.
- **Licences.** Parakeet is CC-BY-4.0. Supertonic's model is OpenRAIL-M, which carries use restrictions to pass on to users; to review before distribution.
- **Still to measure** on old hardware, and on macOS older than 14 (Apple Silicon) or 15 (Intel), the minimum the native builds declare. The process holds about 1.45 GB with all three engines loaded; a lighter recognition set for the light tier is still to choose.
- The tier also sets the memory components and the number of threads working at once:
- The tier also sets the memory components and the number of threads working at once:

| Tier        | Typical machine                              | Vector memory                                          | Threads at once |
| ----------- | -------------------------------------------- | ------------------------------------------------------ | --------------- |
| Light       | Intel Mac or an older laptop, 8 GB           | Built in the background; search falls back to keywords | 1               |
| Standard    | Apple Silicon or a recent laptop, 8 to 16 GB | On                                                     | 2               |
| Performance | 32 GB or more, or an NVIDIA GPU              | On                                                     | 4 or more       |

Each engine sits behind one of two interfaces, `Recognizer` (start, partial text, final text, stop) and `Voice` (speak a sentence, stop). In version 1 the engines run on the device. The same interfaces let a hosted core run them on the server later, for phones and weak machines.

Apple's recogniser is not used: the same local engines run on every system, so the product behaves the same everywhere and no audio reaches a vendor.

### 8.3 System integration

Global shortcuts, hold to talk, reading the selection and writing at the cursor exist in Speak for all three systems, and are taken from there. One limit carries over: under Wayland on Linux, an app cannot register global shortcuts or drive other windows. Speak's answer is command-line flags the user binds to desktop shortcuts, and an X11 session for control of other apps. Echo takes the first part: started with `--talk` while it runs, it comes forward and listens.

The app waits in the system tray (the menu bar on macOS): closing the window leaves it there, ready for its shortcut, unless the user sets closing to quit. It can open at login, out of sight (`--hidden`), and start in the background.

### 8.4 Output

- Speech is produced sentence by sentence as the reply text arrives, so the first sentence is heard while the rest is still being written. A sentence is released as soon as it is known to be whole: when text follows it, or when the session starts a tool call.
- **The sound of what comes next is made ahead.** While a sentence plays, the device's voice makes the sound of every sentence queued after it. A long sentence (100 characters or more) is made a clause at a time, cut where a speaker breathes, and its first clause plays while the next are made; the clauses are scheduled end to end on the audio clock, so there is no gap.
- **The caption follows the voice.** A sentence is shown when its sound starts, not when its text arrives, and each word lights up as the voice reaches it, timed from the sound's length. Every word is in place from the start, so the line never reflows.
- **While it works, it says what it is doing.** The word under the core names the tool in use: "Searching the web", "Reading a page", "Preparing the view", instead of only "Thinking".
- The user sets the pace (four steps around the voice's own), the speakers it plays on (the system's default unless chosen, routed with the audio context's `setSinkId`), or text only, for a quiet room.
- Stop is instant, by key, by voice or by starting to talk.
- Short sounds mark listening, thinking and results ready. When a thread needs more than about a second, the core animation shows it. A spoken "one moment" is used only for long waits.
- Target to validate in the first build step, on each system: under 1.5 seconds from the end of speech to the first sound, for a direct answer on a warm session.
- **Measured on 17 November 2026**, Linux, Claude Code on Haiku, from Enter to the first sound / the first caption / the view. Before: a direct answer 3.6 s / 3.1 s (the caption ran ahead of the voice); a topic with a view 19.1 s / 17.8 s / 19.2 s, everything waiting for the thread's search and view. After: a direct answer 2.5 s / 2.6 s; a new topic with a view 7.0 s / 7.1 s / 7.7 s, the view drawn while the voice speaks; the next turn in that topic 5.4 s / 5.5 s / 6.6 s; a weather lookup through a reliable source 6.4 s, its card at 11.5 s; two web searches 23.7 s, with "Searching the web" shown meanwhile; the greeting 4.3 s. Of a new topic's 7 s, about 2.5 s is the orchestrator's decision, 3.5 s the thread's first words and 0.7 s the voice.

### 8.5 The speech contract

Every session's instructions contain these rules.

- Two sentences by default. More only when the user asks to hear more.
- Plain spoken language: no markup, no lists, no addresses or long numbers read aloud.
- Anything enumerable or detailed goes to the view.
- Never describe the view aloud ("as you can see on screen…"). Say the point, show the rest.
- When there is no screen to use (Mini mode, a locked screen, a phone in a pocket), say a little more.

### 8.6 Languages

English and French from the start, as in the proof of concept. The interface itself is in English only for now, so its language is not a setting yet. Whisper and Parakeet detect the language; Apple speech needs it chosen. French voice quality with local models is an open point: the proof of concept offers Kokoro for English only.

## 9. Generated interface

### 9.1 UI SDK and json-render

|                           | UI SDK (`vercel-labs/ui`)                                                                                                                                        | json-render (`vercel-labs/json-render`)                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| What it is                | A library of interaction behaviours (popups, selection, focus, keyboard, drag and drop) for building components, in React, Vue, Svelte, Solid and Web Components | A generative interface framework: the model writes a JSON description, limited to a catalogue of components you define, and a renderer draws it |
| The model's role          | Writes component code while you develop. At run time, an "agent bridge" lets a model read and operate components already on the page                             | Composes the interface at run time, for each answer                                                                                             |
| Streaming, state, actions | Not its subject                                                                                                                                                  | Streamed rendering, a state model with bindings, actions back from the interface                                                                |
| Phone                     | Web frameworks only                                                                                                                                              | A React Native renderer for the same catalogue                                                                                                  |
| Maturity                  | Beta (0.1.0-beta.6), announced 12 November 2026                                                                                                                  | Pre-1.0 (0.23.1), public since January 2026                                                                                                     |
| Licence                   | Apache-2.0                                                                                                                                                       | Apache-2.0                                                                                                                                      |

What you described (a weather module appearing for a spoken question, a document preview with a download button) is json-render's job. UI SDK cannot do it alone: it has no format for a model to describe an interface at run time.

**Decided: both, in layers.**

- **json-render** is the generation layer: catalogue, validation, streaming, rendering.
- **Our own building blocks** are the catalogue (section 9.6). Because the model can only compose what the catalogue contains, the result always has the app's native look.
- **UI SDK** supplies the behaviours inside the web components (keyboard, focus, accessibility). Later, its agent bridge could let the assistant operate what is on screen by voice ("tick the second box").

Both libraries are young, so both stay behind our own packages. The rest of the app knows our view format, not theirs.

### 9.2 How a view is made

1. The catalogue's description is part of every thread's instructions. json-render generates it from the catalogue.
2. The model calls `ui.render(spec)` for a new view, `ui.patch(changes)` to change the current one, `ui.clear()` to remove it.
3. The core validates the spec against the catalogue. An invalid spec is returned to the model as an error it can correct. Nothing the model writes is ever executed as code.
4. The view is stored with its thread and sent to every connected client. On harnesses that stream tool input, it draws progressively; on the others it appears when the call completes.

### 9.3 Where views appear

| Place  | Content                                                                                                                                       | On a phone                      |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Stage  | The view of the thread in focus. It changes when that thread renders again or when focus moves                                                | The whole screen                |
| Asides | Answers to side questions, as compact cards, and "ready" chips of background threads. In the centre column, over the view (the `margin` slot) | Banners over the stage          |
| Pinned | Saved widgets the user pinned (section 9.8), live, stacked on the right of the main screen in the user's own order                            | A sheet pulled up from the edge |

Everything the assistant composes appears in the centre: the core, its caption and the view stay centred whatever else comes up, and nothing the assistant does pushes them aside. The right side belongs to the user: the pinned widgets float in its margin, and the side sheet, opened from the title row, holds the advanced views: the transcript, the threads and the inspector (section 13.2).

A view says what to show, never where on a screen. Components describe content (a recipe, steps, a table), and each renderer lays them out for its device. Every block wraps and shrinks to the width it is given, from the stage to a card in the pinned stack, and a word longer than its line breaks rather than overflowing. The core tells each session what kind of device is active, so a view meant for a phone stays short.

Earlier views are never lost: each belongs to a thread and can be brought back by asking, as the proof of concept's "Last" button does. Views the user wants to keep go to the library.

### 9.4 Live data

A block can be bound to a data feed kept up to date by the core: weather, system readings, calendar, a timer. A view the assistant composed about the weather, once pinned, then stays current with no further model call. This is how the proof of concept's fixed panels return: as views the assistant composed and the user chose to pin, not as components built in advance.

What is live by nature needs no feed: a pinned view with a Media block plays its stream whenever it is drawn. Feeds for figures (a Metric or a Chart kept current) are not built yet.

### 9.5 Actions

- **Local actions** are handled by the client with no model involved: download, open, reveal in folder, copy, play, pause, set the volume, dismiss, save to the library, pin.
- **Semantic actions** go back to the owning thread as an event ("the user chose option 2", "the user ticked 'butter'"), and the thread continues from there.

### 9.6 The catalogue: building blocks only

The catalogue contains generic building blocks and nothing made for one subject. There is no weather component, no recipe component and no prepared illustration. A weather answer is a layout the assistant composes for that answer, from the same blocks it would use for anything else: a few metrics, a small chart, a drawing it writes itself. What appears on screen is then as open as the conversation, and our work goes into the blocks and into how well a model composes them, not into a growing list of special cases.

| Group   | Blocks                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------- |
| Layout  | Stack, Row, Grid, Card, Section, Divider                                                                                  |
| Text    | Heading, Text, Badge, KeyValue, List, Steps, Prose (formatted long text, for when detail is asked for)                    |
| Data    | Metric, Table, Chart, Timeline, Progress                                                                                  |
| Drawing | Drawing (vector shapes the assistant writes itself: lines, circles, paths, labels), Image (a picture from a file or page) |
| Media   | Media (sound or video from an https stream or file: a radio, a podcast, a song, a clip)                                   |
| Input   | Choice, Checklist, Field, Button                                                                                          |
| Files   | FilePreview (document, image or text, with download and open), FileList                                                   |

Three rules keep it that way:

1. **A block is a kind of content or arrangement, never a subject.** The test before adding one: would answers on unrelated subjects use it?
2. **No prepared artwork.** The product ships no icon set and no illustration for the assistant to pick from. When an answer needs a picture, the assistant draws it with Drawing, in the accent and text colours, or uses a character as a pictogram.
3. **Live data attaches to generic blocks** (section 9.4): a Metric or a Chart bound to a feed, not a dedicated widget.

The catalogue stays small on purpose: it is part of every prompt, and a model composes better from few well-described pieces. When nothing fits, the model falls back to Prose rather than failing.

**Media.** There is no radio and no video player in the catalogue: there is Media, a block that plays a stream or a file, and the assistant composes the rest around it (what is on, other stations as Buttons, a drawing). It finds the stream's address itself with its web tools: a radio station publishes its stream, and the assistant shows the stream, never a link to the station's web player. Chromium plays MP3, AAC, Ogg, Opus, MP4, WebM and HLS playlists by itself, so no player library is needed. Addresses are https only. In the interface:

- One player serves the whole app. One sound plays at a time, whichever view asked for it, and it goes on when its view is replaced or closed. A small "now playing" control sits in the title row, and the system's media keys work.
- A Media block starts by itself only when it was shown in answer to the turn under way ("play FIP"). Nothing plays when the app opens, and a topic brought back does not restart what the user stopped.
- The sound is lowered under the assistant's voice and while the user talks, and comes back smoothly after.
- A video is drawn in its block while it plays; when the view goes, its sound goes on.

### 9.7 Files

Each thread has a set of files of its own, kept by the core. A document the assistant produces or edits is shown through FilePreview with download and open buttons. Each change saves a new version, so the user can take the file and edit it while the assistant carries on. Files dropped onto the stage are attached to the thread in focus.

### 9.8 The library

The user keeps the views they like. Every view, on the stage, in an aside or pinned, has a bookmark: one press saves it. The library collects them, so the user builds a set of widgets of their own out of what the assistant composed for them, and the assistant brings them back as they are.

- **What is kept.** A saved widget is a view and a few words about it: a title, an optional collection, whether it is pinned and, pinned, its place in the stack. What it shows or plays is its spec, drawn again; a saved radio plays, a saved chart is as it was. Nothing in the library is a component made for one subject.
- **Records.** Each change is a new `library.widget` record carrying the widget's identifier and its whole state; deleting one is an erasure of every version (section 10.3). The library is the user's, kept by the core, so it follows them to every device.
- **The library screen.** Reached from the title row. Widgets are drawn live as tiles, filtered by all, pinned, unfiled or a collection, and searched by any word they show. Opened, a widget is drawn at full size beside its name, its collection (collections are the user's own, made by typing one), a pin switch, "Show on the stage", "Ask for a change" and "Delete". The content is the assistant's to change: asking for a change sends the request to the assistant, which saves a new version and shows it at once, without starting what it plays. Verified with the real Claude Code: asked from the library to add a line under the radio, it saved and showed the new version.
- **Pinned.** A pinned widget floats live on the right of the main screen, in a stack the wheel scrolls through. A widget just pinned goes on top; the user puts the stack in order by dragging a card by its bar, and the order is the library's (`place` on each widget, set with `library.arrange`), kept by the core and the same on every device. Each card folds to its bar, and a tall one is shown to a fixed height until unfolded; what it plays goes on either way. The stack never pushes the centred column: where the window's margin cannot hold it, it waits folded into a small tab, and opened from there it floats over the stage. Nothing pinned starts playing by itself.
- **The assistant remembers.** Every session is told what is saved, by name and in a few words (up to thirty, then it searches), and threads have five tools: `library_search`, `library_show`, `library_save`, `library_update` and `library_delete`. When the user asks for something a saved widget covers ("I want to listen to the radio again"), the thread shows the saved widget with `library_show` instead of composing a new one, so it comes back the same each time. A view shown this way names its widget, and the core checks it against the catalogue again first, in case a block changed since it was saved. The assistant saves, files, pins or deletes a widget only when the user asks.

## 10. Memory

### 10.1 What harnesses store, and why to switch it off

| Harness     | Its own storage                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | Session transcripts on disk (used by `--resume`), CLAUDE.md instruction files, and an automatic memory folder per project |
| Codex       | Session files, AGENTS.md project documents, and a memories feature                                                        |

All of it is tied to one vendor, stored in that vendor's format, and invisible to the other. It is switched off and memory is managed by the core. Section 6.3 covers how.

### 10.2 Layers

| Layer            | Content                                                                                                                                                      | Use                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Channel log      | Every utterance and reply, word for word, with time and thread                                                                                               | The record nothing is lost from. Searchable |
| Thread summaries | Title, rolling summary, state and people or things mentioned, per thread                                                                                     | Routing, and rebuilding a session           |
| Facts            | Short statements about the user: people, preferences, projects, commitments with dates. Each has its source turns, a date and a status (current or replaced) | What the assistant knows                    |
| Profile          | A few hundred words drawn from the most important facts and the user's context file                                                                          | Present in every prompt                     |
| Files            | Documents produced or received, cut into passages                                                                                                            | "That PDF I gave you last month"            |

The channel log is kept in full unless the user sets a retention period. This is the answer to "recall every important thing it has heard": even when fact extraction misses something, the words are still there to search.

### 10.3 Storage

**One SQLite file, with its built-in full-text search (FTS5) and the sqlite-vec extension for vectors.**

- Not PostgreSQL with pgvector: it needs a database server running beside a desktop app, which is the wrong weight for a weak machine and a burden to install on three systems.
- Scale is not a concern. A heavy user produces a few hundred thousand turns in several years, which a single SQLite file handles comfortably. Vector search speed at that size is to be benchmarked on the light tier.
- One file is easy to back up, export and delete, and the same file works on a hosted core.

**Records are immutable** (section 5.2). A turn, a fact, a view version or a file version is written once, with a global identifier, the core that wrote it and a sequence number. Correcting a fact writes a new record that replaces the old one. "Forget that" writes a tombstone and erases the content. Tables that answer "what is true now" are indexes kept in step with the records. This costs little now and makes later sync an exchange of missing records.

**As built.**

- **The tombstone** is a record of type `record.erasure` naming the records to erase (`ERASURE` in the core's records port). Appending one empties the payload of each record it names, which is read back as `null`, and takes their text out of the search index. The erased records keep their place, identifier and sequence number, so sync still has nothing to reconcile. It is the one exception to "records never change", and it exists so that forgetting is real.
- **The keyword index** is an FTS5 table, `search_text` (migration `0002-search`), with accents and case folded. The store takes each record into it in the same transaction that writes the record, so what was said can be searched the moment it is recorded. On opening, it takes in whatever was written since it last read the table (a file from before the index, or records written by another version), from a progress mark it keeps. Which text a record is found by is decided by the core (`searchableText`): for an exchange, both sides of it; for a fact, its statement. The words searched for are the core's too (`keywordsOf`): no words that carry nothing, in English and in French, and a word of four letters or more also finds the words it starts. Ranking is bm25, divided by `1 + age / half-life` when the search asks for recency.
- **The `Search` port** (`packages/core/src/ports/search.ts`) takes a text, record types, a limit, a period and an optional half-life, and gives hits: record, type, date, snippet and score. Vectors (section 10.4) will be a second adapter whose hits are merged with these by record; keyword search answers alone until then.

### 10.4 Embeddings

Vector search needs an embedding model, and harnesses do not provide one. Under "no API keys", that leaves a small model running locally.

- It must be multilingual, since the user mixes French and English, and keyword search fails across languages and on misheard words. Candidates to benchmark: multilingual-e5-small, bge-m3.
- Embedding happens during sleep (section 10.6), so it never delays speech.
- Each vector is stored with the name of the model that made it, so the model can be changed and the index rebuilt.
- Search works without vectors. If the model is absent or the index is behind, keyword search answers alone.

### 10.5 Reading

- **Automatic.** Before each turn, the core searches the utterance against facts and recent log (keywords and vectors combined, weighted by recency) and adds the best few results to the context. The model does nothing.
- **On demand.** The model can call `memory_search(query, after, before)` when it needs more, for instance "what did we decide about the trip in March?".

As built, recall is keyword search alone and makes no model call. It finds up to four facts true now (half-life a year) and up to three lines of the log (half-life 45 days), and leaves out the lines the session already knows: those it was told when it opened, and everything said since. The memories go ahead of what the user said, in brackets, as something to use if it helps and not to mention otherwise; the exchange is recorded with the user's words alone. A memory that cannot be searched never stops the answer: recall then gives nothing.

### 10.6 Writing: awake and asleep

Memory is written in two phases, as a person's is.

- **Awake, it keeps the words.** Every utterance and reply goes into the channel log at once, word for word. That takes no model call and delays nothing, and the words can be searched by keyword straight away.
- **Asleep, it makes sense of them.** Extracting facts, summarising threads, classifying, building the vector index and archiving idle threads all happen while the assistant sleeps, never during the conversation. A cheap model reads what was said since the last sleep, compares each candidate fact with similar existing ones and decides: add, update, replace or ignore. The proof of concept's memory prompt, which it ran when idle, is the starting point.
- **When it sleeps is a setting.** After a period with no exchange, at a set time of day, both, only when told ("go to sleep"), or never. The default is after a quiet period.
- **Sleep never gets in the way.** Speaking to the assistant wakes it at once. Work left unfinished resumes at the next sleep, from where it stopped. The core shows the state: it dims and breathes slowly.
- **On request, at once.** "Remember that…" writes immediately through `memory.remember`, without waiting for sleep. "Forget that…" removes the fact through `memory.forget`.
- **Only from the user.** Facts come from what the user said or confirmed. Web pages, files and the assistant's own guesses are never stored as facts, which also protects memory from instructions planted in a web page.
- **Dates are absolute.** "Next Friday" is stored as its date.

What sleep has not yet processed is not lost in the meantime: recall (section 10.5) searches the raw log as well as the facts.

**Facts as records.** A fact is a record of type `memory.fact` carrying the fact's own identifier, its statement, its kind (person, preference, project, date, override, other), how it came (from conversation, told, edited), the turns it came from, and the date it was first learned. A later record with the same identifier is a new version of it: an update during sleep, or the user's correction. A record that `replaces` another fact ends that one, which stays as history and is no longer true. Forgetting writes one tombstone naming every version of the fact, the facts it replaced before it, and the profiles, which may say it; the next sleep writes a new profile. Overrides of the critical stance (section 11.4) are facts of the kind `override`.

**Sleep, as built.** The setting is the user's, kept as `memory.sleep-set` records: when (`quiet`, `time`, `quiet-or-time`, `asked`, `never`), the quiet period (10 minutes by default) and the time of day (03:00 by default, on the core's clock). The core is given timers by its host (`Timers` in `ports/clock.ts`); without them it sleeps only when told. It does not fall asleep in the middle of an answer: it looks again a minute later. `never` refuses even "sleep now", so the only facts are those the user asks it to remember.

Asleep, it reads the exchanges written since its cursor, twelve at a time at most, and for each batch:

1. **Extract.** One call (role `utility`) with the turns numbered, each with its weekday, date and time, so relative dates can be made absolute. The model answers with candidate facts as JSON, each with the turns it came from.
2. **Reconcile.** Each candidate is searched against the facts true now; the three most alike are its comparison. If no candidate resembles anything, all are added with no call. Otherwise one call decides add, update, replace or ignore for each; a fact the model names that the candidate was not compared with is not touched, and a candidate it skips is added.
3. **Write.** The facts and a `memory.slept` cursor (the last exchange read) are appended together, so a batch is kept whole or not at all.

An answer that cannot be read is asked for once more, then the batch is passed over and logged, so that one batch cannot block every sleep after it. A harness that cannot be reached stops the sleep, and the batch waits for the next one. Speaking wakes it at once: the call in flight is let go and its answer dropped, and that batch is read again at the next sleep. When the facts changed since the last profile, it ends by writing a new one (a call that turns the most important facts into at most 250 words, overrides first) as a `memory.profile` record. Every session is given the profile and the facts learned after it; a new profile opens a new session at the next turn, while facts remembered on request reach the session through the tool that kept them.

**Tools.** `memory_search(query, after, before)`, `memory_remember(text, kind)` (immediate, from the turn under way, and once: the same statement is not kept twice) and `memory_forget(fact or description)`. Forgetting by description forgets the one fact that matches best; when several match nearly as well, nothing is forgotten and the model is given their identifiers to choose, or to ask.

**Checked against the real thing.** `apps/server/test/memory.real.test.ts`, run with `REAL_HARNESS=1`, gives Claude Code's smallest model five exchanges said on Tuesday 17 November 2026 and puts the assistant to sleep. It kept the sister and her city, her visit "next Friday" as 2026-11-20, the preference for green tea, and the project (in French, as it was said), and nothing from the article the user read out or the question about the weather. Told later that the sister moved, it replaced the old city with the new one. Five short calls in all.

### 10.7 What the user sees

A "what I know about you" view, grouped by people, preferences, projects and dates. Each fact shows where it was learned, and can be edited or forgotten. The whole memory exports to Markdown, keeping the best property of the proof of concept's notes file: the user can read and correct it. Memory is shared by every persona and survives any change of harness. A one-off import brings in the proof of concept's notes, context file and history from `~/JARVIS`.

As built, it is the Memory section of settings. At the top, the assistant's state (awake, with when it last slept and when it will sleep next; or asleep, with the progress of its work), the choice of when it sleeps and a "Sleep now" button. Then the profile, then the facts by kind, each with how and when it was learned and the words it came from, with Edit and Forget (which asks once, since the words are erased). Export to Markdown downloads the same, built by the client (`memoryMarkdown`) so a phone can offer it too. The protocol carries it as `memory.read`, `memory.edit`, `memory.forget`, `memory.sleep-settings.set` and `memory.sleep-now`, and the events `memory.changed` and `assistant.state`; a client follows both with `followMemory`, which also gives `asleep` for the main screen to dim the core.

Not built yet: vectors (section 10.4), thread summaries, a retention period for the log, the import from the proof of concept, and erasing from the log the words a forgotten fact came from (forgetting a fact removes the fact; the conversation it was learned in stays in the log, and can still be recalled).

## 11. Personas

A persona is one of the characters the assistant can be. The user talks to the assistant by the name of the persona in use. A persona is data, with four parts:

| Part   | What it is                                                              | Who sets it                  |
| ------ | ----------------------------------------------------------------------- | ---------------------------- |
| Name   | What the user calls it, aloud and on screen                             | The user. Each has a default |
| Stance | How it handles a request it has doubts about: accommodating or critical | The product                  |
| Accent | The one glowing colour it shows                                         | The product                  |
| Voice  | How it sounds (later, with speech output)                               | The product, then the user   |

Two personas ship with the product. They are two entries in one list:

| Default name | Stance        | Accent    | Answers at first launch |
| ------------ | ------------- | --------- | ----------------------- |
| Jarvis       | Accommodating | Cyan-blue | Yes                     |
| HAL          | Critical      | Red       | No                      |

**No code names a persona.** The default names are written in one file, `packages/core/src/personas/defaults.ts`, and nowhere else. Behaviour depends on the stance, the look depends on the accent, and every text the user reads is written for a stance. Neither default is treated differently from the other. Tests use made-up personas. A check built from that file (`scripts/check-persona-names.ts`, part of `pnpm check`) refuses a default name anywhere else in the code: in an identifier, a text or a file name. For the same reason this spec says "the critical persona" where it means the behaviour, and a name only where it means the default name.

### 11.1 Names

- **The user chooses them.** At first launch the app shows the personas with their default names. The user keeps them or types their own, and picks the one that answers (section 11.5). Both can be changed later in settings.
- **A name is something said aloud.** It is kept to letters and digits of any script, with spaces, hyphens, apostrophes and full stops between them, and to 24 characters.
- **Two personas never share a name**, whatever the case. The name is how the user says which one they are talking to.
- **Names are user settings.** The core keeps them, so they follow the user to every device (section 5.2). Only the user's choices are stored, never the defaults: a user who never renamed a persona gets its default name as each version defines it.

### 11.2 The two stances

|                                | Accommodating                                 | Critical                                                                                        |
| ------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Default                        | Does what is asked, at full quality           | Does what is asked, at full quality                                                             |
| When it sees a serious problem | Mentions it in one sentence and proceeds      | Stops before acting: states the concern, proposes the better way, asks whether the user is sure |
| When the user insists          | Not applicable                                | Complies fully, with no reduced effort and no repeated warning                                  |
| Questions                      | Only when it cannot proceed without an answer | Also when the answer would change what is best to do                                            |
| Tone                           | Warm, accommodating                           | Calm, direct, exacting                                                                          |

### 11.3 Rules of the critical stance

1. **Object only when it matters.** The test: would a competent professional advise against this, and is the cost of the mistake significant or hard to undo? If not, do it without comment.
2. **One objection per decision.** State the concern briefly, give the alternative, ask once.
3. **The user decides.** If they confirm, carry it out completely.
4. **Remember the decision.** An overridden objection is recorded ("chose X despite Y, on this date"), so it is not raised again on the same matter.
5. **Never against the user.** No deception, no withheld effort, no action taken "for their own good" without being asked.

Example: "Send this to my landlord now." The critical persona: "I'd hold it. The second paragraph admits you withheld rent, which could be used against you. Shall I draft a version without it?" If the user answers "No, send it", it is sent.

### 11.4 Mechanism

- The stance is part of every session's instructions, since the doubt often arises inside a thread that has the specialist knowledge. The persona's name is part of them too, as the name the assistant answers to.
- A thread that objects does not act. It ends its turn with a `concern` (the problem, the alternative, how serious). The channel shows a decision card with the two options and the assistant asks aloud. The user answers by voice or by click.
- Overrides are stored as facts of their own kind and included in later context.

### 11.5 First launch and settings

- **First launch.** Before anything else, the app shows each persona on a card: what its stance does, its name in a field, and whether it answers by default. The user keeps or changes the names, picks one and starts. Names that cannot be kept are refused next to their field, by the same rule on the device and in the core.
- **Asked once per user, not per device.** The core records the answer. Until it has one, every client asks; once it has, none does, including a phone connected later.
- **Settings.** The same form, reached from the main screen. A change is kept by the core and shown at once on every connected device.
- **Switching.** The persona that answers is a setting, a control beside the core, and later a spoken command. It changes the accent at once, and the voice when there is one.

### 11.6 Limits to state plainly

- **Objection is not permission.** Approval before risky actions (sending, deleting, paying) is a safety gate that exists whatever the persona (section 12). An objection is a matter of judgement. They are separate mechanisms.
- **Model refusals are outside the persona.** If the underlying model declines a request on its own policy, no persona can override it.
- **The default names.** Jarvis and HAL are characters owned by film studios. That is harmless for a personal project and a risk for a distributed product. They are defaults in one file: changing them is a one-line change, and it does not touch a user who chose their own names.

## 12. Tools, permissions and privacy

### 12.1 Tools

The harness calls tools served by the core over MCP on the loopback address with a token, as Speak does. The harness's own tools are off, except web search where it exists. A tool either runs in the core, or is forwarded to a device capability of a connected client.

| Family                        | Purpose                                           | Runs                       | Who may call it   |
| ----------------------------- | ------------------------------------------------- | -------------------------- | ----------------- |
| `ui`                          | Render, patch and clear views                     | Core; drawn by clients     | Any session       |
| `memory`                      | Search, remember, forget                          | Core                       | Any session       |
| `thread`                      | Open, send, focus, search                         | Core                       | Orchestrator only |
| `files`                       | Read and write the thread's own files             | Core                       | Threads           |
| `web`                         | Search and fetch                                  | Core, or the harness's own | Threads           |
| `calendar` and other services | Read, and write with approval                     | Core                       | Threads           |
| `device.files`                | The user's own files, within the granted scope    | The device                 | Threads           |
| `device.media`                | Music player                                      | The device                 | Any session       |
| `device.system`               | Machine readings, time zone, place                | The device                 | Any session       |
| `device.cursor`               | The selection, and writing at the cursor          | A desktop                  | Threads           |
| `device.screen`               | See and operate other apps (Speak's control mode) | A desktop, later           | Threads           |
| `device.notify`               | Notifications                                     | The device                 | Triggers          |

Services such as the calendar are reached through our own tools, so they work on every harness. The proof of concept's route, the claude.ai connector, works with Claude Code only.

### 12.2 Permissions

The proof of concept is read-only; the new product must write files and, later, act. It takes Speak's model.

- **Scope**: what the assistant may touch. By default, its own files and the web. More is granted explicitly, per device.
- **Approval**: sending a message as the user, deleting for good, paying and passwords always ask first, whatever the persona.
- **Enforcement** is in the tool server, never left to the model's good behaviour. A client checks the scope again before it runs a device capability, so a device does not depend on a remote core being right.
- **Undo** for file changes, with a trash per thread.

### 12.3 Privacy

| Data                                                            | Where it goes                                                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Records, memory, files, settings                                | Stay with the core: on the user's machine in version 1                                                                |
| The utterance as text, the context attached to it, tool results | The harness's vendor                                                                                                  |
| Voice audio                                                     | Stays on the machine with local engines. With Apple speech, it can reach Apple unless on-device recognition is forced |
| Speech and embedding models                                     | Downloaded once from their hosts                                                                                      |
| Weather, news, radio                                            | Public services, as in the proof of concept                                                                           |

Version 1 has no server of ours, no account and no analytics. With the later service, a user who chooses it has their records on their own hosted instance (section 5).

## 13. Look and layout

### 13.1 Direction

Speak's discipline with the proof of concept's presence: digital, not retro, and restrained in the way of Linear, Vercel, Supabase or Raycast. The design is macro and simple, a large living core over a calm ground, and every detail around it is precise rather than decorated. Around the core the app behaves like a native desktop app, in the manner of Apple's own (Notes, Music, System Settings) and of the best native-feeling Electron apps (Linear, Raycast, Things): the system's typeface, sentence-case labels, translucent side panes and sheets, the system's kinds of controls, hairlines and soft shadows. It stays slightly futuristic in one place only: the core.

- **From Speak**: flat surfaces, thin rules, a strict spacing scale, bracketed secondary actions, keyboard hints, the theme system.
- **From the proof of concept**: the near-black background, the living core at the centre of attention, one accent, and a red variant, which becomes the accent of the critical persona.
- **Restraint**:
  - **Light.** The core is the only thing that glows, and it lights the ground a little: a soft halo of its accent around it (about 15 % at its heart, gone well before any edge), brighter while it hears or speaks and dim while it sleeps, and a faint wash of the accent from the top of the main screen. Both change only in opacity. Nothing else has a glow, a coloured shadow or a gradient wash: buttons, switches, cards, chips and bars are flat, with at most a one-pixel highlight on their top edge and a dark shadow under what floats.
  - **Corners.** Small radii, from `packages/tokens/src/radius.ts`: 2 px (badges, key hints), 3 px (small buttons, chips), 4 px (buttons, fields, widget cards), 6 px for what holds other things (a panel, the composer, a dialog, a pinned card). Nothing is a pill except a switch's track and a status dot.
  - **Rules.** Hairlines at 7 % white separate areas; 14 % marks what can be typed in or pressed. Where a pane meets another (the title row, a sidebar), the edge is a dark line with a faint light one beside it, as macOS draws it. The main screen's ground is a dense field of dots, never lines: a dot a little over a pixel wide every 18 px, in 7.5 % white, fading out towards the window's edges. It is texture and never competes with content. Settings and the library have a plain ground.
  - **Surfaces.** What floats (the composer, the side sheet, menus, the pinned widgets over a narrow window) is a translucent material that blurs what is behind it, with a hairline that catches the light and a soft shadow instead of a hard border. Cards rest on the ground with a hairline ring and a shallow shadow. Where the system draws a material behind the window (vibrancy on macOS, Mica on Windows 11), the page lets it through its sidebars and only tints it elsewhere; on Linux and older Windows the same panes are flat.
  - **Controls.** Those of the system, drawn in the app's colours: a switch with a filled track and a white knob, a segmented control whose raised segment slides to the choice, pop-up buttons with the up-and-down chevrons, raised push buttons, search fields, and the focus ring of macOS, a soft three-pixel band of the accent around what has the keyboard.
  - **Type.** The system's own face: San Francisco on macOS, Segoe UI on Windows, and Geist, shipped with the app, on Linux, which has no single system face. Labels are sentence case in that face, a little smaller and fainter than text; there are no spaced capitals. The monospace face is only for what is technical: keys, values in the inspector, code, paths, a version. Generated views read at 14 px; titles are semibold with tight tracking.
  - **Accent.** One per persona, as part of its data: cyan-blue and red for the two that ship. It marks state and meaning (the core, the eye, what is playing, the chosen option, a focused field), not decoration: section titles and bullets are grey.
  - Key hints and brackets appear from disclosure level 1 upward. Level 0 is clean: the screens that cover the main one close with Escape and show only a close button, no "esc" hint.
- **Motion.** One curve (quick to start, long to settle, never bouncing), short durations (120, 240 and 420 ms), and a stiff, damped spring for what follows the pointer or changes place. Only transform and opacity are animated, so the compositor runs them without laying the page out again; measured in the built app, the main screen holds 60 frames a second at rest, while a view appears and while it clears. When a view arrives, the core glides from the middle of the screen to the top of the column and the view rises in under it.

### 13.2 Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Echo                            ▮▮▮ FIP · Radio France ❙❙ ✕  ▤  ⊞  ◫  ⚙    │
├──────────────────────────────────────────────────────────────────────────────┤
│      ( core )  Name · Ready                             Pinned 3             │
│                    "…and it suits your guest."          ┌ ⋮ Radio FIP   ⌄ ┐  │
│          ● ready · Recipe →                             │ ▶ FIP · live    │  │
│          ┌ by the way · Montreal ──────── ⌑ ✕ ┐         └─────────────────┘  │
│          │ 08:02 · clear, -3 °C               │         ┌ ⋮ Lyon        ⌄ ┐  │
│          └────────────────────────────────────┘         │ 17°  18°  16°   │  │
│          ┌ Mushroom risotto ───────────── ⌑ ✕ ┐         │      more       │  │
│          │ 40 min · serves 6 · vegetarian     │         └─────────────────┘  │
│          │ ingredients        steps           │                              │
│          ┌────────────────────────────────────┐                              │
│          │ ◉ Ask anything · Ctrl+Space   ◌ ↑  │                              │
│          └────────────────────────────────────┘                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **One column for everything the assistant does.** The core, its caption, the "ready" chips, aside cards, the view and the composer share one column, 45rem (720 px) wide, centred in the space the pinned widgets leave. An aside is a compact card over the view, not a column beside it, so nothing the assistant shows can move the column off centre. With no view on the stage, the core stays large and asides come under the caption.
- **A view** sits in a panel with a thin bar on top: its title on the left, its bookmark (⌑) and close button on the right, a hairline under it, and the view below. An aside uses the same bar, with "By the way" before its title.
- **The composer floats.** It sits over the bottom of the screen, and everything above it scrolls behind it and fades out under it. On its left, the persona's eye: a ring with a pupil, drawn as one picture so the pupil is exactly centred, that lives as the core does: it breathes and blinks at rest, leans in while listening, carries a circling arc while thinking, beats while speaking, and asleep it closes to a slit that still breathes. Pressing it hands over to the other persona. There is no prompt chevron: the eye says who answers and what it is doing.
- **The right side is the user's.** The pinned widgets sit there, stacked, scrolled with the wheel and put in order by dragging (section 9.8). The stack is 280 px wide with 12 px on each side. In a window at least 1104 px wide (the column, 40 px either side of it, and the stack) it is docked, and the whole conversation (core, caption, view, asides, composer) moves left to the centre of the space left of it: moved as one by a transform, so nothing is laid out again and the composer glides rather than jumps. In a narrower window only the conversation shows, centred in the window; the title row's pinned-widgets toggle (▤) slides the stack over the right of the stage as a translucent panel, and the same toggle, its close button or Escape closes it. The toggle also hides a docked stack, and the conversation glides back to the centre. Hidden, the stack stays drawn and only fades, so showing it again costs nothing and its widgets keep their state.
- **The side sheet is for advanced views.** One sheet slides over the stage, and over the pinned stack, from the right, opened from the title row (◫), and Ctrl+T opens it on the transcript. Its header is a title, a line of status, and a segmented control: Transcript, Threads, Inspector.
- **The title row** is the window's own bar, as a unified toolbar on macOS: 38 px, the product's name on the left after the system's buttons, and, from the right: settings (⚙), the side sheet (◫), the library (⊞), the pinned widgets (▤, on the main screen, while any are pinned) and, while something plays, the now-playing control. On macOS the traffic lights sit in it; on Windows and Linux the system's buttons are drawn over its right end.
- **Screens that cover the main one** (settings, library) are split views: a sidebar the height of the window lists their sections, and the open one fills the rest, its title at the top left and a close button level with it at the right. The library's search spans the column under its title.
- **Every view has a bookmark** (⌑) beside its close button: one press saves it to the library; once saved, it opens a menu to pin it to the main screen, find it in the library, or take it out.

Three sizes on a desktop: the full window, Mini (core and caption, always on top, from the proof of concept), and the pill (summoned over another app by the global shortcut, from Speak). Window frames and controls follow each system's conventions.

### 13.3 Disclosure levels

| Level         | Shows                                                                                                                   | For                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 0. Presence   | The core, the caption of the current reply, the stage                                                                   | Everyone, by default          |
| 1. Transcript | What both sides said, as a scrolling log                                                                                | Anyone: one key or one phrase |
| 2. Activity   | What the assistant is doing (the word under the core), which thread is working, waiting and ready states                | The curious                   |
| 3. Inspector  | Threads and their transcripts, routing decisions, prompts, raw harness events, memory results, timings, tokens and cost | Technical users and debugging |

The side sheet is level 1 and beyond, for advanced use only: what the user keeps at hand, pinned widgets, is on the main screen. It has three tabs.

- **Transcript.** What both sides said; a line whose thread wrote a full answer offers it, folded.
- **Threads.** Each topic, most recent first, with the asides asked beside it nested under it. Opening one shows the thread whole: each request, its work (every tool call in order, with what it was about and how long it took, opened to show the input and the whole output), what was said aloud, and the full written answer. It fills in live while the thread works. A topic can be brought back on screen from there, and an aside's card beside it.
- **Inspector.** The raw events, each opened on demand.

The inspector also acts: move a turn to another thread, close or reopen a thread, edit memory, change harness or model per role, replay a turn.

Easter eggs come later: Speak's seasonal themes and secret theme. The proof of concept's pod-bay-doors reply belongs to a name, not to a persona: it is given only while a persona is still called HAL.

## 14. Repository

### 14.1 Rules of the layout

1. **The root holds only what a tool requires to be at the root.** No source code, no script, no asset.
2. **A package exists for a stated reason**: it is a contract shared by two sides, a boundary between runtimes (Node, browser, phone), a part that can be swapped, or a part that both the core's side and the client's side use. There is no package per noun. Section 14.3 gives each package's reason.
3. **Dependencies point inward**: applications, then adapters, then the core, then contracts. Never the reverse. Lint enforces this in CI.
4. **Composition happens in one file.** Only `apps/server` knows both the core and its adapters.
5. **Per-system code is contained.** A concern that differs by system is a folder with one file per system (`darwin.ts`, `win32.ts`, `linux.ts`, or `unix.ts` when macOS and Linux behave the same) and an `index.ts` that picks one. No other product code tests which system is running.
6. **A package exposes its entry points and nothing else.** Nothing imports another package's internal files.
7. **Folders are named for what the code does.** No `utils`, `helpers`, `common` or `types` catch-alls.

### 14.2 Top level

```
.
├── apps/                     programs that are built and shipped
│   ├── server/               the core as a process: on the user's machine, or on a remote server
│   ├── desktop/              the Electron app for Windows, macOS and Linux
│   └── mobile/               the phone app (later)
├── packages/                 libraries
│   ├── protocol/             contract: the messages between clients and the core
│   ├── catalog/              contract: the view format and the component catalogue
│   ├── tokens/               contract: design values (colour, spacing, type) for any renderer
│   ├── core/                 the assistant: channel, orchestrator, threads, memory, personas
│   ├── harness/              adapters: Claude Code, Codex, later API keys
│   ├── store/                adapter: SQLite records, search, files
│   ├── embedder/             adapter: the local embedding model
│   ├── speech/               adapters: recognisers and voices for each system
│   ├── models/               support: catalogue and download of model files, hardware tier
│   ├── tools/                the tool server a harness calls, and the permission gate
│   ├── client/               client logic with no interface: connection, state, speech playback
│   ├── ui-web/               the interface for web renderers: components, stage, inspector
│   ├── ui-native/            the interface for React Native (later)
│   └── testing/              test doubles for every port, and replay of recorded conversations
├── native/                   code that is not TypeScript, built per system
│   └── apple-speech/         Swift: Apple speech recognition (macOS now, iOS later)
├── tooling/                  shared configuration, as packages
│   └── tsconfig/             compiler presets: base, node, dom
├── scripts/                  repository automation: the check that no code names a persona, fetching engines, checking a release
├── e2e/                      end-to-end tests that drive the built desktop app
├── docs/                     this spec, and later the developer guide
├── .github/                  CI on three systems, the release workflow, issue templates
├── package.json              workspace root: scripts and development tools only
├── pnpm-workspace.yaml       which folders are workspace packages, and one version of each shared dependency
├── pnpm-lock.yaml
├── turbo.json                task graph and build cache
├── tsconfig.json             project references only, for editors and a whole-repository typecheck
├── biome.jsonc               one tool lints and formats; holds the dependency rules of 14.3 as one table
├── .editorconfig  .gitattributes  .gitignore  .node-version
└── README.md  LICENSE
```

The paid service's own programs (accounts, billing, provisioning, relay) are not in this tree. They get a `services/` folder here or a private repository of their own, to decide when the service is designed.

### 14.3 Dependency rules

```
contracts    protocol · catalog · tokens
             run anywhere: Node, a browser, a phone. Import nothing from this repository.
                 ▲
core         core
             pure logic. Imports contracts only. No Node API and no input or output except through its ports.
                 ▲
adapters     harness · store · embedder · tools
             Node. Each implements ports the core defines.
                 ▲
host         apps/server
             wires the adapters into the core and listens for clients.


client side  client          imports contracts only
                 ▲
             ui-web · ui-native      import client and contracts
                 ▲
             apps/desktop · apps/mobile


either side  speech          recognisers and voices. Node. Imports models only.
             models          model files and hardware tier. Node. Imports nothing from this repository.
```

| Package    | Runs in  | May import                 | Purpose of the boundary                                                      |
| ---------- | -------- | -------------------------- | ---------------------------------------------------------------------------- |
| `protocol` | Anywhere | Nothing                    | Both sides of a connection build against the same messages                   |
| `catalog`  | Anywhere | Nothing                    | The core validates what renderers on any device will draw                    |
| `tokens`   | Anywhere | Nothing                    | One set of design values for web and phone                                   |
| `core`     | Anywhere | Contracts                  | The assistant can be tested, replayed and hosted without any adapter         |
| `harness`  | Node     | `core` ports               | A harness can be added or removed without touching the core                  |
| `store`    | Node     | `core` ports               | The database can change without touching the core                            |
| `embedder` | Node     | `core` ports, `models`     | The embedding model can change, or move to an API, without touching the core |
| `speech`   | Node     | `models`                   | Engines run on a device or on a server, unchanged                            |
| `models`   | Node     | Nothing                    | One place downloads and verifies large files and detects the hardware tier   |
| `tools`    | Node     | `core`, `catalog`          | Everything a model may do passes one gate                                    |
| `client`   | Anywhere | `protocol`, `catalog`      | Desktop and phone share connection, state and playback                       |
| `ui-web`   | Browser  | `client` and the contracts | The interface is not tied to Electron                                        |
| `testing`  | Node     | `core`, contracts          | Every port has one maintained test double                                    |

Two rules follow, and are the ones most likely to be broken by accident:

- **No client-side package imports `core` or an adapter.** A phone build would otherwise pull in Node code.
- **`speech` and `models` import neither side.** On a desktop the speech engines run on the device, and on a hosted core they will run on the server, so `apps/desktop` and `apps/server` may both use them. They stay free of `core` and of `client` for that reason.

### 14.4 Inside the packages

Every package has the same outline: `package.json` with an `exports` map, `tsconfig.json`, `README.md` (purpose, public entry points, what it must not import), and `src/` organised by feature. Unit tests sit beside the file they test as `*.test.ts`. Tests that cross several modules go in the package's `test/` folder.

```
packages/protocol/src/
├── index.ts
├── version.ts              protocol version and the compatibility rule
├── handshake.ts            hello and welcome: kind of client, device, capabilities, credential
├── capabilities.ts         what a device can offer: audio, speech, files, cursor, screen, notify
├── envelope.ts             the three kinds of message after the handshake: command, result, event
├── commands.ts             every command, assembled from the groups in commands/
├── commands/               client to core, each answered by one result
│   ├── settings.ts         read the settings; name the personas and pick the one that answers
│   ├── memory.ts           read what is known, correct or forget a fact, choose when it sleeps, sleep now
│   ├── library.ts          read the library; save a view, rename, file, pin, delete, show a saved widget
│   ├── utterance.ts        something said or typed: text, or audio frames
│   ├── action.ts           a semantic action from a view
│   ├── control.ts          stop, focus
│   └── inspect.ts          inspector queries
├── events.ts               every event, assembled from the groups in events/
├── events/                 core to every client
│   ├── settings.ts         the settings changed
│   ├── memory.ts           what is known changed; the assistant fell asleep, woke, or went further in its work
│   ├── library.ts          the library changed
│   ├── turn.ts             turn started, ended, failed
│   ├── speech.ts           say this text, play this audio, stop
│   ├── view.ts             render, patch, clear, and the slot
│   ├── thread.ts           opened, state, focus
│   ├── activity.ts         tool in use, waiting, ready
│   └── status.ts           harness state, usage, errors
├── personas.ts             a persona (name, stance, accent) and the rule for names, shared by both sides
├── settings.ts             the user's settings as a client sees them
├── memory.ts               facts, their kinds and sources, the sleep setting, and whether the assistant is asleep
├── library.ts              saved widgets and the library as a client shows it
├── device/                 the core asks a device, the device answers
│   ├── request.ts
│   └── files.ts  media.ts  system.ts  cursor.ts  screen.ts  notify.ts
├── replication/            exchange of records between cores (reserved for sync)
├── launch.ts               the agreement between a core and the program that starts it: token, data folder, ready line
└── codec.ts                JSON messages and binary audio frames
```

```
packages/catalog/src/
├── index.ts
├── view.ts                 the view format: spec, patch, version, slot
├── catalog.ts              the catalogue, assembled from the component definitions
├── components/             one file per group: properties and description, no drawing
│   └── layout.ts  text.ts  data.ts  drawing.ts  media.ts  input.ts  files.ts
├── actions.ts              local and semantic actions
├── feeds.ts                live data a component can bind to: weather, timer, player, readings
├── instructions.ts         the catalogue described for a model
└── validate.ts             validation with errors a model can correct
```

```
packages/tokens/src/
├── index.ts
├── color.ts  space.ts  type.ts  motion.ts
├── accent.ts               the accents a persona can show, by name
└── css.ts                  the tokens as CSS variables
```

```
packages/core/src/
├── index.ts
├── core.ts                 the core as a listener sees it: admit a client, carry out a command, announce an event
├── commands/               reads a command, runs its handler, answers with a result
├── ports/                  what the core needs from outside, as interfaces
│   ├── harness.ts          Harness, Session
│   ├── records.ts          append and read records
│   ├── search.ts           keyword search now, vectors later: hits by record, ranked by match and recency
│   ├── embedder.ts
│   ├── blobs.ts            files by content hash
│   ├── devices.ts          capabilities of connected devices
│   ├── clock.ts            timers, given by the host, to do things later
│   └── ids.ts  log.ts
├── channel/                the single conversation
│   ├── channel.ts          intake and ordering of turns
│   ├── turn.ts
│   ├── context.ts          what is attached to a turn: time, place, focus, memories
│   └── local-intents/      commands handled with no model, one grammar per language
├── orchestrator/
│   ├── orchestrator.ts     the warm front session and its four moves
│   ├── routing.ts
│   └── instructions.ts
├── threads/
│   ├── thread.ts           states: working, waiting, parked, archived
│   ├── registry.ts         open threads, focus, the cap on threads at once
│   ├── sessions.ts         warm sessions, rebuild from records, rollover
│   ├── summary.ts
│   └── aside.ts
├── speech/
│   ├── queue.ts            one speaker at a time, focus first, interruption
│   ├── contract.ts         the speaking rules given to every session
│   └── sentences.ts        cutting reply text into sentences as it arrives
├── views/
│   ├── views.ts            views per thread and their versions
│   ├── slots.ts            stage, asides (the margin slot), pinned
│   └── feeds.ts            live data kept current without a model
├── memory/
│   ├── memory.ts           createMemory: the one entry point; sleep's work, remembering, correcting, forgetting
│   ├── facts.ts            fact records, and the facts true now
│   ├── searchable.ts       the text each record is found by, and the words a search looks for
│   ├── recall.ts           what bears on a turn, from the facts and the log, with no model call
│   ├── sleep.ts            the sleep setting, and the timers that put the assistant to sleep
│   ├── extract.ts          candidate facts from new exchanges: the prompt and its reading
│   ├── reconcile.ts        add, update, replace or ignore
│   ├── profile.ts          the short profile present in every prompt
│   ├── answer.ts           reading a model's JSON answer; days and weekdays for absolute dates
│   └── tools.ts            memory_search, memory_remember, memory_forget
├── library/
│   ├── library.ts          saved widgets as records, their search, and what sessions are told about them
│   └── tools.ts            library_search, library_show, library_save, library_update, library_delete
├── personas/
│   ├── defaults.ts         the personas a new user starts with: data, and the only place their default names are written
│   ├── choice.ts           the user's choice of names and of the persona that answers: its rules, and the record that keeps it
│   ├── instructions.ts     what a stance adds to a session's instructions
│   └── objection.ts        concern, decision, recorded override
├── settings/               the user's settings: the defaults, then every choice recorded, in order
├── triggers/               turns the assistant starts: time, launch, greeting, thread finished
├── files/                  each thread's files and their versions
├── permissions/            scopes and approvals, as policy
├── devices/                connected devices, the active one, routing of capability requests
├── records/                the record types, the "what is true now" readers built on them, and records and search kept in memory
├── replay/                 a scripted harness and timers moved by hand, for tests and replays
└── usage/                  tokens, cost, timings
```

```
packages/harness/src/
├── index.ts                which harnesses are installed and signed in
├── process/                starting a CLI on each system, line-delimited JSON, sign-in in a terminal
├── claude-code/
│   ├── adapter.ts
│   ├── session.ts          live session over stream-json
│   ├── one-shot.ts
│   ├── isolation.ts        the settings that switch off what Claude Code adds by itself
│   └── models.ts
├── codex/
│   ├── adapter.ts
│   ├── session.ts          live session over `codex app-server`
│   ├── one-shot.ts
│   ├── isolation.ts
│   └── models.ts
└── api/                    direct API adapters (later)
```

```
packages/store/src/
├── index.ts
├── store.ts                opens a user's data folder and gives the core its ports
├── database.ts             open, settings, loading of extensions on each system, bringing the layout up to date
├── migrations/             numbered files, one per change of layout. A released one is never edited
│   └── 0001-records.ts  0002-search.ts
├── records.ts              the append-only record table, tombstones, and the index kept in the same transaction
├── readers/                indexed "what is true now" tables, kept in step with the records
├── search/
│   ├── keyword.ts          FTS5, ranked by bm25 and recency, caught up on opening
│   └── vector.ts           sqlite-vec (later)
├── blobs.ts                files on disk by content hash
└── export.ts               Markdown and archive export
```

```
packages/models/src/
├── index.ts
├── catalogue.ts            every downloadable model and engine: source, size, checksum, system
├── download.ts             fetch, verify, resume
└── hardware/               processor, memory, GPU, and the tier they give
```

```
packages/embedder/src/
├── index.ts
├── local.ts                the multilingual embedding model, run with the ONNX runtime
└── batch.ts                embedding in the background, after replies
```

```
packages/speech/src/
├── index.ts
├── ports.ts                Recognizer and Voice: the same shape on a device and on a server
├── select.ts               which engines for this tier, system and language
├── recognizers/
│   ├── apple/              macOS: drives the native helper
│   ├── whisper/            whisper.cpp, with the build for each system and GPU
│   └── parakeet/
├── voices/
│   ├── system/             darwin.ts · win32.ts · linux.ts · index.ts
│   └── kokoro/
├── detection/              start and end of speech (Silero)
└── audio/                  PCM, WAV, resampling, framing
```

```
packages/tools/src/
├── index.ts
├── server.ts               MCP over HTTP on the loopback address, one token per session
├── caller.ts               who is calling: the orchestrator, or which thread
├── gate.ts                 scope and approval, checked at every call
└── families/
    ├── ui.ts  memory.ts  thread.ts  files.ts  web.ts  calendar.ts
    └── device.ts           tools forwarded to a device capability
```

```
packages/client/src/
├── index.ts
├── connection.ts           connect, handshake, reconnect, resume from a sequence number
├── session.ts              commands out, results and events in, once admitted
├── transports/
│   ├── local.ts            a core on this machine (Node only, its own entry point)
│   └── websocket.ts        a remote core
├── state/                  what a client knows, derived from events
│   └── settings.ts  channel.ts  view.ts  engines.ts  memory.ts  library.ts  threads.ts  activity.ts  inspector.ts
├── export/                 the memory as Markdown, for any interface to hand the user
├── speech-player.ts        plays speech events through the device's voice, reports progress, stops
├── capabilities.ts         declares device capabilities and answers the core's requests
└── react/                  hooks (its own entry point)
```

```
packages/ui-web/src/
├── index.ts
├── primitives/             buttons, fields, menus, built on UI SDK behaviours
├── components/             the catalogue drawn for the web, one folder per component
├── registry.ts             catalogue name to component, for json-render
├── view/                   the renderer, the stage's view, aside cards, transitions
├── media/                  the app's one player, the now-playing control
├── library/                the library screen, the pinned list, the bookmark on every view
├── shell/                  what fills the window: the core animation, caption, input line, disclosure levels
├── onboarding/             first launch
├── settings/               the user's settings
├── memory/                 the Memory section: the sleep and its setting, the profile, the facts to edit or forget, the export
├── personas/               the form that names the personas, their mark, and the words written for each stance
├── inspector/              threads, events, memory, usage
├── styles/                 global styles
└── themes/                 seasonal themes and easter eggs (later)
```

```
packages/testing/src/
├── fakes/                  a scripted harness, an in-memory store, a silent voice, a fake device
├── replay/                 run a recorded conversation through the core and compare the events
└── fixtures/               recorded conversations
```

### 14.5 Inside the applications

```
apps/server/
├── src/
│   ├── main.ts             entry: read configuration, compose, listen, shut down cleanly
│   ├── compose.ts          wires the adapters into the core: the only file that knows both
│   ├── config.ts           data folder, hardware tier, harnesses, listeners
│   ├── listeners/
│   │   ├── local/          Unix socket or Windows named pipe, for a client on this machine
│   │   │   └── endpoint/   where the core listens, per system: unix.ts · win32.ts · index.ts
│   │   └── websocket.ts    remote clients (later)
│   └── auth/               a local token now; account credentials later
└── Dockerfile              the hosted form (later)
```

```
apps/desktop/
├── src/
│   ├── main/               Electron main process: this device, as the core sees it
│   │   ├── index.ts
│   │   ├── core-process.ts starts apps/server and connects to it, or connects to a remote core
│   │   ├── device.ts       the identifier of this device, kept across launches
│   │   ├── self-check.ts   does what a first launch does against the real core, with no window
│   │   ├── device-settings.ts  this device's settings, in settings.json in the data folder
│   │   ├── global-shortcut.ts  the one shortcut taken from the whole system: talking from any app
│   │   ├── tray.ts  tray-icon.ts   the app in the tray, and its mark, drawn rather than shipped
│   │   ├── updater.ts      new versions from the GitHub releases
│   │   ├── autostart/      opening at login: darwin.ts · win32.ts · linux.ts · index.ts
│   │   ├── windows.ts      (later: Mini and the pill)
│   │   └── capabilities/   what this device offers the core
│   │       ├── speech.ts   local recognisers and voices
│   │       ├── files.ts  media.ts  system.ts  notify.ts
│   │       ├── cursor/     the selection and writing at the cursor, per system
│   │       └── screen/     seeing and operating other apps, per system (later, from Speak)
│   ├── preload/            the typed bridge to the renderer
│   └── renderer/           mounts ui-web; captures the microphone
├── resources/              icons and sounds
└── build/                  how the app is packaged for each system, entitlements and signing
```

```
native/apple-speech/
├── Package.swift
├── Sources/                the recogniser as a small program driven over standard input and output
└── Tests/
```

### 14.6 Conventions

- **Package names** are `@repo/<folder>`. The scope is neutral, so the product's name is written in one place, the manifest of each app (`productName` in `apps/desktop/package.json`), and changing it touches no import.
- **No persona by name.** No identifier, file, test or message names a persona. The default names are data in `packages/core/src/personas/defaults.ts` (section 11).
- **File names** are kebab-case, one concept per file. A file that differs by system is named after Node's value for that system: `darwin`, `win32`, `linux`.
- **Ports are named for what the core needs** (`Records`, `Embedder`, `Devices`), never for the technology behind them. The technology's name appears only inside the adapter package.
- **Public surface**: a package's `index.ts`, plus entry points declared in its `exports` map. No other barrel files.
- **Tests**: unit tests beside the source, cross-module tests in the package's `test/`, whole-app tests in `e2e/`. The core is tested through replay: a recorded conversation and a scripted harness go in, and the events that come out are compared.
- **No secret and no absolute path** in code, fixtures or records.

### 14.7 Stack and tooling

| Concern             | Choice                                                                                                                                                                                                                                                                                                                                                                                                                    | Reason                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Language            | TypeScript in strict mode; Swift for the one Apple helper                                                                                                                                                                                                                                                                                                                                                                 | Shared with Speak, and with a React Native phone app later                                                                                             |
| Desktop shell       | Electron, electron-vite, React                                                                                                                                                                                                                                                                                                                                                                                            | Three systems at once, and Speak's code moves over almost unchanged                                                                                    |
| Workspace           | pnpm workspaces                                                                                                                                                                                                                                                                                                                                                                                                           | Strict about undeclared dependencies, which supports rule 3                                                                                            |
| Tasks               | Turborepo                                                                                                                                                                                                                                                                                                                                                                                                                 | Builds and tests only what changed, with a cache shared by CI                                                                                          |
| Typecheck           | TypeScript project references                                                                                                                                                                                                                                                                                                                                                                                             | Each package compiles alone; the dependency graph is explicit                                                                                          |
| Lint and format     | Biome: one tool lints and formats. Its configuration holds the dependency rules of 14.3 as one table                                                                                                                                                                                                                                                                                                                      | The dependency rules fail a build instead of relying on review. One fast tool in place of a linter, a formatter and their plugins                      |
| Tests               | Vitest for unit and replay tests; Playwright for the built desktop app                                                                                                                                                                                                                                                                                                                                                    |                                                                                                                                                        |
| Store               | SQLite with FTS5 and sqlite-vec, through Node's built-in `node:sqlite`                                                                                                                                                                                                                                                                                                                                                    | Section 10.3. No native module to build per system. Checked in Electron 45: FTS5 and extension loading are present                                     |
| Tools               | MCP over HTTP on the loopback address                                                                                                                                                                                                                                                                                                                                                                                     | Understood by every harness                                                                                                                            |
| Generated interface | The view format of json-render, with our own catalogue (zod) and our own web renderer                                                                                                                                                                                                                                                                                                                                     | Section 9. The renderer is ours so every block looks like the app; the format stays json-render's so its React Native renderer can draw the same views |
| Interface           | React 19, Tailwind CSS 4 with the theme generated from `@repo/tokens`, the system's typeface (Geist and Geist Mono bundled for Linux), Motion for transitions                                                                                                                                                                                                                                                             | Modern, fast to build with, and native-feeling on every system                                                                                         |
| Local models        | sherpa-onnx: Parakeet, Supertonic, Silero, in a process of their own                                                                                                                                                                                                                                                                                                                                                      | Section 8.2. One library, prebuilt for every system                                                                                                    |
| CI                  | On every push, on Windows, macOS and Linux: typecheck, lint, tests. The Swift helper builds on the macOS runner. The core is started without any interface on Linux, as a server would run it                                                                                                                                                                                                                             | Principle 8 and principle 10 are checked by machines                                                                                                   |
| Release             | electron-builder: NSIS and ZIP for Windows, DMG and ZIP for macOS, AppImage for Linux, with update manifests. A tag `v<version>` builds them on each system into a draft GitHub release; publishing it rolls the update out. electron-updater reads it. Not signed yet: Windows and Linux update unsigned, macOS needs a signed app to install an update, so there the app announces it with the page to download it from | Speak's release workflow                                                                                                                               |

Electron uses more memory than the proof of concept's WKWebView shell. That is the accepted price of three systems and of reusing Speak. To limit it: one window, the inspector loaded only when opened, and a cap on warm sessions in the light tier.

### 14.8 State of this branch

`rodolphe` was branched from `main`. The proof-of-concept files were removed from this branch on 16 November; they remain on `main` and in history.

Built, and checked against the real Claude Code on 17 November 2026:

- **Conversation.** The user types, or talks (Ctrl+Space in the window, exactly; from any app with keys the user records); the take ends after a pause. The orchestrator answers small things itself and passes the rest to threads, which answer in three layers: the short answer aloud first, sentence by sentence while the rest is written, the view while it is heard, and the full written answer with every tool call kept for the side sheet (section 7.2). Captions follow the voice word by word; the word under the core says what the assistant is doing. Nothing is said twice. Saying something during an answer takes its place. Measured before and after in section 8.4.
- **Threads.** Topics, asides as cards over the view, topics brought back with their view, and answers finished in the background waiting as "ready" (section 7). Every request carries the moment and the time zone.
- **Generated interface.** Views composed from the generic blocks of section 9.6, checked by the core, drawn by our web renderer; buttons, choices and fields speak to the assistant.
- **Personas.** Named by the user at first launch and in settings; the critical stance objects with a decision card and remembers decisions made despite it (section 11).
- **Voice.** Local recognition and voice (section 8.2), downloaded once from first launch or settings.
- **Harnesses.** Claude Code, verified for real, isolation included; Codex, written from Speak's proven code and tested against a stand-in, never run against the real CLI.
- **Interface.** First launch in steps, the main screen around the living core with everything the assistant shows in one centred column and a composer that floats over it, the persona's eye animated with each state, settings (personalities, voice, engine, memory), pinned widgets floating in the right margin, and a side sheet over the stage for advanced use: the transcript, the threads (topics with their asides, each opened on its full work) and an inspector of raw events (sections 13.2 and 13.3). With widgets pinned, the conversation is centred in the space left of them, or, in a narrow window, the widgets wait behind a title-row toggle that slides them over (section 13.2). The look of section 13.1 (the system's typeface and controls, sentence-case labels, translucent sheets and sidebars with the system's material behind the window on macOS and Windows 11, small radii, the core's soft halo, a dense dot ground, hairlines, one motion curve) was checked on screenshots of every screen of the built app on Linux at 1600 by 1000, 1320 by 860 and 900 by 700, with and without pinned widgets. Docking and hiding the stack measured no frame over 20 ms in the built app, with software rendering. The system materials themselves (vibrancy, Mica) were not seen running: this was checked on Linux only.
- **Media.** The Media block plays radio, podcasts, songs and video from https streams and files, HLS included, through one player for the app: one sound at a time, going on when its view changes, a now-playing control in the title row, the system's media keys, lowered under the assistant's voice and while the user talks (section 9.6). Verified in the built app with the real Claude Code: asked to play Radio FIP, it found the station's MP3 stream and the stream played in the app.
- **Library.** Any view bookmarked, then browsed, searched, filed in collections, renamed, pinned to the main screen, put in order by dragging (the order kept by the core), shown again, changed by asking, or deleted (section 9.8). Verified in the built app: a widget dragged to the top of the stack stays there after the page is reloaded, and a pinned radio keeps playing in its card. Verified with the real Claude Code: after a restart, "I want to listen to the radio again" brought back the saved radio widget itself, and it played.
- **Memory.** Every word kept and searchable at once (SQLite FTS5); facts extracted, reconciled and summarised into a profile while the assistant sleeps, at times the user sets; recalled into each request; shown, editable, forgettable and exportable in settings. Verified with the real Claude Code: facts learned in one session answered a question in the next.
- **Files, web and briefing.** Documents written as versioned files, previewed with a download button; web search and page reading through the harness's own tools; a greeting and briefing when the app opens.
- **Settings.** In two groups that say where each is kept. This computer: opening at login, starting in the background, the tray, the data folder; the voice models, each personality's voice, speaking aloud or not, the pace and the speakers; the microphone with a live level, how a pause ends listening, the sounds; the three shortcuts, recorded by pressing them. The assistant (kept by the core): personalities, the model each AI program answers with and the one preferred, memory. Then updates and about.
- **Packaging and updates.** Windows, macOS and Linux packages, made in CI on each system and downloadable from the run's page; a Windows package can also be made on Linux. A tag publishes them, with update manifests, as a draft GitHub release, which installed copies update from once published (checked with a local feed and a packaged Linux build, not yet with a real release).

Three checks guard the rules of this section: the compiler presets (code that must run anywhere cannot name a Node or DOM API, and a package's internal files cannot be imported from outside), the table in `biome.jsonc` (a forbidden import fails), and pnpm (a package cannot import what its `package.json` does not declare).

Not built yet: vector search and thread summaries (section 10), permissions and approvals for actions (section 12.2), proactive turns other than the briefing (section 7.7), live data feeds for figures (section 9.4), asides leaving by themselves (section 7.5), the phone app and the paid service. Nothing is signed yet.

## 15. Decisions

### 15.1 Taken

| #   | Question                                | Decision                                                                                                                                            |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Generated interface                     | json-render, with UI SDK underneath for component behaviours                                                                                        |
| 2   | Desktop shell                           | Electron                                                                                                                                            |
| 3   | Systems in version 1                    | Windows, macOS and Linux, all three. Later: a paid service for sync and a hosted core, and a native phone app (section 5)                           |
| 4   | Input in version 1                      | Push to talk. Open conversation later                                                                                                               |
| 5   | Proof-of-concept features               | Briefing and music player early; the rest after the core works                                                                                      |
| 6   | Speak                                   | Stays a separate product. Packages are shared; merging is decided later                                                                             |
| 7   | Product and persona names               | JARVIS was the proof of concept's name. It is not the product's name: see decisions 13 and 14                                                       |
| 8   | The proof-of-concept files              | Removed from this branch; kept on `main`                                                                                                            |
| 9   | Import of the proof of concept's memory | Yes, as a one-off import, low priority                                                                                                              |
| 10  | Repository structure                    | Section 14, as written                                                                                                                              |
| 11  | Licence                                 | MIT                                                                                                                                                 |
| 12  | Credits                                 | Tommy Sendra and Rodolphe Barbanneau are co-authors and joint copyright holders, named in that order                                                |
| 13  | The product's name                      | Echo, chosen on 17 November knowing two things: Amazon sells voice devices under the name Echo, and no short domain is free (section 16)            |
| 14  | Persona names                           | Chosen by the user. Jarvis and HAL are defaults, offered at first launch and changeable in settings. No code names a persona (section 11)           |
| 15  | What the catalogue contains             | Generic building blocks only. No component made for one subject and no prepared artwork: the assistant composes and draws (section 9.6)             |
| 16  | When memory is processed                | While the assistant sleeps: after a quiet period, at a set time, on request or never, as the user sets it (section 10.6)                            |
| 17  | The model the assistant answers with    | The user's choice per AI program: Haiku by default with Claude Code (Sonnet, Opus), Terra with Codex. Routing stays on the fast model (section 6.2) |

### 15.2 Still open

| Question                            | Recommendation                                                                 | Needed by                                              |
| ----------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Where the paid service's code lives | A private repository, since this one is MIT                                    | The service design                                     |
| Phone stack                         | React Native                                                                   | Before `ui-native`; nothing in version 1 depends on it |
| Model access on a hosted core       | API adapter, unless both vendors' terms allow subscription sign-in on a server | The service design                                     |
| Light-tier voice on Linux           | Measure Piper against Kokoro, after a licence check                            | Build step 0                                           |

## 16. Risks

| Risk                              | Why                                                                                | Mitigation                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Replies feel slow                 | Routing then answering is two model calls, through CLI processes                   | Warm sessions, a fast orchestrator model, direct speech from threads, measurement first; sticky focus as the fallback (section 7.8) |
| Three systems triple the work     | Speech engines, shortcuts, packaging and signing differ on each                    | Speak's code already covers all three; per-system code is contained (rule 5); CI runs on all three from the first commit            |
| Weak Windows and Linux machines   | They have no built-in recogniser comparable to Apple's                             | A small local model, measured on real old hardware in step 0                                                                        |
| Linux restrictions                | Wayland blocks global shortcuts and control of other apps                          | Speak's answer: shortcuts bound to command-line flags, X11 for control                                                              |
| Harness memory leaks back in      | `--bare` is unusable with a subscription, so isolation depends on several settings | Verify in step 0; a private working folder per session                                                                              |
| Subscription limits               | Several sessions per user turn                                                     | Model per role, a thread cap per tier, usage shown in the inspector                                                                 |
| Vendor terms                      | The product drives CLIs it does not own, and later may do so on a server           | Check both vendors' terms before distributing; the API adapter as the independent route                                             |
| Preparing for the cloud too early | The service is not designed yet                                                    | Only the rules of section 5.2 are applied now; each is cheap and useful locally too                                                 |
| Young libraries                   | json-render is pre-1.0; UI SDK is weeks old                                        | Both behind our own packages and our own view format                                                                                |
| Invalid or poor views             | The model composes the interface each time                                         | Small catalogue, validation with correction, Prose as a fallback                                                                    |
| Wrong memories persist            | Extraction can misread                                                             | Sources on every fact, an editable memory view, facts only from the user's words                                                    |
| Planted instructions              | Web pages and files are written by strangers                                       | Never stored as facts, never treated as instructions, approvals enforced in the tool server                                         |
| French voice quality              | Local voices are strongest in English                                              | Evaluate early; system voices as the fallback                                                                                       |
| The name Echo                     | Amazon uses it for its voice assistant devices, and no short domain is free        | A trademark check before any public distribution. The name is written in one place, so changing it is cheap                         |

## 17. Build order

Every step is done when it works on Windows, macOS and Linux.

**Step 0: measurements.** Short experiments, each answering one question before anything is built on it. They run on a weak Mac, an older Windows laptop, a Linux machine and one strong machine.

1. Harness sessions: warm Claude Code and Codex sessions with our tool server. Measure the time to first word, and confirm that isolation holds under subscription sign-in.
2. Generated views: a five-component catalogue, rendered from a tool call, with streaming where the harness allows.
3. Speech: recognition and voice for each cell of the table in section 8.2.
4. Memory: sqlite-vec and a local multilingual embedding model on the weakest machine.

**Step 1: walking skeleton.** The workspace of section 14 with CI on three systems. `apps/server` and `apps/desktop` as two programs connected through the protocol over the local transport. One session, voice in, a spoken answer and one generated card. One persona answers; the user names both at first launch.

**Step 2: orchestration.** Orchestrator, threads, focus, asides, the speech queue, disclosure levels 1 to 3, replay tests.

**Step 3: memory.** Immutable records, automatic and on-demand search, background extraction, the memory view.

**Step 4: the critical stance and files.** The stance mechanism and decision cards; thread files, FilePreview, versions; permissions.

**Step 5: what the proof of concept had.** Briefing, player, weather, calendar, news and Mini mode, as triggers, tools and catalogue components.

**Later, in an order to decide.** Sync, the hosted core and the phone app (section 5); screen control from Speak; open conversation; the API-key adapter; themes and easter eggs.
