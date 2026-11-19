import { expect, test } from 'claude-code/testing'

import { barSvg, donutSvg, iconSvg, railSvg } from '../hooks/desk-svg'

const C = 2 * Math.PI * 44
const round2 = (n: number): number => Math.round(n * 100) / 100
const dash =(svg: string): number => Number(/stroke-dasharray="([\d.]+) /.exec(svg)?.[1])

test('Given 0, 70 and 100 percent, When donutSvg is built, Then the arc dash is 0, 0.7C and C of the circumference', () => {
  // Given
  const percents = [0, 70, 100]
  // When
  const dashes = percents.map(percent => dash(donutSvg({ percent, color: '#F2A65A' })))
  // Then
  expect(dashes[0]).toBe(0)
  expect(dashes[1]).toBe(round2(0.7 * C))
  expect(dashes[2]).toBe(round2(C))
})

test('Given percent NaN, negative or above 100, When built, Then it is clamped to 0..100', () => {
  // Given / When
  const [nan, below, above] = [Number.NaN, -20, 250].map(percent => dash(donutSvg({ percent, color: '#fff' })))
  // Then
  expect(nan).toBe(0)
  expect(below).toBe(0)
  expect(above).toBe(round2(C))
})

test('Given no threshold, When built, Then there is no tick element; Given threshold 0.95, Then the tick sits at 342 degrees', () => {
  // Given / When
  const plain = donutSvg({ percent: 50, color: '#fff' })
  const ticked = donutSvg({ percent: 50, threshold: 0.95, color: '#fff' })
  // Then
  expect(plain).not.toContain('<line')
  expect(ticked).toContain('<line')
  expect(ticked).toContain('rotate(342 60 60)')
})

test('Given the donut, When built, Then it has the board geometry and the cache ring only when a cache percent is given', () => {
  // Given / When
  const svg = donutSvg({ percent: 40, color: '#5EC8C2' })
  const cached = donutSvg({ percent: 40, cachePct: 71, color: '#5EC8C2' })
  // Then
  for (const part of ['viewBox="0 0 120 120"', 'r="44"', 'stroke-width="11"', '#3A3936', 'rotate(-90 60 60)', '#5EC8C2']) expect(svg).toContain(part)
  expect(svg.match(/<circle/g)).toHaveLength(2)
  expect(cached.match(/<circle/g)).toHaveLength(4)
})

test('Given a bar, When built, Then it is 8 high with preserveAspectRatio none, the left share filled and the pace mark only when given', () => {
  // Given / When
  const bar = barSvg({ left: 40, color: '#7CC79A' })
  const paced = barSvg({ left: 40, pace: 60, color: '#7CC79A' })
  const over = barSvg({ left: 400, color: '#7CC79A' })
  // Then
  for (const part of ['viewBox="0 0 260 8"', 'height="8"', 'preserveAspectRatio="none"', 'width="104"', '#7CC79A']) expect(bar).toContain(part)
  expect(bar).not.toContain('<line')
  expect(paced).toContain('<line')
  expect(paced).toContain('x1="156"')
  expect(over).toContain('width="260"')
})

test('Given a known icon name, When built, Then it is an svg in the given colour; Given an unknown one, Then it is an empty-but-valid svg of the same size', () => {
  // Given / When
  const known = iconSvg('clock', '#B9A2FF')
  const unknown = iconSvg('no-such-icon', '#B9A2FF')
  // Then
  expect(known).toContain('#B9A2FF')
  expect(known).toContain('<path')
  expect(unknown).toMatch(/^<svg [^>]*><\/svg>$/)
  expect(unknown.match(/width="\d+"/)?.[0]).toBe(known.match(/width="\d+"/)?.[0])
  expect(unknown.match(/height="\d+"/)?.[0]).toBe(known.match(/height="\d+"/)?.[0])
})

test('Given six open lanes, When built, Then width is 86', () => {
  // Given
  const lanes = [0, 1, 2, 3, 4, 5].map(lane => ({ lane, kind: 'through' as const }))
  // When
  const svg = railSvg({ lanes })
  // Then
  expect(svg).toContain('width="86"')
  expect(svg).toContain('height="28"')
  expect(svg.match(/<line/g)).toHaveLength(7)
})

test('Given lane 9, When built, Then it is drawn in the last lane with a + mark and width stays 86', () => {
  // Given / When
  const svg = railSvg({ lanes: [{ lane: 9, kind: 'start' }] })
  // Then
  expect(svg).toContain('width="86"')
  expect(svg).toContain('x1="81"')
  expect(svg).not.toContain('x1="111"')
  expect(svg).toContain('>+</text>')
})

test('Given no lanes, When built, Then only the session rail is drawn', () => {
  // Given / When
  const svg = railSvg({ lanes: [], dot: 'session' })
  // Then
  expect(svg).toContain('width="86"')
  expect(svg).toContain('#51467A')
  expect(svg.match(/<line/g)).toHaveLength(1)
  expect(svg).toContain('<circle')
  expect(svg).not.toContain('<text')
})

test('Given a lane dot and a custom height, When built, Then the dot sits in its lane colour and the height is used', () => {
  // Given / When
  const svg = railSvg({ lanes: [{ lane: 1, kind: 'dot' }], dot: 1, height: 40 })
  // Then
  expect(svg).toContain('height="40"')
  expect(svg).toContain('#8FB4F5')
  expect(svg).toContain('cx="31"')
})
