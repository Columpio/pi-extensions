import { basename } from "node:path";

const NOTE_ENTRY_TYPE = "note";

/**
 * First visible line for a tab title. Control characters are removed so a note
 * cannot inject terminal escape sequences into the OSC title.
 */
export function noteTitleLine(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const line = text.split(/\r?\n/, 1)[0]?.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return line || undefined;
}

/** Read the current session's last non-deleted pi-note entry, if any. */
export function sessionNoteTitle(
  entries: readonly { type: string; customType?: string; data?: unknown }[],
): string | undefined {
  let note: string | undefined;
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== NOTE_ENTRY_TYPE) continue;
    const data = entry.data as { text?: unknown; deleted?: unknown } | undefined;
    if (data?.deleted === true) note = undefined;
    else if (typeof data?.text === "string") note = noteTitleLine(data.text);
  }
  return note;
}

/** Build the stable part of the terminal tab title. */
export function sessionTabTitle(
  cwd: string,
  emoji: string,
  note?: string,
  sessionName?: string,
): string {
  const dir = basename(cwd.replace(/[\\/]+$/, "")) || cwd;
  const label = noteTitleLine(note) ?? noteTitleLine(sessionName);
  return label ? `${emoji}${label}` : `${emoji} π ${dir}`;
}
