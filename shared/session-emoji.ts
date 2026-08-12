import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// Shared per-session emoji for tab-title-status.ts and notify-on-idle.ts.
// Both extensions call sessionEmoji() with the same session id, so the tab
// title and the balloon notification always carry the same glyph.
//
// Lives in extensions/shared/ on purpose: pi auto-discovers only
// extensions/*.ts and extensions/*/index.ts, so this module is importable but
// never loaded as an extension itself.
//
// Pool curation: only glyphs that stay visually distinct at tab-title size
// (~16px) — one per visual family, no near-duplicates like 🐕/🐈.
// \uFE0F (VS16) forces emoji presentation for text-default BMP symbols.
export const SESSION_EMOJIS: string[] = [
  // animals
  "🦊", "🐺", "🦁", "🐯", "🐸", "🐵", "🐼", "🐨",
  "🐰", "🐹", "🐘", "🦒", "🦘", "🦔", "🐿️", "🦡",
  "🦫", "🦦", "🦇", "🦥", "🦄",
  // birds
  "🦉", "🐧", "🦜", "🦩", "🦚", "🦆", "🦅", "🐓",
  // sea
  "🐙", "🐬", "🐳", "🐠", "🐡", "🦀", "🦞", "🦈", "🐚",
  // insects & reptiles
  "🐝", "🦋", "🐌", "🐞", "🐢", "🦎", "🐍", "🦖", "🐲",
  // plants
  "🍄", "🌵", "🌻", "🌹", "🌺", "🌸", "🌼", "🌷", "🍀", "🌴",
  // food
  "🍉", "🥑", "🍋", "🍇", "🍓", "🍒", "🍑", "🥝",
  "🍍", "🥥", "🍩", "🍪", "🧁", "🍕", "🌮", "🍣", "🍦", "🍿",
  // drinks
  "☕\uFE0F", "🧋", "🍹", "🍺",
  // objects
  "🚀", "⭐", "🔥", "🌈", "⚡\uFE0F", "🎲", "🎯", "🧿",
  "🪐", "🎈", "🎁", "🎨", "🎭", "🎸", "🎷", "🎻",
  "🎮", "🧩", "🔮", "💎", "🧲", "🔭", "🧭", "💡",
  // transport
  "🚗", "🚲", "🛵", "✈️", "🚁", "⛵", "🛸",
  // sky & weather
  "☀\uFE0F", "🌙", "❄\uFE0F", "⛄", "🌪️", "☂\uFE0F", "🌠", "💫",
  // symbols
  "❤\uFE0F", "💜", "💙", "💚", "🧡", "💛", "⚜\uFE0F", "🔱",
];

export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function sessionEmoji(ctx: ExtensionContext): string {
  try {
    const id = ctx.sessionManager.getSessionId() ?? ctx.sessionManager.getSessionFile() ?? "";
    return id ? SESSION_EMOJIS[fnv1a(String(id)) % SESSION_EMOJIS.length] : "🐙";
  } catch {
    return "🐙";
  }
}
