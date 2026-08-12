# My Pi extensions

Personal extensions for [Pi coding agent](https://github.com/earendil-works/pi).

- **`notify-on-idle`** — sends a Windows notification with sound when Pi finishes or needs attention.
- **`pi-note`** — pins session notes above the prompt and lets you browse, restore, and reuse them.
- **`tab-title-status`** — gives each Pi session a stable emoji title and an animated busy indicator.
- **`pi-failover`** — switches to configured backup LLM models after a rate limit, usage cap, or outage.

## Repository layout and installation

Pi discovers top-level `*.ts` files and `*/index.ts` files in its extensions directory. This repository therefore
keeps standalone extensions at its root and the multi-file `pi-failover` extension in its own directory. `shared/`
contains modules used by multiple extensions; it is deliberately not an extension entry point.

```text
extensions/
├── notify-on-idle.ts
├── pi-note.ts
├── tab-title-status.ts
├── shared/
│   ├── session-emoji.ts
│   └── session-tab-title.ts
└── pi-failover/
    └── index.ts
```

Clone the repository into Pi's extensions directory, then install the dependencies required by `pi-failover`:

```bash
git clone <your-repository-url> ~/.pi/agent/extensions
cd ~/.pi/agent/extensions/pi-failover
npm ci
```

On Windows, use the corresponding path under `%USERPROFILE%\.pi\agent\extensions`. Restart Pi after changing
extensions.

## Extensions

### `notify-on-idle.ts`

**Purpose.** On Windows, displays a balloon notification and plays a system sound when the interactive agent becomes
idle. Error completions use the error icon and sound. The notification body is a short preview of Pi's last response.

**Details.** The extension rate-limits notifications, avoids notifications for non-TUI modes, and shares the same
deterministic per-session emoji with `tab-title-status.ts`. It uses `powershell.exe` plus the Windows Forms notification
area API, so it is Windows-specific.

**Origin.** Written in this repository; no upstream fork is recorded.

### `pi-note.ts`

**Purpose.** Adds session-scoped pinned notes above Pi's input editor.

**Commands.**

- `/note <text>` creates or replaces a note; prefixes such as `:recap:` and `[TODO]` are supported.
- `/notes` browses notes from the current session, project, or all projects and restores a selected note.
- `/note-pop` places the current note text into the prompt editor.
- `/note-clear` clears the note from the current session.

**Details.** Notes are stored as custom Pi session entries rather than prompt messages, so they do not enter model
context. Notes can be composed in a multiline editor, preserve manual line breaks, and wrap safely in the TUI. The
extension also publishes the first note line for `tab-title-status.ts` to show in the terminal title.

**Origin.** Based on an external extension. Its upstream repository has not yet been identified; add the source URL
and the local differences here before publishing.

### `tab-title-status.ts`

**Purpose.** Sets a readable terminal-tab title for each session and displays a small animated indicator while Pi or
its background subagents are working.

**Details.** A session-ID hash selects a stable emoji, and the idle title shows the first line of the pinned note or the
session name. Animation runs in a worker thread to remain smooth while Pi renders or streams. The extension continues
the animation until background `pi-subagents` runs belonging to the same session complete. It is designed and tested
for Windows Terminal, with a timer fallback for environments where worker threads are unavailable.

**Origin.** Written in this repository; no upstream fork is recorded.

### `pi-failover/`

**Purpose.** Detects retryable model failures and automatically changes Pi to the next configured fallback model, then
retries the prompt. It also provides `/failover` and the `failover_status` tool to report backend health.

**Upstream.** Forked from [JoshTickles/pi-failover](https://github.com/JoshTickles/pi-failover), currently based on
commit `5c32ab5` (`Release cleanup: add LICENSE, .gitignore .pi/, remove PLAN.md, update models to current`).

**Local differences.** `config.ts` resolves the configuration-home directory from `HOME` or `USERPROFILE`. The
upstream only used `HOME`; the local change makes the default configuration path work when Pi is launched on Windows
without `HOME`, for example from Windows Terminal, Explorer, or a shortcut.

**Configuration.** Copy `pi-failover/failover.example.yaml` to one of the locations described in
`pi-failover/README.md`, then set `fallback_models` to models already configured in Pi.
