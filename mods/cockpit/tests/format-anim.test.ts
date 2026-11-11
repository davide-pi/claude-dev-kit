import { expect, test } from 'claude-code/testing'

import { BEAT_FAST_MS, BEAT_LEVELS, BEAT_SLOW_MS, FADE_WINDOW_MS, FLASH_WINDOW_MS, beatSpeed, beatStep, frame, isAnimating, isBreathing, isFading, mixHex, reconcile, signalAnim } from '../hooks/anim'
import { COLORS } from '../hooks/shared'
import type { Span } from '../hooks/shared'

const icon: Span[] = [{ t: 'X', c: COLORS.red }]
const colorsOver = (kind: Parameters<typeof frame>[0], steps: number[], cells: Span[] = icon) => steps.map(step => frame(kind, step, cells)[0]?.c)

test('signalAnim: Given a blocking signal, When any age, Then it blinks while it stands; a new warn or info one flashes, an older one is still', () => {
  const NOW = 1_000_000
  expect(signalAnim('block', undefined, NOW)).toBe('blink')
  expect(signalAnim('block', NOW - 60_000, NOW)).toBe('blink')
  expect(signalAnim('warn', NOW - 1000, NOW)).toBe('flash3')
  expect(signalAnim('info', NOW, NOW)).toBe('flash3')
  expect(signalAnim('warn', NOW - (FLASH_WINDOW_MS - 1), NOW)).toBe('flash3')
  expect(signalAnim('warn', NOW - FLASH_WINDOW_MS, NOW)).toBeUndefined()
  expect(signalAnim('warn', undefined, NOW)).toBeUndefined()
})

test('isBreathing and isFading: Given the Claude state and a row age, When asked, Then only working or waiting breathe and only the first ~2 s fade', () => {
  expect(['working', 'waiting', 'idle', 'thinking', 'tool', undefined].map(isBreathing)).toEqual([true, true, false, false, false, false])
  expect(isFading(1000, 1000)).toBe(true)
  expect(isFading(1000, 1000 + FADE_WINDOW_MS - 1)).toBe(true)
  expect(isFading(1000, 1000 + FADE_WINDOW_MS)).toBe(false)
  expect(isFading(1000, 999)).toBe(false)
})

test('frame breathe: Given the state glyph, When a breath of ~2 s runs, Then its colour goes from dim up to full and back to dim', () => {
  const [start, quarter, half, back] = colorsOver('breathe', [0, 5, 11, 17])
  expect(start).toBe(COLORS.dim)
  expect(half).toBe(COLORS.red)
  expect(quarter).not.toBe(start)
  expect(quarter).not.toBe(half)
  expect(back).not.toBe(half)
  expect(frame('breathe', 22, icon)).toEqual(frame('breathe', 0, icon))
})

test('frame blink: Given a blocking icon, When steps pass, Then it alternates its own red and dim every six steps (~540 ms)', () => {
  expect(colorsOver('blink', [0, 5, 6, 11, 12])).toEqual([COLORS.red, COLORS.red, COLORS.dim, COLORS.dim, COLORS.red])
})

test('frame flash3: Given a new signal, When it plays, Then it flashes three times and stays lit and still after', () => {
  const lit = (step: number) => frame('flash3', step, icon)[0]?.c === COLORS.red
  const flashes = Array.from({ length: 24 }, (_, step) => lit(step))
  expect(flashes.filter((on, i) => on && (i === 0 || !flashes[i - 1])).length).toBe(3)
  expect(lit(24)).toBe(true)
  expect(lit(500)).toBe(true)
  expect(isAnimating('flash3', 23)).toBe(true)
  expect(isAnimating('flash3', 24)).toBe(false)
})

test('frame once: Given a changed value, When ~1.5 s pass, Then it is bold in the accent and then back to its own look', () => {
  const value: Span[] = [{ t: '$0.12', c: COLORS.red, bold: true }, { t: '   ' }]
  const [shown, pad] = frame('once', 0, value)
  expect(shown).toMatchObject({ t: '$0.12', c: COLORS.blue, bold: true })
  expect(pad).toEqual({ t: '   ' })
  expect(frame('once', 16, value)[0]?.c).toBe(COLORS.blue)
  expect(frame('once', 17, value)).toEqual(value)
  expect(isAnimating('once', 16)).toBe(true)
  expect(isAnimating('once', 17)).toBe(false)
})

test('frame fade: Given the newest FATTO row, When ~2 s pass, Then its colour steps from the highlight to its own, a dim cell untouched', () => {
  const row: Span[] = [{ t: '10:00', dim: true }, { t: 'ok', c: COLORS.green }]
  expect(frame('fade', 0, row)[0]).toEqual(row[0])
  expect(frame('fade', 0, row)[1]?.c).toBe(COLORS.blue)
  const mid = frame('fade', 11, row)[1]?.c
  expect(mid).not.toBe(COLORS.blue)
  expect(mid).not.toBe(COLORS.green)
  expect(frame('fade', 22, row)).toEqual(row)
  expect(isAnimating('fade', 22)).toBe(false)
})

test('frame spin: Given a running agent, When steps pass, Then the braille frame advances and wraps after ten, keeping the icon colour', () => {
  const cells: Span[] = [{ t: '󱎖', c: COLORS.blue }, { t: ' ' }]
  expect(frame('spin', 0, cells)).toEqual([{ t: '⠋', c: COLORS.blue }, { t: ' ' }])
  expect(frame('spin', 9, cells)[0]?.t).toBe('⠏')
  expect(frame('spin', 10, cells)[0]?.t).toBe('⠋')
  expect(isAnimating('spin', 1_000_000)).toBe(true)
})

test('reconcile: Given the readings of a value, When the first one comes, Then no animation; a change restarts it, the same value does not', () => {
  const first = reconcile(undefined, 'once', '$0.12')
  expect(isAnimating('once', first.step)).toBe(false)
  expect(reconcile(first, 'once', '$0.12')).toBe(first)
  const changed = reconcile(first, 'once', '$0.15')
  expect(changed).toEqual({ kind: 'once', step: 0, token: '$0.15' })
  expect(isAnimating('once', changed.step)).toBe(true)
  // a value that went missing and came back is a reading, not a change
  expect(reconcile(reconcile(first, 'once', undefined), 'once', '$0.20').step).toBe(first.step)
  expect(reconcile(first, 'blink').step).toBe(0)
})

test('mixHex: Given two colours, When mixed, Then the channels move proportionally; a colour that is not a hex stays the target', () => {
  expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000')
  expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff')
  expect(mixHex('#000000', '#ff8000', 0.5)).toBe('#804000')
  expect(mixHex('#000000', 'subtle', 0.5)).toBe('subtle')
})

test('beatSpeed: Given a figure colour, When it is green, Then it is quiet; the middle band is slow, red is fast, an unknown colour is quiet', () => {
  // Given / When / Then
  expect(beatSpeed(COLORS.green)).toBeUndefined()
  expect(beatSpeed(COLORS.yellow)).toBe('slow')
  expect(beatSpeed(COLORS.amber)).toBe('slow')
  expect(beatSpeed(COLORS.orange)).toBe('slow')
  expect(beatSpeed(COLORS.red)).toBe('fast')
  expect(beatSpeed(undefined)).toBeUndefined()
  expect(beatSpeed(COLORS.blue)).toBeUndefined()
})

test('beatStep: Given the clock, When a period goes by, Then the beat brightens and darkens smoothly: lit at the start, darkest at the middle, through every level in between', () => {
  // Given
  const t0 = 1_000 * BEAT_SLOW_MS
  // When
  const slow = Array.from({ length: 33 }, (_, i) => beatStep('slow', t0 + (i * BEAT_SLOW_MS) / 32))
  // Then
  expect(BEAT_FAST_MS * 2).toBe(BEAT_SLOW_MS)
  expect(slow[0]).toBe(0)
  expect(slow[16]).toBe(BEAT_LEVELS)
  expect(slow[32]).toBe(0)
  expect(new Set(slow).size).toBe(BEAT_LEVELS + 1)
  slow.forEach((v, i) => expect(Math.abs(v - (slow[i - 1] ?? v))).toBeLessThanOrEqual(1))
  expect([0, BEAT_FAST_MS / 2, BEAT_FAST_MS].map(d => beatStep('fast', t0 + d))).toEqual([0, BEAT_LEVELS, 0])
})

test('beatStep: Given two beats mounted at different moments, When the clock reads the same, Then both are in the same step', () => {
  // Given: the step comes from the clock alone, so the moment of mounting does not enter it
  const mountedA = reconcile(undefined, 'beat', undefined, 'slow')
  const mountedB = { ...reconcile(undefined, 'beat', undefined, 'slow'), step: 1 }
  // When
  const now = 5_000_000 + 1234
  // Then
  expect(mountedA.speed).toBe('slow')
  expect(beatStep(mountedA.speed, now)).toBe(beatStep(mountedB.speed, now))
})

test('frame: Given a beat, When its level goes from lit to darkest, Then the colour fades step by step towards the page grey, never reaching it', () => {
  // Given / When
  const shades = Array.from({ length: BEAT_LEVELS + 1 }, (_, k) => frame('beat', k, icon)[0]?.c)
  // Then
  expect(shades[0]).toBe(COLORS.red)
  expect(shades[BEAT_LEVELS]).toBe(mixHex(COLORS.red, COLORS.empty, 0.85))
  expect(BEAT_LEVELS).toBe(12)
  expect(new Set(shades).size).toBe(BEAT_LEVELS + 1)
  expect(isAnimating('beat', 1_000_000)).toBe(true)
})
