import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "child_process";
import { sessionEmoji } from "./shared/session-emoji";
import { sessionNoteTitle, sessionTabTitle } from "./shared/session-tab-title";

// OS notification with sound when the agent finishes or waits for an answer.
// Visual: NotifyIcon balloon tip (works without registered AUMID, unlike WinRT
// toasts which Windows may silently drop). The powershell process stays alive
// while the balloon is shown, then disposes the tray icon and exits.
// Sound: System.Media.SoundPlayer with stock C:\Windows\Media wavs (no external player).

const MIN_INTERVAL_MS = 2000;
const BALLOON_MS = 10000;

// Balloon title carries the same per-session emoji as the tab title
// (shared/session-emoji.ts — deterministic from the session id).

// Title/body/sound are passed via env vars to avoid all quoting/escaping issues.
const PS_SCRIPT = String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$tipIcon = [System.Windows.Forms.ToolTipIcon]::Info
if ($env:PI_NOTIFY_ICON -eq 'Warning') { $tipIcon = [System.Windows.Forms.ToolTipIcon]::Warning }
if ($env:PI_NOTIFY_ICON -eq 'Error') { $tipIcon = [System.Windows.Forms.ToolTipIcon]::Error }
$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = [System.Drawing.SystemIcons]::Information
$icon.Visible = $true
$icon.ShowBalloonTip($env:PI_NOTIFY_MS, $env:PI_NOTIFY_TITLE, $env:PI_NOTIFY_BODY, $tipIcon)
try { (New-Object System.Media.SoundPlayer ("C:\Windows\Media\" + $env:PI_NOTIFY_SOUND)).PlaySync() } catch { try { [System.Media.SystemSounds]::Asterisk.Play() } catch {} }
Start-Sleep -Milliseconds ([int]$env:PI_NOTIFY_MS + 1000)
$icon.Dispose()
`;

function osNotify(title: string, body: string, sound: string, icon: "Info" | "Warning" | "Error"): void {
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-WindowStyle", "Hidden", "-Command", PS_SCRIPT],
    {
      env: {
        ...process.env,
        PI_NOTIFY_TITLE: title,
        PI_NOTIFY_BODY: body,
        PI_NOTIFY_SOUND: sound,
        PI_NOTIFY_ICON: icon,
        PI_NOTIFY_MS: String(BALLOON_MS),
      },
      stdio: "ignore",
      windowsHide: true,
    },
  );
  // NOTE: no `detached: true` — on Windows it spawns the process with
  // DETACHED_PROCESS and powershell.exe dies instantly without running
  // -Command. unref() alone is enough for fire-and-forget.
  child.unref();
}

function lastAssistant(messages: any[]): any | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") return messages[i];
  }
  return undefined;
}

function assistantText(msg: any): string {
  if (!Array.isArray(msg?.content)) return "";
  return msg.content
    .filter((c: any) => c?.type === "text")
    .map((c: any) => c.text ?? "")
    .join("\n")
    .trim();
}

export default function (pi: ExtensionAPI) {
  let lastMessages: any[] | null = null;
  let lastNotifyAt = 0;
  let icon = "🐙";

  pi.on("agent_end", async (event) => {
    // Fires per low-level run (also before retries/compaction) — just stash.
    lastMessages = event.messages ?? [];
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (ctx.mode !== "tui") return; // notify only in interactive sessions (not rpc/print/json)
    if (!lastMessages) return; // settled without a completed run
    if (!ctx.isIdle()) return;

    const now = Date.now();
    if (now - lastNotifyAt < MIN_INTERVAL_MS) return;
    lastNotifyAt = now;

    const title = sessionTabTitle(
    ctx.cwd,
    icon,
    sessionNoteTitle(ctx.sessionManager.getEntries()),
    ctx.sessionManager.getSessionName(),
  );
    const last = lastAssistant(lastMessages);
    const text = assistantText(last);
    // Beginning of the agent's last answer, single line, with an ellipsis.
    const preview = text.replace(/\s+/g, " ").trim().slice(0, 200) + "…";

    if (last?.stopReason === "error") {
      osNotify(title, preview, "Windows Exclamation.wav", "Error");
    } else {
      osNotify(title, preview, "notify.wav", "Info");
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    lastMessages = null;
    lastNotifyAt = 0;
    icon = sessionEmoji(ctx);
  });
}
