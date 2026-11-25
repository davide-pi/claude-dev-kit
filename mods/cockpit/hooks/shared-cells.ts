/** Cut the middle of a string to `max` cells with an ellipsis; short strings are untouched. */
export function truncMiddle(s: string, max: number): string {
  const chars = [...s]
  if (chars.length <= max) return s
  if (max <= 1) return max === 1 ? '…' : ''
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = keep - head
  return chars.slice(0, head).join('') + '…' + chars.slice(chars.length - tail).join('')
}

/** Terminal cells of one character: 2 for CJK, fullwidth and emoji, 0 for combining and zero-width marks, else 1. */
export function cellWidth(ch: string): number {
  const c = ch.codePointAt(0) ?? 0
  if ((c >= 0x300 && c <= 0x36f) || (c >= 0x200b && c <= 0x200f) || (c >= 0xfe00 && c <= 0xfe0f)) return 0
  const isWide =
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe6f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x1f300 && c <= 0x1faff) ||
    (c >= 0x20000 && c <= 0x3fffd)
  return isWide ? 2 : 1
}

export const textCells = (s: string): number => [...s].reduce((n, ch) => n + cellWidth(ch), 0)

/** The longest start of `s` that fits `max` cells. */
export function takeCells(s: string, max: number): string {
  let out = ''
  let used = 0
  for (const ch of s) {
    const w = cellWidth(ch)
    if (used + w > max) break
    out += ch
    used += w
  }
  return out
}

/** `s` cut where its start fits `max` cells, at the last space of that start when it has one: the start, and the rest without its leading spaces. */
export function splitCells(s: string, max: number): [string, string] {
  if (textCells(s) <= max) return [s, '']
  // At least one character, so a wide one under a narrow `max` still moves the cut on
  const head = takeCells(s, Math.max(1, max)) || ([...s][0] ?? '')
  const space = s[head.length] === ' ' ? head.length : head.lastIndexOf(' ')
  const cut = space > 1 ? space : head.length
  return [s.slice(0, cut), s.slice(cut).trimStart()]
}

/** `s` in lines of at most `max` cells, broken at spaces where it can be. */
export function wrapCells(s: string, max: number): string[] {
  const out: string[] = []
  let rest = s
  while (rest !== '') {
    const [head, tail] = splitCells(rest, max)
    out.push(head)
    rest = tail
  }
  return out
}

/** Cut the end of a string to `max` cells with an ellipsis; short strings are untouched. */
export function truncEnd(s: string, max: number): string {
  if (textCells(s) <= max) return s
  if (max <= 0) return ''
  return takeCells(s, max - 1) + '…'
}

/** Pads with spaces to `n` cells. */
export const padCells = (s: string, n: number): string => s + ' '.repeat(Math.max(0, n - textCells(s)))
