/** Pure builders of the desktop page's Svg sources: no animation, no state. The caller passes the string as an `Svg` element's `source`. */

const TRACK = '#3A3936'
const SESSION_RAIL = '#51467A'
const LANE_COLORS = ['#5EC8C2', '#8FB4F5', '#E5B454', '#F2A65A', '#B9A2FF']
const MAX_LANES = 7
const RAIL_WIDTH = 86
const RAIL_ROW = 28
const DONUT_R = 44

/** A number as the shortest text of at most two decimals. */
const num = (n: number): string => String(Math.round(n * 100) / 100)

/** `n` held to `min..max`; NaN reads as `min`. */
const clamp = (n: number, min: number, max: number): number => (Number.isNaN(n) ? min : Math.min(max, Math.max(min, n)))

/** A colour as it may reach an attribute: a hex value, else a fixed grey. */
const safe = (color: string): string => (/^#[0-9a-f]{3,8}$/i.test(color) ? color : '#9A9791')

/** A ring of the context donut: the track, then the arc of `percent` from the top, clockwise; no arc at 0 (a zero dash with a round cap would draw a dot). */
const ring = (r: number, width: number, percent: number, color: string): string => {
  const c = 2 * Math.PI * r
  const filled = clamp(percent, 0, 100)
  return (
    `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${TRACK}" stroke-width="${width}"/>` +
    (filled === 0 ? '' : `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${safe(color)}" stroke-width="${width}" stroke-linecap="round" stroke-dasharray="${num(c * filled / 100)} ${num(c)}" transform="rotate(-90 60 60)"/>`)
  )
}

/** The context donut: `percent` of the ring filled in `color`; a tick at `threshold` (0..1 of the turn) when given. */
export function donutSvg(o: { percent: number; threshold?: number; color: string }): string {
  const tick = o.threshold === undefined ? '' : `<line x1="60" y1="23" x2="60" y2="9" stroke="#FF5A4F" stroke-width="3" stroke-linecap="round" transform="rotate(${num(clamp(o.threshold, 0, 1) * 360)} 60 60)"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">${ring(DONUT_R, 11, o.percent, o.color)}${tick}</svg>`
}

/** The bar markup's own width: wider than any pane, so an `Svg` drawn without `width` takes its whole slot (the engine caps the markup's width at the slot). */
const BAR_MARKUP_PX = 2000

/** A bar of `left` percent in `color`, with a pace mark at `pace` percent when given; stretched to its slot, the mark, taller than the bar, keeps a 3px stroke on a dark halo. */
export function barSvg(o: { left: number; pace?: number; color: string }): string {
  const fill = `<rect x="0" y="3" width="${num(clamp(o.left, 0, 100) * 2.6)}" height="8" rx="4" fill="${safe(o.color)}"/>`
  const x = o.pace === undefined ? '' : num(clamp(o.pace, 0, 100) * 2.6)
  const mark = o.pace === undefined ? '' : `<line x1="${x}" y1="0" x2="${x}" y2="14" stroke="#1A1A19" stroke-width="7" vector-effect="non-scaling-stroke"/><line x1="${x}" y1="0" x2="${x}" y2="14" stroke="#FFFFFF" stroke-width="3" vector-effect="non-scaling-stroke"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BAR_MARKUP_PX}" height="14" viewBox="0 0 260 14" preserveAspectRatio="none"><rect x="0" y="3" width="260" height="8" rx="4" fill="${TRACK}"/>${fill}${mark}</svg>`
}

/** A small share bar, 84 by 6: `pct` of it filled in `color` on the track; no fill at 0. */
export function shareSvg(pct: number, color: string): string {
  const w = num(clamp(pct, 0, 100) * 0.84)
  const fill = w === '0' ? '' : `<rect x="0" y="0" width="${w}" height="6" rx="3" fill="${safe(color)}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="84" height="6" viewBox="0 0 84 6"><rect x="0" y="0" width="84" height="6" rx="3" fill="#45443F"/>${fill}</svg>`
}

const ICONS: Record<string, string> = {
  clock: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2Zm0 3v3l2 1.5',
  check: 'M3 8.5l3.2 3.2L13 4.8',
  alert: 'M8 2.5l6 10.5H2L8 2.5Zm0 4.5v3m0 1.8v.2',
  flow: 'M4 3v10m0-8h5a3 3 0 0 1 3 3v5',
}

/** A 16px stroke icon in `color`; a name that is not one of the few gives an empty svg of the same size. */
export function iconSvg(name: string, color: string): string {
  const path = Object.hasOwn(ICONS, name) ? ICONS[name] : undefined
  const body = path === undefined ? '' : `<path d="${path}" fill="none" stroke="${safe(color)}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">${body}</svg>`
}

export type LaneCell = { lane: number; kind: 'start' | 'through' | 'end' | 'dot'; color?: string }

/** The log's rail, always 86 wide: the session rail (16px) and up to 7 lanes of 10px; a lane past the last is drawn in it with a + mark. */
export function railSvg(o: { lanes: LaneCell[]; dot?: 'session' | number; height?: number }): string {
  const h = o.height ?? RAIL_ROW
  const mid = h / 2
  const laneX = (lane: number): number => 21 + 10 * Math.min(Math.max(lane, 0), MAX_LANES - 1)
  const laneColor = (c: LaneCell): string => (c.color !== undefined ? safe(c.color) : undefined) ?? LANE_COLORS[Math.max(c.lane, 0) % LANE_COLORS.length] ?? LANE_COLORS[0] ?? '#5EC8C2'
  const parts = [`<line x1="7" y1="0" x2="7" y2="${h}" stroke="${SESSION_RAIL}" stroke-width="2"/>`]
  for (const c of o.lanes) {
    const x = laneX(c.lane)
    const color = laneColor(c)
    const [y1, y2] = c.kind === 'start' ? [mid, h] : c.kind === 'end' ? [0, mid] : c.kind === 'through' ? [0, h] : [undefined, undefined]
    if (y1 !== undefined && y2 !== undefined) parts.push(`<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${color}" stroke-width="2"/>`)
    if (c.kind !== 'through') parts.push(`<circle cx="${x}" cy="${mid}" r="3" fill="${color}"/>`)
    // beside the circle, at the right edge of the rail, in the text colour: on it the + would vanish
    if (c.lane >= MAX_LANES) parts.push(`<text x="${RAIL_WIDTH}" y="${mid + 2.5}" font-size="7" font-weight="700" text-anchor="end" fill="#F2F0EA">+</text>`)
  }
  if (o.dot === 'session') parts.push(`<circle cx="7" cy="${mid}" r="5" fill="#B9A2FF"/>`)
  else if (o.dot !== undefined) parts.push(`<circle cx="${laneX(o.dot)}" cy="${mid}" r="5" fill="${laneColor({ lane: o.dot, kind: 'dot' })}"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${RAIL_WIDTH}" height="${h}" viewBox="0 0 ${RAIL_WIDTH} ${h}">${parts.join('')}</svg>`
}
