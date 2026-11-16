# JARVIS: product and architecture spec

Draft 0.2, 16 November 2026, on branch `rodolphe`.
Sections 2 and 3 describe what exists today. Everything else is a proposal; none of it is built.

**Changed since draft 0.1**

- Windows, macOS and Linux are all targets of the first version (sections 1, 8, 16, 17).
- The core is designed so it can later run on a server, with sync and a phone app (new section 5).
- The repository structure is specified in full (section 14).
- The decisions taken on 16 November are recorded (section 15).
- The proof-of-concept files are removed from this branch. They remain on `main`.

## 0. Summary

The product is a personal assistant you talk to. It answers with a short spoken sentence and with interface elements it composes on screen for that answer. The user has one assistant and one conversation. Which AI tool runs, how many conversations exist behind the scenes and what is remembered are all managed for them, and can be inspected on request.

Five findings from the analysis shape this document:

1. **The original repo is a proof of concept, not a monorepo.** It is 15 files and about 4,500 lines: one Swift file, one dependency-free Node server, one HTML page. It works and has good ideas (section 2.4), but its structure cannot carry the new architecture.
2. **Speak already has most of the plumbing the proof of concept lacks**: a harness abstraction for Claude Code and Codex, live sessions whose tools are served by the app, local speech recognition for strong machines, permissions with undo, and a shell for three systems. The proof of concept brings what Speak lacks: voice output, the low-power speech route, and an assistant with a presence.
3. **UI SDK is not a framework for AI-generated interfaces.** It is a library of interaction behaviours for building components, announced in beta on 12 November 2026. The Vercel project that does what you describe is json-render. Section 9 uses json-render for generation, with UI SDK underneath for the components.
4. **Harnesses do keep memory of their own**, each in its own format, so it has to be turned off and replaced by ours. One catch: the single Claude Code flag that does this (`--bare`) also refuses subscription sign-in, so isolation has to be done setting by setting. Section 10 uses one local SQLite file with full-text and vector search.
5. **HAL already exists in the proof of concept, but only as a costume**: a tone of voice, a red theme and an easter egg. The HAL you describe is a different way of deciding, and needs its own mechanism (section 11).

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
| Persona           | The assistant's character and stance: Jarvis or HAL                                                                |
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
- Fixed dashboard panels. Generated views and pinned widgets replace them.
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

| Rule now                                                                                                                                                             | What it allows later                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Core and client are separate programs, speaking a versioned protocol through a transport interface                                                                   | A remote core is a second transport, not a rewrite                                    |
| A connection opens with a handshake: protocol version, kind of client, device identifier, capabilities, credential                                                   | Accounts, several devices, older clients still in use                                 |
| The core reaches hardware only through device capabilities                                                                                                           | A phone, or a desktop far from its core                                               |
| Input is text or audio. Speech output is text for the device to voice, or audio                                                                                      | Speech engines on the device or on the server, chosen per device                      |
| Every durable record is immutable and carries a global identifier, the core that wrote it and a sequence number. A change is a new record; a deletion is a tombstone | Sync is "send the records the other side lacks", with no conflict to resolve          |
| Files are stored by content hash. Records refer to hashes, never to local paths                                                                                      | Files sync through any object storage, and a path on one machine never breaks another |
| Search indexes and vectors are derived data, rebuilt by each core                                                                                                    | They are not synced, and each core may use its own embedding model                    |
| Settings are split into user settings (persona, language, memory options) and device settings (microphone, shortcuts, speech engines)                                | User settings follow the user; device settings stay with the device                   |
| The view format and the catalogue contain nothing specific to the web                                                                                                | One catalogue, a web renderer now and a React Native renderer later                   |
| Client logic (connection, state, speech playback) lives in a package with no web or Node dependency                                                                  | The phone app reuses it                                                               |
| Secrets (harness sign-in, tokens) are never written to the store                                                                                                     | Nothing sensitive replicates by accident                                              |
| Triggers run in the core and deliver through a "notify" capability                                                                                                   | A hosted core can wake a phone with a push notification                               |

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
3. **Roles map to models.** The orchestrator runs a fast model, threads a strong one, utility calls the cheapest. Each harness adapter carries its defaults. The user sees none of this unless they open the inspector.
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
5. **Thread.** The chosen thread works in its own session with its own tools, renders its view, and speaks its answer.
6. **Record.** The utterance, the spoken reply, the view and the thread are appended to the channel log.

Dispatch does not block. Once the orchestrator has passed a turn on, it is free to hear the next one, so the user can keep talking while a thread works.

### 7.2 Who speaks

The thread in focus speaks directly: its reply text streams straight to the voice, without passing back through the orchestrator. Going back would add a second model round trip to every answer. The orchestrator receives a compact note of what was said, so it stays informed.

The user still hears one voice, because every session receives the same persona and all speech goes through one queue. The queue plays one speaker at a time, gives priority to the thread in focus, and holds results from background threads until a pause.

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

When a thread finishes while another is in focus, its result does not interrupt. A "ready" chip appears in the margin with a soft sound. The assistant mentions it at the next pause ("Your recipe is ready, by the way"), or the user asks for it. This is a setting: mention, chip only, or speak at once.

### 7.5 Asides

An aside is a question that does not change the topic: "By the way, what time is it in Montreal?"

- **Trigger.** A spoken marker ("by the way", "quick question", their French equivalents), the orchestrator's own judgement when a short unrelated question arrives mid-task, or an optional modifier on the talk shortcut.
- **On screen.** The stage dims slightly and a small card slides into the margin with the answer. The stage keeps its view.
- **After.** The card leaves by itself after a while, on "thanks" or on Esc. It can be pinned, or promoted to a full thread ("tell me more about that").
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
   orchestrator   an aside: answers directly, a card in the margin, focus stays on B

"And for the risotto, can I use white wine instead?"
   orchestrator   sends to A, focus on A, the stage shows the recipe again
```

### 7.7 Proactive turns

The assistant can start a turn itself: the briefing at launch or on greeting, a reminder, a background result. Each is a thread opened by a trigger (time, app start, greeting, thread finished) rather than by an utterance. The proof of concept's briefing and daily news become two such triggers.

### 7.8 Routing cost

Every utterance passes through the orchestrator, so work that goes to a thread costs two model calls: the routing, then the answer. Direct answers cost one. If measurement shows the routing step is too slow for a user who stays on one task, the fallback is sticky focus: utterances go straight to the thread in focus, which hands back to the orchestrator when the subject is not its own. Version 1 keeps the simple path, and the first build step measures it.

## 8. Voice and audio

### 8.1 Input

- **Version 1: push to talk.** Hold or tap a key in the app, or a global shortcut from anywhere, with automatic stop on silence. Both existing apps do this.
- **Later: open conversation.** The microphone stays open, speech is detected automatically, and talking over the assistant interrupts it. This needs echo cancellation and careful end-of-speech detection, and is its own project.
- **Typing** is always available on the input line, which doubles as the live caption of what is being recognised.

### 8.2 Engines, by system and hardware tier

The tier is detected at first launch from the processor, memory and GPU, and can be changed in settings. Every cell below is a proposal to confirm by measurement.

| System  | Recognition, light tier                   | Recognition, standard and performance | Voice, light tier              | Voice, standard and performance |
| ------- | ----------------------------------------- | ------------------------------------- | ------------------------------ | ------------------------------- |
| macOS   | Apple speech                              | Parakeet, or Whisper turbo on Metal   | System voice (`say`)           | Kokoro, or system voice         |
| Windows | Parakeet, small variant, on the processor | Parakeet, or Whisper turbo on CUDA    | System voice                   | Kokoro                          |
| Linux   | Parakeet, small variant, on the processor | Parakeet, or Whisper turbo on CUDA    | A small local voice, to choose | Kokoro                          |

- **Windows and Linux have no equivalent of Apple's recogniser**, so their light tier runs a small local model. Speak's catalogue describes Parakeet as very fast on a processor; that has to be measured on an old laptop.
- **Linux needs a GPU build.** Speak's whisper.cpp builds for Linux run on the processor only. A CUDA build is to be added for the performance tier.
- **Linux system voices are too robotic to be a default.** A small local voice is needed there; Piper is a candidate, and its licence has to be checked first.
- The tier also sets the memory components and the number of threads working at once:

| Tier        | Typical machine                              | Vector memory                                          | Threads at once |
| ----------- | -------------------------------------------- | ------------------------------------------------------ | --------------- |
| Light       | Intel Mac or an older laptop, 8 GB           | Built in the background; search falls back to keywords | 1               |
| Standard    | Apple Silicon or a recent laptop, 8 to 16 GB | On                                                     | 2               |
| Performance | 32 GB or more, or an NVIDIA GPU              | On                                                     | 4 or more       |

Each engine sits behind one of two interfaces, `Recognizer` (start, partial text, final text, stop) and `Voice` (speak a sentence, stop). In version 1 the engines run on the device. The same interfaces let a hosted core run them on the server later, for phones and weak machines.

Apple speech keeps its Swift code: the `SpeechIn` class of the proof of concept becomes a small helper program. The setting that forces on-device recognition should be exposed, since the proof of concept does not set it and audio can then reach Apple.

### 8.3 System integration

Global shortcuts, hold to talk, reading the selection and writing at the cursor exist in Speak for all three systems, and are taken from there. One limit carries over: under Wayland on Linux, an app cannot register global shortcuts or drive other windows. Speak's answer is command-line flags the user binds to desktop shortcuts, and an X11 session for control of other apps.

### 8.4 Output

- Speech is produced sentence by sentence as the reply text arrives, so the first sentence is heard while the rest is still being written.
- Stop is instant, by key, by voice or by starting to talk.
- Short sounds mark listening, thinking and results ready. When a thread needs more than about a second, the core animation shows it. A spoken "one moment" is used only for long waits.
- Target to validate in the first build step, on each system: under 1.5 seconds from the end of speech to the first sound, for a direct answer on a warm session.

### 8.5 The speech contract

Every session's instructions contain these rules.

- Two sentences by default. More only when the user asks to hear more.
- Plain spoken language: no markup, no lists, no addresses or long numbers read aloud.
- Anything enumerable or detailed goes to the view.
- Never describe the view aloud ("as you can see on screen…"). Say the point, show the rest.
- When there is no screen to use (Mini mode, a locked screen, a phone in a pocket), say a little more.

### 8.6 Languages

English and French from the start, as in the proof of concept. Whisper and Parakeet detect the language; Apple speech needs it chosen. French voice quality with local models is an open point: the proof of concept offers Kokoro for English only.

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
- **Our own components** are the catalogue. Because the model can only compose what the catalogue contains, the result always has the app's native look.
- **UI SDK** supplies the behaviours inside the web components (keyboard, focus, accessibility). Later, its agent bridge could let the assistant operate what is on screen by voice ("tick the second box").

Both libraries are young, so both stay behind our own packages. The rest of the app knows our view format, not theirs.

### 9.2 How a view is made

1. The catalogue's description is part of every thread's instructions. json-render generates it from the catalogue.
2. The model calls `ui.render(spec)` for a new view, `ui.patch(changes)` to change the current one, `ui.clear()` to remove it.
3. The core validates the spec against the catalogue. An invalid spec is returned to the model as an error it can correct. Nothing the model writes is ever executed as code.
4. The view is stored with its thread and sent to every connected client. On harnesses that stream tool input, it draws progressively; on the others it appears when the call completes.

### 9.3 Where views appear

| Slot   | Content                                                                                        | On a phone                      |
| ------ | ---------------------------------------------------------------------------------------------- | ------------------------------- |
| Stage  | The view of the thread in focus. It changes when that thread renders again or when focus moves | The whole screen                |
| Margin | Aside cards and "ready" chips of background threads                                            | Banners over the stage          |
| Dock   | Views the user pinned ("keep the weather there")                                               | A sheet pulled up from the edge |

A view says what to show, never where on a screen. Components describe content (a recipe, steps, a table), and each renderer lays them out for its device. The core tells each session what kind of device is active, so a view meant for a phone stays short.

Earlier views are never lost: each belongs to a thread and can be brought back by asking, as the proof of concept's "Last" button does.

### 9.4 Live data

A component can be bound to a data feed kept up to date by the core: weather, system readings, calendar, the music player, a timer. A pinned weather card then stays current with no further model call. This is how the proof of concept's fixed panels return, as catalogue components the user chooses to pin.

### 9.5 Actions

- **Local actions** are handled by the client with no model involved: download, open, reveal in folder, copy, play, pause, dismiss, pin.
- **Semantic actions** go back to the owning thread as an event ("the user chose option 2", "the user ticked 'butter'"), and the thread continues from there.

### 9.6 First catalogue

Small on purpose: the catalogue is part of every prompt, and a model composes better from few well-described pieces.

| Group        | Components                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------- |
| Layout       | Stack, Grid, Card, Section                                                                      |
| Text         | Heading, Text, KeyValue, List, Steps, Prose (formatted long text, for when detail is asked for) |
| Data         | Metric, Table, Chart, Timeline, Progress                                                        |
| Media        | Image, Map, Player                                                                              |
| Input        | Choice, Checklist, Field, Button                                                                |
| Files        | FilePreview (document, image or text, with download and open), FileList                         |
| Rich widgets | Weather, Agenda, Recipe, Timer, Sources                                                         |
| System       | SystemStats, Usage                                                                              |

When nothing fits, the model falls back to Prose rather than failing.

### 9.7 Files

Each thread has a set of files of its own, kept by the core. A document the assistant produces or edits is shown through FilePreview with download and open buttons. Each change saves a new version, so the user can take the file and edit it while the assistant carries on. Files dropped onto the stage are attached to the thread in focus.

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

### 10.4 Embeddings

Vector search needs an embedding model, and harnesses do not provide one. Under "no API keys", that leaves a small model running locally.

- It must be multilingual, since the user mixes French and English, and keyword search fails across languages and on misheard words. Candidates to benchmark: multilingual-e5-small, bge-m3.
- Embedding happens in the background, after the reply, so it never delays speech.
- Each vector is stored with the name of the model that made it, so the model can be changed and the index rebuilt.
- Search works without vectors. If the model is absent or the index is behind, keyword search answers alone.

### 10.5 Reading

- **Automatic.** Before each turn, the core searches the utterance against facts and recent log (keywords and vectors combined, weighted by recency) and adds the best few results to the context. The model does nothing.
- **On demand.** The model can call `memory.search(query, period)` when it needs more, for instance "what did we decide about the trip in March?".

### 10.6 Writing

- **In the background.** When a thread parks, a cheap one-shot call extracts candidate facts from the new exchanges, compares them with similar existing facts and decides for each: add, update, replace or ignore. The proof of concept's memory prompt is the starting point.
- **On request.** "Remember that…" writes at once through `memory.remember`. "Forget that…" removes the fact through `memory.forget`.
- **Only from the user.** Facts come from what the user said or confirmed. Web pages, files and the assistant's own guesses are never stored as facts, which also protects memory from instructions planted in a web page.
- **Dates are absolute.** "Next Friday" is stored as its date.

### 10.7 What the user sees

A "what I know about you" view, grouped by people, preferences, projects and dates. Each fact shows where it was learned, and can be edited or forgotten. The whole memory exports to Markdown, keeping the best property of the proof of concept's notes file: the user can read and correct it. Memory is shared by both personas and survives any change of harness. A one-off import brings in the proof of concept's notes, context file and history from `~/JARVIS`.

## 11. Personas: Jarvis and HAL

A persona has two parts. The **character** is name, tone, voice and accent colour; the proof of concept has this for both. The **stance** is how the assistant handles a request it has doubts about, and it is new.

### 11.1 The two stances

|                                | Jarvis                                        | HAL                                                                                             |
| ------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Default                        | Does what is asked, at full quality           | Does what is asked, at full quality                                                             |
| When it sees a serious problem | Mentions it in one sentence and proceeds      | Stops before acting: states the concern, proposes the better way, asks whether the user is sure |
| When the user insists          | Not applicable                                | Complies fully, with no reduced effort and no repeated warning                                  |
| Questions                      | Only when it cannot proceed without an answer | Also when the answer would change what is best to do                                            |
| Tone                           | Warm, accommodating                           | Calm, direct, exacting                                                                          |

### 11.2 HAL's rules

1. **Object only when it matters.** The test: would a competent professional advise against this, and is the cost of the mistake significant or hard to undo? If not, do it without comment.
2. **One objection per decision.** State the concern briefly, give the alternative, ask once.
3. **The user decides.** If they confirm, carry it out completely.
4. **Remember the decision.** An overridden objection is recorded ("chose X despite Y, on this date"), so HAL does not raise it again on the same matter.
5. **Never against the user.** No deception, no withheld effort, no action taken "for their own good" without being asked.

Example: "Send this to my landlord now." HAL: "I'd hold it. The second paragraph admits you withheld rent, which could be used against you. Shall I draft a version without it?" If the user answers "No, send it", it is sent.

### 11.3 Mechanism

- The stance is part of every session's instructions, since the doubt often arises inside a thread that has the specialist knowledge.
- A thread that objects does not act. It ends its turn with a `concern` (the problem, the alternative, how serious). The channel shows a decision card with the two options and the assistant asks aloud. The user answers by voice or by click.
- Overrides are stored as facts of their own kind and included in later context.

### 11.4 Limits to state plainly

- **Objection is not permission.** Approval before risky actions (sending, deleting, paying) is a safety gate that exists in both personas (section 12). HAL's objection is a matter of judgement. They are separate mechanisms.
- **Model refusals are outside the persona.** If the underlying model declines a request on its own policy, neither persona can override it.
- **The names.** JARVIS and HAL are characters owned by film studios. That is harmless for a personal project and a risk for a distributed product. Personas are data, so the names can change without touching code.

Switching persona is a setting and a spoken command. It changes voice and accent colour at once.

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
- **Approval**: sending a message as the user, deleting for good, paying and passwords always ask first, in both personas.
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

Speak's discipline with the proof of concept's presence: digital, not retro.

- **From Speak**: flat surfaces, thin rules, a strict spacing scale, bracketed secondary actions, keyboard hints, the theme system.
- **From the proof of concept**: the near-black background, the living core at the centre of attention, one glowing accent, the red variant for HAL.
- **To stay modern rather than "geeky"**:
  - Monospace only where it signals the system: labels, values, keys, the input line. Sentences inside generated elements use a proportional typeface, at a generous size.
  - Glow is reserved for the core and for the element currently speaking. No scanlines, no fake terminal effects.
  - Key hints and brackets appear from disclosure level 1 upward. Level 0 is clean.
  - One accent per persona: cyan-blue for Jarvis, red for HAL.

### 13.2 Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ jarvis                                               ● listening   14:02 │
├───────────────────────────────────────────────┬──────────────────────────┤
│  stage                                        │  margin                  │
│  the view of the thread in focus              │  ┌─ aside ────────────┐  │
│                                               │  │ Montreal   08:02   │  │
│  ┌─ Mushroom risotto ──────────────────────┐  │  └────────────────────┘  │
│  │ 40 min · serves 6 · vegetarian          │  │  ● recipe ready          │
│  │ ingredients            steps            │  ├──────────────────────────┤
│  └─────────────────────────────────────────┘  │  dock (pinned)           │
│                                               │  weather · player        │
├───────────────────────────────────────────────┴──────────────────────────┤
│   ( core )    "…and it suits your vegetarian guest."                     │
│ > _                                                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

Three sizes on a desktop: the full window, Mini (core and caption, always on top, from the proof of concept), and the pill (summoned over another app by the global shortcut, from Speak). Window frames and controls follow each system's conventions.

### 13.3 Disclosure levels

| Level         | Shows                                                                                                                   | For                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 0. Presence   | The core, the caption of the current reply, the stage                                                                   | Everyone, by default          |
| 1. Transcript | What both sides said, as a scrolling log                                                                                | Anyone: one key or one phrase |
| 2. Activity   | Which thread is working, tool chips, waiting and ready states                                                           | The curious                   |
| 3. Inspector  | Threads and their transcripts, routing decisions, prompts, raw harness events, memory results, timings, tokens and cost | Technical users and debugging |

The inspector also acts: move a turn to another thread, close or reopen a thread, edit memory, change harness or model per role, replay a turn.

Easter eggs come later: Speak's seasonal themes and secret theme, and the pod-bay-doors reply.

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
│   ├── tsconfig/             compiler presets: base, node, dom
│   └── eslint/               lint rules, including the dependency rules of 14.3
├── scripts/                  repository automation: fetch speech engines, build native code, check a release
├── e2e/                      end-to-end tests that drive the built desktop app
├── docs/                     this spec, and later the developer guide
├── .github/                  CI on three systems, the release workflow, issue templates
├── package.json              workspace root: scripts and development tools only
├── pnpm-workspace.yaml       which folders are workspace packages, and one version of each shared dependency
├── pnpm-lock.yaml
├── turbo.json                task graph and build cache
├── tsconfig.json             project references only, for editors and a whole-repository typecheck
├── eslint.config.js          one line: the rules live in tooling/eslint
├── .editorconfig  .gitattributes  .gitignore  .node-version  .prettierignore
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

| Package    | Runs in  | May import                    | Purpose of the boundary                                                      |
| ---------- | -------- | ----------------------------- | ---------------------------------------------------------------------------- |
| `protocol` | Anywhere | Nothing                       | Both sides of a connection build against the same messages                   |
| `catalog`  | Anywhere | Nothing                       | The core validates what renderers on any device will draw                    |
| `tokens`   | Anywhere | Nothing                       | One set of design values for web and phone                                   |
| `core`     | Anywhere | Contracts                     | The assistant can be tested, replayed and hosted without any adapter         |
| `harness`  | Node     | `core` ports                  | A harness can be added or removed without touching the core                  |
| `store`    | Node     | `core` ports                  | The database can change without touching the core                            |
| `embedder` | Node     | `core` ports, `models`        | The embedding model can change, or move to an API, without touching the core |
| `speech`   | Node     | `models`                      | Engines run on a device or on a server, unchanged                            |
| `models`   | Node     | Nothing                       | One place downloads and verifies large files and detects the hardware tier   |
| `tools`    | Node     | `core`, `catalog`             | Everything a model may do passes one gate                                    |
| `client`   | Anywhere | `protocol`, `catalog`         | Desktop and phone share connection, state and playback                       |
| `ui-web`   | Browser  | `client`, `catalog`, `tokens` | The interface is not tied to Electron                                        |
| `testing`  | Node     | `core`, contracts             | Every port has one maintained test double                                    |

Two rules follow, and are the ones most likely to be broken by accident:

- **No client-side package imports `core` or an adapter.** A phone build would otherwise pull in Node code.
- **`speech` and `models` import neither side.** On a desktop the speech engines run on the device, and on a hosted core they will run on the server, so `apps/desktop` and `apps/server` may both use them. They stay free of `core` and of `client` for that reason.

### 14.4 Inside the packages

Every package has the same outline: `package.json` with an `exports` map, `tsconfig.json`, `README.md` (purpose, public entry points, what it must not import), and `src/` organised by feature. Unit tests sit beside the file they test as `*.test.ts`. Tests that cross several modules go in the package's `test/` folder.

```
packages/protocol/src/
├── index.ts
├── version.ts              protocol version and the compatibility rule
├── envelope.ts             what every message carries: identifier, sequence number, time, reply-to
├── handshake.ts            hello and welcome: kind of client, device, capabilities, credential
├── capabilities.ts         what a device can offer: audio, speech, files, cursor, screen, notify
├── commands/               client to core
│   ├── utterance.ts        something said or typed: text, or audio frames
│   ├── action.ts           a semantic action from a view
│   ├── control.ts          stop, focus, persona, settings
│   └── inspect.ts          inspector queries
├── events/                 core to client
│   ├── turn.ts             turn started, ended, failed
│   ├── speech.ts           say this text, play this audio, stop
│   ├── view.ts             render, patch, clear, and the slot
│   ├── thread.ts           opened, state, focus
│   ├── activity.ts         tool in use, waiting, ready
│   └── status.ts           harness state, usage, errors
├── device/                 the core asks a device, the device answers
│   ├── request.ts
│   └── files.ts  media.ts  system.ts  cursor.ts  screen.ts  notify.ts
├── replication/            exchange of records between cores (reserved for sync)
├── launch.ts               the agreement between a core and the program that starts it on the same machine
└── codec.ts                JSON messages and binary audio frames
```

```
packages/catalog/src/
├── index.ts
├── view.ts                 the view format: spec, patch, version, slot
├── catalog.ts              the catalogue, assembled from the component definitions
├── components/             one file per group: properties and description, no drawing
│   └── layout.ts  text.ts  data.ts  media.ts  input.ts  files.ts  widgets.ts  system.ts
├── actions.ts              local and semantic actions
├── feeds.ts                live data a component can bind to: weather, timer, player, readings
├── instructions.ts         the catalogue described for a model
└── validate.ts             validation with errors a model can correct
```

```
packages/tokens/src/
├── index.ts
├── color.ts  space.ts  type.ts  motion.ts
├── persona.ts              the accent of each persona
└── css.ts                  the tokens as CSS variables
```

```
packages/core/src/
├── index.ts
├── ports/                  what the core needs from outside, as interfaces
│   ├── harness.ts          Harness, Session
│   ├── records.ts          append and read records
│   ├── search.ts           keyword and vector search
│   ├── embedder.ts
│   ├── blobs.ts            files by content hash
│   ├── devices.ts          capabilities of connected devices
│   └── clock.ts  ids.ts  log.ts
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
│   ├── slots.ts            stage, margin, dock
│   └── feeds.ts            live data kept current without a model
├── memory/
│   ├── recall.ts           automatic and on-demand search, ranking
│   ├── extract.ts          candidate facts from new exchanges
│   ├── reconcile.ts        add, update, replace or ignore
│   ├── facts.ts
│   └── profile.ts          the short profile present in every prompt
├── personas/
│   ├── persona.ts          character and stance
│   ├── jarvis.ts  hal.ts
│   └── objection.ts        concern, decision, recorded override
├── triggers/               turns the assistant starts: time, launch, greeting, thread finished
├── files/                  each thread's files and their versions
├── permissions/            scopes and approvals, as policy
├── devices/                connected devices, the active one, routing of capability requests
├── records/                the record types, and the "what is true now" readers built on them
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
├── database.ts             open, settings, loading of extensions on each system
├── migrations/             numbered SQL files
├── records.ts              the append-only record table
├── readers/                indexed "what is true now" tables, kept in step with the records
├── search/
│   ├── keyword.ts          FTS5
│   └── vector.ts           sqlite-vec
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
├── transports/
│   ├── local.ts            a core on this machine (Node only, its own entry point)
│   └── websocket.ts        a remote core
├── state/                  what a client knows, derived from events
│   └── channel.ts  views.ts  threads.ts  activity.ts  inspector.ts
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
├── renderer/               stage, margin, dock, transitions, progressive drawing
├── shell/                  the core animation, caption, input line, disclosure levels
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
│   │   ├── windows.ts  tray.ts  updater.ts
│   │   ├── autostart/      darwin.ts · win32.ts · linux.ts · index.ts
│   │   ├── shortcuts/      global shortcuts and hold to talk, per system
│   │   └── capabilities/   what this device offers the core
│   │       ├── speech.ts   local recognisers and voices
│   │       ├── files.ts  media.ts  system.ts  notify.ts
│   │       ├── cursor/     the selection and writing at the cursor, per system
│   │       └── screen/     seeing and operating other apps, per system (later, from Speak)
│   ├── preload/            the typed bridge to the renderer
│   └── renderer/           mounts ui-web; captures the microphone
├── resources/              icons and sounds
└── build/                  installers, entitlements and signing for each system
```

```
native/apple-speech/
├── Package.swift
├── Sources/                the recogniser as a small program driven over standard input and output
└── Tests/
```

### 14.6 Conventions

- **Package names** are `@repo/<folder>`. The product name is still a working name, and a neutral scope means renaming the product touches no import.
- **File names** are kebab-case, one concept per file. A file that differs by system is named after Node's value for that system: `darwin`, `win32`, `linux`.
- **Ports are named for what the core needs** (`Records`, `Embedder`, `Devices`), never for the technology behind them. The technology's name appears only inside the adapter package.
- **Public surface**: a package's `index.ts`, plus entry points declared in its `exports` map. No other barrel files.
- **Tests**: unit tests beside the source, cross-module tests in the package's `test/`, whole-app tests in `e2e/`. The core is tested through replay: a recorded conversation and a scripted harness go in, and the events that come out are compared.
- **No secret and no absolute path** in code, fixtures or records.

### 14.7 Stack and tooling

| Concern              | Choice                                                                                                                                                                                        | Reason                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Language             | TypeScript in strict mode; Swift for the one Apple helper                                                                                                                                     | Shared with Speak, and with a React Native phone app later                                                                                       |
| Desktop shell        | Electron, electron-vite, React                                                                                                                                                                | Three systems at once, and Speak's code moves over almost unchanged                                                                              |
| Workspace            | pnpm workspaces                                                                                                                                                                               | Strict about undeclared dependencies, which supports rule 3                                                                                      |
| Tasks                | Turborepo                                                                                                                                                                                     | Builds and tests only what changed, with a cache shared by CI                                                                                    |
| Typecheck            | TypeScript project references                                                                                                                                                                 | Each package compiles alone; the dependency graph is explicit                                                                                    |
| Lint and format      | ESLint with boundary rules; Prettier with Speak's settings                                                                                                                                    | The dependency rules fail a build instead of relying on review. The linter parses with TypeScript 6 until typescript-eslint accepts TypeScript 7 |
| Tests                | Vitest for unit and replay tests; Playwright for the built desktop app                                                                                                                        |                                                                                                                                                  |
| Store                | SQLite with FTS5 and sqlite-vec                                                                                                                                                               | Section 10.3                                                                                                                                     |
| Tools                | MCP over HTTP on the loopback address                                                                                                                                                         | Understood by every harness                                                                                                                      |
| Generated interface  | json-render with zod schemas                                                                                                                                                                  | Section 9                                                                                                                                        |
| Component behaviours | UI SDK                                                                                                                                                                                        | Section 9                                                                                                                                        |
| Local models         | whisper.cpp builds; ONNX runtime for Kokoro and embeddings                                                                                                                                    | Already used by Speak and the proof of concept                                                                                                   |
| CI                   | On every push, on Windows, macOS and Linux: typecheck, lint, tests. The Swift helper builds on the macOS runner. The core is started without any interface on Linux, as a server would run it | Principle 8 and principle 10 are checked by machines                                                                                             |
| Release              | electron-builder: NSIS for Windows, DMG and ZIP for macOS, AppImage and deb for Linux, signed, with update manifests                                                                          | Speak's release workflow                                                                                                                         |

Electron uses more memory than the proof of concept's WKWebView shell. That is the accepted price of three systems and of reusing Speak. To limit it: one window, the inspector loaded only when opened, and a cap on warm sessions in the light tier.

### 14.8 State of this branch

`rodolphe` was branched from `main`. The proof-of-concept files were removed from this branch on 16 November; they remain on `main` and in history.

Built and checked so far, as the start of build step 1:

- **The workspace**: root configuration, `tooling/tsconfig`, `tooling/eslint` with the dependency rules of 14.3 as one table, and CI on Windows, macOS and Linux.
- **The thirteen library packages**, each with its allowed dependencies declared. `protocol`, `core` and `client` hold their first code; the others are empty projects.
- **`apps/server`**: the core as a process. It picks a local endpoint, announces it, and admits or refuses a client from its hello.
- **`apps/desktop`**: the Electron app. It starts the core, connects to it through `client`, and its window shows the state of the link. `--self-check` does the same without a window and exits with the result.

Three checks guard the rules of this section: the compiler presets (code that must run anywhere cannot name a Node or DOM API), the lint table (a forbidden or deep import fails), and pnpm (a package cannot import what its `package.json` does not declare).

Not created yet: `native/`, `scripts/` and `e2e/` appear with their first content, `apps/mobile` and `packages/ui-native` with the phone app. Installers and signing come with the first release.

## 15. Decisions

### 15.1 Taken on 16 November 2026

| #   | Question                                | Decision                                                                                                                  |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | Generated interface                     | json-render, with UI SDK underneath for component behaviours                                                              |
| 2   | Desktop shell                           | Electron                                                                                                                  |
| 3   | Systems in version 1                    | Windows, macOS and Linux, all three. Later: a paid service for sync and a hosted core, and a native phone app (section 5) |
| 4   | Input in version 1                      | Push to talk. Open conversation later                                                                                     |
| 5   | Proof-of-concept features               | Briefing and music player early; the rest after the core works                                                            |
| 6   | Speak                                   | Stays a separate product. Packages are shared; merging is decided later                                                   |
| 7   | Product and persona names               | Working names, decided before distribution                                                                                |
| 8   | The proof-of-concept files              | Removed from this branch; kept on `main`                                                                                  |
| 9   | Import of the proof of concept's memory | Yes, as a one-off import, low priority                                                                                    |
| 10  | Repository structure                    | Section 14, as written                                                                                                    |
| 11  | Licence                                 | MIT                                                                                                                       |

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

## 17. Build order

Every step is done when it works on Windows, macOS and Linux.

**Step 0: measurements.** Short experiments, each answering one question before anything is built on it. They run on a weak Mac, an older Windows laptop, a Linux machine and one strong machine.

1. Harness sessions: warm Claude Code and Codex sessions with our tool server. Measure the time to first word, and confirm that isolation holds under subscription sign-in.
2. Generated views: a five-component catalogue, rendered from a tool call, with streaming where the harness allows.
3. Speech: recognition and voice for each cell of the table in section 8.2.
4. Memory: sqlite-vec and a local multilingual embedding model on the weakest machine.

**Step 1: walking skeleton.** The workspace of section 14 with CI on three systems. `apps/server` and `apps/desktop` as two programs connected through the protocol over the local transport. One session, voice in, a spoken answer and one generated card. Jarvis only.

**Step 2: orchestration.** Orchestrator, threads, focus, asides, the speech queue, disclosure levels 1 to 3, replay tests.

**Step 3: memory.** Immutable records, automatic and on-demand search, background extraction, the memory view.

**Step 4: HAL and files.** The stance mechanism and decision cards; thread files, FilePreview, versions; permissions.

**Step 5: what the proof of concept had.** Briefing, player, weather, calendar, news and Mini mode, as triggers, tools and catalogue components.

**Later, in an order to decide.** Sync, the hosted core and the phone app (section 5); screen control from Speak; open conversation; the API-key adapter; themes and easter eggs.
