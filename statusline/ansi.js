// Claude Code status line: ANSI colours, display width and truncation helpers (see ../statusline.js).
"use strict";

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const esc = (code) => `\x1b[${code}m`;
const R   = esc("0");   // reset
const DIM = esc("2");   // dim
const BLD = esc("1");   // bold

// OSC 8 hyperlink: wraps LABEL so it becomes clickable (Ctrl/Cmd-click) in
// terminals that support it; falls back to plain LABEL when URL is missing. The
// escape sequences carry zero display width — stripAnsi/truncateAnsi skip them.
const link = (url, label) => (url ? `\x1b]8;;${url}\x07${label}\x1b]8;;\x07` : label);

// The cockpit mod's palette (hooks/shared.ts COLORS), so the status line and the pane read as one.
const C = {
  gray:     esc("38;2;140;140;140"),
  dim:      esc("38;2;154;160;170"),
  yellow:   esc("38;2;255;207;138"),
  amber:    esc("38;2;232;163;90"),
  green:    esc("38;2;126;198;153"),
  red:      esc("38;2;240;122;111"),
  orange:   esc("38;2;255;158;94"),
  blue:     esc("38;2;127;180;255"),
  violet:   esc("38;2;125;91;166"),
  lavender: esc("38;2;160;130;200"),
  sky:      esc("38;2;100;180;220"),
  sep:      esc("38;2;74;79;89"),
  empty:    esc("38;2;51;54;60"),
  teal:     esc("38;2;80;200;180"),
  pink:     esc("38;2;220;100;160"),
};

const stripAnsi = (s) =>
  s.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;]*m/g, "");

// ── Terminal width ────────────────────────────────────────────────────────────
function termWidth() {
  try {
    return process.stdout.columns ||
           (process.env.COLUMNS ? parseInt(process.env.COLUMNS, 10) : 0) ||
           80;
  } catch { return 80; }
}

// ── Display width (ANSI-aware, wide-char-aware) ────────────────────────────────
// stripAnsi(...).length counts code points, not on-screen columns. CJK, emoji and
// many full-width glyphs occupy 2 columns; account for them so padding and
// truncation stay aligned.
function cpWidth(cp) {
  if (
    (cp >= 0x1100 && cp <= 0x115F) ||
    (cp >= 0x2E80 && cp <= 0x303E) ||
    (cp >= 0x3040 && cp <= 0xA4CF) ||
    (cp >= 0xAC00 && cp <= 0xD7A3) ||
    (cp >= 0xF900 && cp <= 0xFAFF) ||
    (cp >= 0xFE10 && cp <= 0xFE19) ||
    (cp >= 0xFE30 && cp <= 0xFE4F) ||
    (cp >= 0xFF00 && cp <= 0xFF60) ||
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||
    (cp >= 0x1F300 && cp <= 0x1FAFF)
  ) return 2;
  return 1;
}

function visibleWidth(s) {
  let w = 0;
  for (const ch of stripAnsi(s)) w += cpWidth(ch.codePointAt(0));
  return w;
}

// Truncate an ANSI-colored string to `maxW` display columns, preserving escape
// sequences (they don't count toward width) and appending an ellipsis + reset so
// no color leaks past the cut.
function truncateAnsi(s, maxW) {
  const sgrRe = /^\x1b\[[0-9;]*m/;
  const oscRe = /^\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/;
  let out = "", w = 0, i = 0;
  while (i < s.length) {
    const sgr = s.slice(i).match(sgrRe);
    if (sgr) { out += sgr[0]; i += sgr[0].length; continue; }
    const osc = s.slice(i).match(oscRe);
    if (osc) { out += osc[0]; i += osc[0].length; continue; }
    const cp    = s.codePointAt(i);
    const chStr = String.fromCodePoint(cp);
    const cw    = cpWidth(cp);
    if (w + cw > maxW) break;
    out += chStr;
    w   += cw;
    i   += chStr.length;
  }
  // Close any hyperlink left open by the cut (harmless no-op otherwise), then reset.
  return out + "\x1b]8;;\x07" + "…" + R;
}

module.exports = { R, DIM, BLD, C, link, stripAnsi, termWidth, visibleWidth, truncateAnsi };
