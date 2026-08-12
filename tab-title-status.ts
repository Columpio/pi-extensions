import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readdirSync, readFileSync } from "fs";
import { tmpdir, userInfo, homedir } from "os";
import { join } from "path";
import { sessionEmoji } from "./shared/session-emoji";
import { sessionNoteTitle, sessionTabTitle } from "./shared/session-tab-title";

// Strict snake: constant length 3, every frame adds one dot at the head and
// removes one at the tail (+1/-1), orbiting the 8-position cell perimeter
// clockwise (frame order confirmed by eye in the tab title).
const FRAMES = ["⠇", "⠋", "⠙", "⠸", "⢰", "⣠", "⣄", "⡆"];
// 93.75ms = exactly 6x the ~15.625ms Windows timer grid. ConPTY measurement:
// title updates at 31.25ms arrive jittery under TUI load; >=62.5ms is clean.
// 8 frames x 93.75ms = one lap per 0.75s (calm crawl, by user request).
const FRAME_MS = 120;

// Per-session emoji as the first char of the title (shared/session-emoji.ts).
// Tab icons are hidden globally via the WT theme (tab.iconStyle: "hidden"),
// so this emoji reads as the tab's icon.

// The animation runs in a worker thread, not the main event loop. Pi's main
// loop gets blocked in bursts while streaming/rendering (measured: 50ms
// interval degrades to 180-900ms gaps), which made the snake stutter:
// freeze, then jump to catch up. A worker thread has its own event loop and
// keeps a steady cadence no matter how busy the main thread is; it writes
// the OSC title escape directly to stdout (fd 1).
const WORKER_CODE = `
const { parentPort, workerData } = require("node:worker_threads");
const fs = require("node:fs");
const frames = workerData.frames;
const frameMs = workerData.frameMs;
let title = workerData.title;
function writeTitle(text) {
  try { fs.writeSync(1, "\\x1b]0;" + text + "\\x07"); } catch {}
}
// Self-scheduling timeout chain aimed at exact frame boundaries. A plain
// setInterval quantizes to the ~15.6ms timer grid out of phase with the
// frame length, which made frames alternate ~95ms/~143ms (visible judder).
// Targeting startedAt + n*frameMs makes every displayed frame uniform.
const start = performance.now();
let n = 0;
function fire() {
  writeTitle(frames[n % frames.length] + " " + title);
  n++;
  const target = start + (n + 1) * frameMs;
  timer = setTimeout(fire, Math.max(1, target - performance.now()));
}
let timer = setTimeout(fire, frameMs);
parentPort.on("message", (m) => {
  if (m && m.type === "title") title = m.title;
});
parentPort.on("close", () => clearTimeout(timer));
`;

// --- Background subagent awareness ---------------------------------------
// pi-subagents runs background/async subagents as separate processes and
// tracks each one in <tmp>/pi-subagents-<scope>/async-subagent-runs/<runId>/
// status.json. The main agent settles (agent_settled) while those children
// keep working -- the session is merely woken when they finish. The snake
// should keep crawling for the whole time, so on settle we check for active
// runs owned by this session and only stop once they drain.
const SUBAGENT_ACTIVE_STATES = new Set(["queued", "running"]);

function sanitizeScopeSegment(value: string): string {
  const s = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "unknown";
}

// Mirrors pi-subagents' resolveTempScopeId() so we find its status files.
function subagentRunsDir(): string {
  let scope: string;
  const getuid = (process as { getuid?: () => number }).getuid;
  if (typeof getuid === "function") {
    scope = `uid-${getuid()}`;
  } else {
    const envUser = process.env.USERNAME ?? process.env.USER ?? process.env.LOGNAME;
    if (envUser) {
      scope = `user-${sanitizeScopeSegment(envUser)}`;
    } else {
      try {
        const name = userInfo().username;
        scope = name ? `user-${sanitizeScopeSegment(name)}` : `home-${sanitizeScopeSegment(process.env.USERPROFILE ?? process.env.HOME ?? homedir())}`;
      } catch {
        scope = "shared";
      }
    }
  }
  return join(tmpdir(), `pi-subagents-${scope}`, "async-subagent-runs");
}

function pidAlive(pid: unknown): boolean {
  if (typeof pid !== "number" || pid <= 0) return true; // unknown: trust the state field
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false; // stale status.json left behind by a crashed runner
  }
}

// True while any background subagent run owned by this session is active.
// sessionFile is undefined for in-memory sessions; then any active run counts.
function hasActiveSubagents(sessionFile: string | undefined): boolean {
  const root = subagentRunsDir();
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return false; // no dir -> pi-subagents never wrote status files
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const status = JSON.parse(readFileSync(join(root, entry.name, "status.json"), "utf8"));
      if (!SUBAGENT_ACTIVE_STATES.has(status?.state)) continue;
      if (sessionFile && status.sessionId !== sessionFile) continue; // belongs to another tab
      if (!pidAlive(status.pid)) continue;
      return true;
    } catch {
      // unreadable or half-written status file: ignore
    }
  }
  return false;
}

export default function (pi: ExtensionAPI) {
  let baseTitle = "π";
  let titleCwd = "";
  let sessionName: string | undefined;
  let icon = "🐙";
  let worker: import("node:worker_threads").Worker | null = null;
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let subagentPollTimer: ReturnType<typeof setInterval> | null = null;
  let titleRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let titleGuardTimer: ReturnType<typeof setInterval> | null = null;

  function computeBase(ctx: ExtensionContext): string {
    return sessionTabTitle(
      ctx.cwd,
      icon,
      sessionNoteTitle(ctx.sessionManager.getEntries()),
      sessionName ?? ctx.sessionManager.getSessionName(),
    );
  }

  async function startSnake(ctx: ExtensionContext): Promise<void> {
    if (worker || fallbackTimer) return; // already running (e.g. follow-up run)
    try {
      const { Worker } = await import("node:worker_threads");
      const w = new Worker(WORKER_CODE, {
        eval: true,
        workerData: { frames: FRAMES, frameMs: FRAME_MS, title: baseTitle },
      });
      w.unref(); // never keep the process alive for the animation
      w.on("error", () => {
        // Worker died mid-run; restore base title and give up quietly.
        worker = null;
        ctx.ui.setTitle(baseTitle);
      });
      worker = w;
      return;
    } catch {
      // worker_threads unavailable: fall back to an in-process timer.
      // Stutters under load, but better than no animation.
    }
    const start = performance.now();
    let n = 0;
    const fire = () => {
      ctx.ui.setTitle(`${FRAMES[n % FRAMES.length]} ${baseTitle}`);
      n++;
      fallbackTimer = setTimeout(fire, Math.max(1, start + (n + 1) * FRAME_MS - performance.now()));
    };
    fallbackTimer = setTimeout(fire, FRAME_MS);
  }

  function stopSnake(ctx: ExtensionContext): void {
    stopSubagentPoll();
    if (worker) {
      worker.terminate();
      worker = null;
    }
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    ctx.ui.setTitle(baseTitle);
  }

  function stopSubagentPoll(): void {
    if (subagentPollTimer) {
      clearInterval(subagentPollTimer);
      subagentPollTimer = null;
    }
  }

  function sessionFile(ctx: ExtensionContext): string | undefined {
    try {
      return ctx.sessionManager.getSessionFile() ?? undefined;
    } catch {
      return undefined;
    }
  }

  // agent_settled: the main agent is done, but background subagents may
  // still be running. Keep the snake alive until they drain.
  function settleSnake(ctx: ExtensionContext): void {
    stopSubagentPoll();
    if (!hasActiveSubagents(sessionFile(ctx))) {
      stopSnake(ctx);
      return;
    }
    subagentPollTimer = setInterval(() => {
      if (!ctx.isIdle()) return; // agent woke up again; agent_start owns the snake
      if (hasActiveSubagents(sessionFile(ctx))) return; // children still working
      stopSnake(ctx); // also clears this poll timer
    }, 2000);
    subagentPollTimer.unref?.();
  }

  pi.events.on("pi-note:title", (event: { note?: string }) => {
    // pi-note emits this after every create, edit, clear, and reconstruction.
    baseTitle = sessionTabTitle(titleCwd, icon, event.note, sessionName);
    if (worker) worker.postMessage({ type: "title", title: baseTitle });
    else {
      // The event bus does not provide a UI context. Writing OSC 0 directly
      // is equivalent to ctx.ui.setTitle() and updates an idle tab at once.
      process.stdout.write(`\x1b]0;${baseTitle}\x07`);
    }
  });

  function applyBaseTitle(ctx: ExtensionContext): void {
    baseTitle = computeBase(ctx);
    if (!worker && !fallbackTimer) ctx.ui.setTitle(baseTitle);
    else worker?.postMessage({ type: "title", title: baseTitle });
  }

  function refreshAfterSessionTransition(ctx: ExtensionContext): void {
    // Pi updates the terminal title itself several times while initializing
    // a resumed session. Keep a small idle guard: otherwise a later internal
    // update can silently restore Pi's default title after our timer wins.
    if (titleRefreshTimer) clearTimeout(titleRefreshTimer);
    applyBaseTitle(ctx);
    titleRefreshTimer = setTimeout(() => {
      titleRefreshTimer = null;
      applyBaseTitle(ctx);
    }, 250);

    if (!titleGuardTimer) {
      titleGuardTimer = setInterval(() => {
        if (ctx.isIdle() && !worker && !fallbackTimer) applyBaseTitle(ctx);
      }, 500);
      titleGuardTimer.unref?.();
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    icon = sessionEmoji(ctx);
    titleCwd = ctx.cwd;
    sessionName = ctx.sessionManager.getSessionName();
    baseTitle = computeBase(ctx);
    ctx.ui.setTitle(baseTitle);
    refreshAfterSessionTransition(ctx);
  });

  pi.on("session_info_changed", async (event, ctx) => {
    sessionName = event.name;
    refreshAfterSessionTransition(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    baseTitle = computeBase(ctx); // cwd may have changed between sessions
    stopSubagentPoll(); // agent running again; it owns the snake now
    await startSnake(ctx);
  });

  // agent_settled (not agent_end): fires only when pi won't auto-continue
  // with retries, compaction, or queued follow-ups. Background subagents
  // may still be running though -- settleSnake keeps the snake for them.
  pi.on("agent_settled", async (_event, ctx) => {
    settleSnake(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    baseTitle = computeBase(ctx);
    if (!worker && !fallbackTimer) ctx.ui.setTitle(baseTitle);
    else worker?.postMessage({ type: "title", title: baseTitle });
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (titleRefreshTimer) {
      clearTimeout(titleRefreshTimer);
      titleRefreshTimer = null;
    }
    if (titleGuardTimer) {
      clearInterval(titleGuardTimer);
      titleGuardTimer = null;
    }
    stopSnake(ctx);
  });
}
