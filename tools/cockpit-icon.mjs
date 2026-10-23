#!/usr/bin/env node
// Generates mods/cockpit/.claude-plugin/icon.png (512x512, the I1 dial): no dependencies.
// Usage: node tools/cockpit-icon.mjs [output.png]
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 512
const SS = 4 // supersampling per axis
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const BG = hex('#17161c')
const BORDER = hex('#5b4580')
const GREEN = hex('#7ec699')
const AMBER = hex('#e8a35a')
const RED = hex('#f07a6f')
const NEEDLE = hex('#e8dcff')

const C = SIZE / 2
const CY = 292 // dial centre, a bit below the middle: the arc is the top half
const R_OUT = 190
const R_IN = 142
const START = Math.PI // 180 deg (left), sweeping over the top to 0 (right)
const sweep = frac => START + frac * Math.PI // angle in screen space (y down): top is 3*PI/2
const NEEDLE_FRAC = 0.58 // into the amber segment (1/3..2/3)
const GAP = 0.012 // fraction of the sweep left between segments

// signed distance to a rounded square: negative inside
const sdRound = (x, y, half, r) => {
  const qx = Math.abs(x - C) - (half - r)
  const qy = Math.abs(y - C) - (half - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

// distance from a point to a segment
const sdSeg = (px, py, ax, ay, bx, by, w) => {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy) - w
}

const segments = [
  [0, 1 / 3, GREEN],
  [1 / 3, 2 / 3, AMBER],
  [2 / 3, 1, RED],
]

// colour of one sample point, or null for transparent
const sample = (x, y) => {
  if (sdRound(x, y, 248, 96) > 0) return null
  let col = sdRound(x, y, 248, 96) > -14 ? BORDER : BG
  const dx = x - C, dy = y - CY
  const r = Math.hypot(dx, dy)
  if (r >= R_IN && r <= R_OUT && dy <= 0) {
    // angle 0 at the left, 1 at the right, over the top
    const frac = Math.atan2(-dy, -dx) / Math.PI
    for (const [a, b, c] of segments) if (frac >= a + GAP / 2 && frac <= b - GAP / 2) col = c
  }
  const ang = sweep(NEEDLE_FRAC)
  const tipx = C + Math.cos(ang) * 150, tipy = CY + Math.sin(ang) * 150
  if (sdSeg(x, y, C, CY, tipx, tipy, 9) <= 0) col = NEEDLE
  if (r <= 30) col = NEEDLE
  if (r <= 12) col = BG
  return col
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let py = 0; py < SIZE; py++) {
  raw[py * (SIZE * 4 + 1)] = 0
  for (let px = 0; px < SIZE; px++) {
    let r = 0, g = 0, b = 0, n = 0
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = sample(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS)
        if (c) { r += c[0]; g += c[1]; b += c[2]; n++ }
      }
    }
    const o = py * (SIZE * 4 + 1) + 1 + px * 4
    if (n) { raw[o] = Math.round(r / n); raw[o + 1] = Math.round(g / n); raw[o + 2] = Math.round(b / n) }
    raw[o + 3] = Math.round((255 * n) / (SS * SS))
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = buf => {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const out = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'mods', 'cockpit', '.claude-plugin', 'icon.png')
writeFileSync(out, png)
console.log(`${out} (${png.length} bytes)`)
