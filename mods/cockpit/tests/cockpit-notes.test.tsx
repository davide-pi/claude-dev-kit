import { expect, test } from 'claude-code/testing'

import { textCells, wrapCells } from '../hooks/shared'
import { setLang } from '../hooks/strings'
import { IT_FILE, keysInOrder, mountPane, noteKeys, notesPane, saveNote, settleAll } from './cockpit-fixtures'
import { dataOf, rowTexts, world } from './cockpit-world'
import type { World } from './cockpit-world'

test('notes: the field is on the Notes tab only, under the tab bar; the list starts empty and says so', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 58)
  for (const tab of ['agents', 'context', 'signals', 'work']) {
    await ui.press({ key: `tab:${tab}` })
    expect(await ui.find({ type: 'Input', key: 'note' })).toBeUndefined()
  }
  await ui.press({ key: 'tab:notes' })
  const input = await ui.find({ type: 'Input', key: 'note' })
  expect(input?.props.rows).toBe(2)
  expect(input?.props.value).toBe('')
  const keys = keysInOrder(await ui.drawn())
  expect(keys.indexOf('note')).toBeGreaterThan(keys.indexOf('tab:notes'))
  expect(keys.indexOf('note')).toBeLessThan(keys.indexOf('bar:compact'))
  expect(await ui.find({ key: 'bar:note' })).toBeUndefined()
  const rows = rowTexts(await ui.drawn())
  expect(rows).toContain('NOTES · 0')
  expect(rows).toContain('no saved notes')
  await ui.unmount()
})

test('notes: Input + save adds a note at the end of the list and empties the field; Enter saves the same way; a blank field adds nothing', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await notesPane($)
  await saveNote(ui, '   ')
  expect(await noteKeys(ui, 'send')).toEqual([])
  await saveNote(ui, 'ask Anna\nabout the filter')
  expect((await ui.find({ type: 'Input', key: 'note' }))?.props.value).toBe('')
  expect(await noteKeys(ui, 'send')).toEqual(['note:send:1'])
  await ui.input({ key: 'note', text: 'call back', kind: 'submit' })
  await settleAll()
  expect(await noteKeys(ui, 'send')).toEqual(['note:send:1', 'note:send:2'])
  const rows = rowTexts(await ui.drawn())
  expect(rows).toContain('NOTES · 2')
  // a note shows its first 3 lines whole: two lines are all there, no expander
  expect((await ui.find({ type: 'Text', text: /^ask Anna/ }))?.text).toBe('ask Anna\nabout the filter')
  expect(await ui.find({ key: 'note:more:1' })).toBeUndefined()
  expect(rows.some(r => r.startsWith('call back'))).toBe(true)
  await ui.unmount()
})

test('notes: edit opens an Input on the note\'s own row (the bottom field is hidden), then submit replaces that note and no other and leaves it closed', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await notesPane($)
  await saveNote(ui, 'first')
  await saveNote(ui, 'second')
  await ui.press({ key: 'note:edit:1' })
  await settleAll()
  expect((await ui.find({ type: 'Input', key: 'note:edit-field' }))?.props.value).toBe('first')
  expect(await ui.find({ type: 'Input', key: 'note' })).toBeUndefined()
  expect(await ui.find({ key: 'note:toggle:1' })).toBeUndefined()
  expect(await ui.find({ key: 'note:toggle:2' })).toBeDefined()
  await ui.input({ key: 'note:edit-field', text: 'first, amended\nand its second line', kind: 'submit' })
  await settleAll()
  expect(await ui.find({ key: 'note:edit-field' })).toBeUndefined()
  expect((await ui.find({ type: 'Input', key: 'note' }))?.props.value).toBe('')
  expect(await noteKeys(ui, 'edit')).toEqual(['note:edit:1', 'note:edit:2'])
  const rows = rowTexts(await ui.drawn())
  expect(rows.some(r => r.startsWith('first, amended\nand its second line'))).toBe(true)
  expect(rows.some(r => r.startsWith('second'))).toBe(true)
  expect(rows.some(r => /^first(?!,)/.test(r))).toBe(false)
  // the field is free again: the next save is a new note
  await saveNote(ui, 'third')
  expect(await noteKeys(ui, 'edit')).toEqual(['note:edit:1', 'note:edit:2', 'note:edit:3'])
  await ui.unmount()
})

test('notes: cancel (the edit button, now the close icon) leaves the note unchanged and the row collapsed', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await notesPane($)
  await saveNote(ui, 'first')
  await ui.press({ key: 'note:edit:1' })
  await settleAll()
  expect((await ui.find({ key: 'note:edit:1' }))?.text).toBe('\u{F0156}')
  await ui.input({ key: 'note:edit-field', text: 'changed', kind: 'change' })
  await settleAll()
  await ui.press({ key: 'note:edit:1' })
  await settleAll()
  expect(await ui.find({ key: 'note:edit-field' })).toBeUndefined()
  expect((await ui.find({ type: 'Input', key: 'note' }))?.props.value).toBe('')
  expect((await ui.find({ key: 'note:edit:1' }))?.text).toBe('\u{F03EB}')
  expect(rowTexts(await ui.drawn()).some(r => r.startsWith('first'))).toBe(true)
  expect(rowTexts(await ui.drawn()).some(r => r.startsWith('changed'))).toBe(false)
  await ui.unmount()
})

test('notes: while a note is edited its row shows save in place of send, right-aligned; save replaces the note', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await notesPane($)
  await saveNote(ui, 'first')
  await ui.press({ key: 'note:edit:1' })
  await settleAll()
  expect(await ui.find({ key: 'note:send:1' })).toBeUndefined()
  expect((await ui.find({ key: 'note:save:1' }))?.text).toBe('\u{F0193}')
  const icons = holderProps(await ui.drawn(), 'note:save:1')
  expect([icons?.flexGrow, icons?.justifyContent]).toEqual([1, 'flex-end'])
  await ui.input({ key: 'note:edit-field', text: 'changed', kind: 'change' })
  await settleAll()
  await ui.press({ key: 'note:save:1' })
  await settleAll()
  expect(await ui.find({ key: 'note:edit-field' })).toBeUndefined()
  expect(await noteKeys(ui, 'send')).toEqual(['note:send:1'])
  expect(rowTexts(await ui.drawn()).some(r => r.startsWith('changed'))).toBe(true)
  await ui.unmount()
})

test('notes: emptying the edit field keeps the edit open and the note unchanged until cancelled', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await notesPane($)
  await saveNote(ui, 'first')
  await ui.press({ key: 'note:edit:1' })
  await settleAll()
  await ui.input({ key: 'note:edit-field', text: '', kind: 'change' })
  await settleAll()
  expect((await ui.find({ key: 'note:edit-field' }))?.props.value).toBe('')
  await ui.press({ key: 'note:edit:1' })
  await settleAll()
  expect(await ui.find({ key: 'note:edit-field' })).toBeUndefined()
  expect(rowTexts(await ui.drawn()).some(r => r.startsWith('first'))).toBe(true)
  await ui.unmount()
})

test('notes: send appends the note to the prompt box, after a newline only when the box already holds text, and the note stays in the list', async ($, on) => {
  const fills: { text: string; mode?: string }[] = []
  const options: World = { fills }
  world(on, options)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await notesPane($)
  await saveNote(ui, 'ask Anna')
  await ui.press({ key: 'note:send:1' })
  await settleAll()
  expect(fills).toEqual([{ text: 'ask Anna', mode: 'append' }]) // an empty box: no leading newline
  options.promptText = 'draft in the box'
  await ui.press({ key: 'note:send:1' })
  await settleAll()
  expect(fills.at(-1)).toEqual({ text: '\nask Anna', mode: 'append' })
  options.promptReadFails = true // a box that cannot be read counts as holding text
  await ui.press({ key: 'note:send:1' })
  await settleAll()
  expect(fills.at(-1)).toEqual({ text: '\nask Anna', mode: 'append' })
  expect(await noteKeys(ui, 'send')).toEqual(['note:send:1'])
  await ui.unmount()
})

test('notes: a prompt box that refuses the text (a dialog holds the keys) leaves the note in the list', async ($, on) => {
  const fills: { text: string; mode?: string }[] = []
  world(on, { fills, fillRefused: true })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await notesPane($)
  await saveNote(ui, 'ask Anna')
  await ui.press({ key: 'note:send:1' })
  await settleAll()
  expect(fills).toHaveLength(1)
  expect(await noteKeys(ui, 'send')).toEqual(['note:send:1'])
  await ui.unmount()
})

test('notes: delete removes the note; deleting the one in the field leaves the next save a new note', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await notesPane($)
  await saveNote(ui, 'one')
  await saveNote(ui, 'two')
  await ui.press({ key: 'note:delete:1' })
  await settleAll()
  expect(await noteKeys(ui, 'delete')).toEqual(['note:delete:1', 'note:delete:2']) // asked, not yet gone
  await ui.press({ key: 'confirm:no' })
  await settleAll()
  expect(await ui.find({ key: 'confirm:yes' })).toBeUndefined()
  expect(await noteKeys(ui, 'delete')).toEqual(['note:delete:1', 'note:delete:2'])
  await ui.press({ key: 'note:delete:1' })
  await ui.press({ key: 'confirm:yes' })
  await settleAll()
  expect(await noteKeys(ui, 'delete')).toEqual(['note:delete:2'])
  await ui.press({ key: 'note:edit:2' })
  await ui.press({ key: 'note:delete:2' })
  await ui.press({ key: 'confirm:yes' })
  await settleAll()
  expect(await noteKeys(ui, 'delete')).toEqual([])
  expect(rowTexts(await ui.drawn())).toContain('no saved notes')
  await saveNote(ui, 'kept text')
  expect(await noteKeys(ui, 'delete')).toEqual(['note:delete:1'])
  await ui.unmount()
})

type Drawn = { props?: { key?: string; width?: number; plain?: boolean; flexGrow?: number; justifyContent?: string }; children?: unknown[] } | null

/** The props of the node keyed `key`, found in the drawn tree. */
function propsOf(node: unknown, key: string): NonNullable<Drawn>['props'] | undefined {
  const o = node as Drawn
  if (o?.props?.key === key) return o.props
  for (const c of o?.children ?? []) {
    const found = propsOf(c, key)
    if (found !== undefined) return found
  }
  return undefined
}

/** The width of the box that holds the Button keyed `key`, found in the drawn tree. */
function toggleBoxWidth(node: unknown, key: string): number | undefined {
  const o = node as Drawn
  for (const c of o?.children ?? []) {
    if ((c as Drawn)?.props?.key === key) return o?.props?.width
    const found = toggleBoxWidth(c, key)
    if (found !== undefined) return found
  }
  return undefined
}

/** The props of the box that holds the Button keyed `key`, found in the drawn tree. */
function holderProps(node: unknown, key: string): NonNullable<Drawn>['props'] | undefined {
  const o = node as Drawn
  for (const c of o?.children ?? []) {
    if ((c as Drawn)?.props?.key === key) return o?.props
    const found = holderProps(c, key)
    if (found !== undefined) return found
  }
  return undefined
}

test('notes: every note has its three buttons, in the pane width at 30, 40 and 58 columns, in both languages', async ($, on) => {
  const options: World = { dataFile: JSON.stringify({ history: [], prs: [], notes: [{ id: 4, text: 'ask Anna' }] }) }
  world(on, options)
  for (const files of [{}, IT_FILE]) {
    options.files = files
    try {
      await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
      for (const columns of [30, 40, 58]) {
        const ui = await notesPane($, columns)
        for (const key of ['note:edit:4', 'note:send:4', 'note:delete:4', 'bar:compact']) expect(await ui.find({ key })).toBeDefined()
        // the text's box leaves the icons their columns: a cut note never runs under them
        const textWidth = toggleBoxWidth(await ui.drawn(), 'note:toggle:4')
        expect(typeof textWidth).toBe('number')
        expect((textWidth as number) + 19).toBeLessThanOrEqual(columns)
        expect(textWidth as number).toBeGreaterThanOrEqual(columns - 24)
        // the icons are drawn as framed buttons (`[ x ]`), not bare glyphs
        for (const key of ['note:edit:4', 'note:send:4', 'note:delete:4']) expect(propsOf(await ui.drawn(), key)?.plain).toBeFalsy()
        expect(propsOf(await ui.drawn(), 'note:toggle:4')?.plain).toBe(true)
        await ui.unmount()
      }
    } finally {
      setLang('en')
    }
  }
})

// ── Phase 9: Notes ──

test('notes: a saved note, new or edited, is closed', async ($, on) => {
  world(on, { dataFile: JSON.stringify({ history: [], prs: [], notes: [{ id: 1, text: 'l1\nl2\nl3\nl4\nl5' }] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await notesPane($)
  const texts = async () => (await ui.findAll({ type: 'Text' })).map(n => n.text)
  await ui.press({ key: 'note:toggle:1' })
  await settleAll()
  expect(await texts()).toContain('l1\nl2\nl3\nl4\nl5')
  await ui.press({ key: 'note:edit:1' })
  await settleAll()
  await ui.input({ key: 'note:edit-field', text: 'm1\nm2\nm3\nm4\nm5\nm6', kind: 'submit' })
  await settleAll()
  expect(await texts()).toContain('m1\nm2\nm3…')
  await saveNote(ui, 'n1\nn2\nn3\nn4')
  expect(await texts()).toContain('n1\nn2\nn3…')
  await ui.unmount()
})

test('notes: a note shows its first 3 lines, the third ending with … when more follow, and no +N button; a press on the text opens and closes it', async ($, on) => {
  world(on, { dataFile: JSON.stringify({ history: [], prs: [], notes: [{ id: 1, text: 'one\ntwo\nthree\nfour\nfive' }, { id: 2, text: 'a\nb' }, { id: 3, text: 'single' }] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await notesPane($)
  const texts = async () => (await ui.findAll({ type: 'Text' })).map(n => n.text)
  expect(await texts()).toContain('one\ntwo\nthree…')
  expect(await texts()).toContain('a\nb')
  expect(await texts()).toContain('single')
  for (const id of [1, 2, 3]) expect(await ui.find({ key: `note:more:${id}` })).toBeUndefined()
  await ui.press({ key: 'note:toggle:1' })
  await settleAll()
  expect(await texts()).toContain('one\ntwo\nthree\nfour\nfive') // one Text: the Button cannot lay the lines side by side
  expect(await texts()).toContain('a\nb') // the others stay as they were
  await ui.press({ key: 'note:toggle:1' }) // a second press closes it
  await settleAll()
  expect(await texts()).toContain('one\ntwo\nthree…')
  expect(await texts()).not.toContain('five')
  await ui.unmount()
})

test('notes: a closed note cuts a long line with …, opened it wraps in full inside its column; the icon buttons are inline and alternate rows have a band', async ($, on) => {
  const long = 'a very long line of a note that cannot fit in a narrow pane of the cockpit at all'
  world(on, { dataFile: JSON.stringify({ history: [], prs: [], notes: [{ id: 1, text: `${long}\nmore` }, { id: 2, text: 'second' }, { id: 3, text: long }] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await notesPane($, 40)
  const shown = await ui.findAll({ type: 'Text', text: /^a very long/ })
  expect(shown.map(n => n.text.split('\n').length)).toEqual([2, 1]) // one row per line, never wrapped while closed
  for (const n of shown) expect(n.text.split('\n')[0]).toMatch(/…$/)
  const textW = Number(toggleBoxWidth(await ui.drawn(), 'note:toggle:3'))
  expect(shown.map(n => textCells(n.text.split('\n')[0]))).toEqual([textW, textW]) // cut at the text column's width
  for (const [key, glyph] of [['note:edit:1', '\u{F03EB}'], ['note:send:1', '\u{F048A}'], ['note:delete:1', '\u{F0A79}']]) expect((await ui.find({ key }))?.text).toBe(glyph)
  await ui.press({ key: 'note:toggle:1' })
  await settleAll()
  expect((await ui.find({ type: 'Text', text: `${long}\nmore` }))?.props.wrap).toBe('wrap')
  const rows = await ui.findAll({ type: 'Box', props: { flexDirection: 'column' } })
  const bands = rows.map(r => r.props.backgroundColor).filter(c => c !== undefined)
  expect(bands).toHaveLength(1) // notes 1 and 3 plain, note 2 banded
  expect(bands).toEqual(['subtle']) // the theme's faint grey, not a fixed colour
  await ui.unmount()
})

// ── Multi-line notes ──

test('notes: the field starts at two rows (a 1-row Input is single-line and cuts) and grows with its lines and wrapped text, so the whole note stays visible', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await notesPane($, 40)
  const rows = async () => (await ui.find({ type: 'Input', key: 'note' }))?.props.rows
  expect(await rows()).toBe(2)
  await ui.input({ key: 'note', text: 'one\ntwo\nthree', kind: 'change' })
  await settleAll()
  expect(await rows()).toBe(3)
  await ui.input({ key: 'note', text: 'a long line of words that cannot fit in the text column of a narrow pane', kind: 'change' })
  await settleAll()
  expect(Number(await rows())).toBeGreaterThan(2)
  await ui.unmount()
})

test('notes: a field takes the whole pane row, its buttons under it, and is as tall as the host wraps it (the pane width less the Enter hint)', async ($, on) => {
  const long = 'a long line of words that cannot fit in the text column of a narrow pane, not even in the whole row of a wide one'
  world(on, { dataFile: JSON.stringify({ history: [], prs: [], notes: [{ id: 1, text: long }] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // the host's wrap less the cursor cell: at 30 and 40 columns the short hint ` ⏎ save` (7), at 58 the long one ` ⏎ save · shift+⏎ new line` (26)
  for (const [columns, wrapAt] of [[30, 22], [40, 32], [58, 31]]) {
    const ui = await notesPane($, columns)
    for (const [field, buttons] of [['note', []], ['note:edit-field', ['note:edit:1', 'note:save:1', 'note:delete:1']]] as const) {
      if (field === 'note') await ui.input({ key: 'note', text: long, kind: 'change' })
      else await ui.press({ key: 'note:edit:1' })
      await settleAll()
      const drawn = await ui.drawn()
      // the pane's whole width, its padding included, which the host fills with the text and the Enter hint
      expect([holderProps(drawn, field)?.width, holderProps(drawn, field)?.marginLeft]).toEqual([columns, -1])
      for (const key of buttons) expect(holderProps(drawn, key)?.justifyContent).toBe('flex-end')
      expect((await ui.find({ type: 'Input', key: field }))?.props.rows).toBe(wrapCells(long, wrapAt).length)
    }
    await ui.press({ key: 'note:edit:1' }) // cancels the edit for the next width
    await settleAll()
    await ui.unmount()
  }
})

test('notes: the new-note field has no save or clear button; Enter saves', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await notesPane($, 40)
  for (const key of ['note:save', 'note:clear']) expect(await ui.find({ key })).toBeUndefined()
  await ui.input({ key: 'note', text: 'draft', kind: 'change' })
  await ui.input({ key: 'note', text: 'draft', kind: 'submit' })
  await settleAll()
  expect(await ui.find({ key: 'note:edit:1' })).toBeDefined()
  expect((await ui.find({ type: 'Input', key: 'note' }))?.props.value).toBe('')
  await ui.unmount()
})

test('notes: a paste keeps its lines; CRLF and CR become LF; empty lines and indentation survive; the saved text is the exact string', async ($, on) => {
  const writes = new Map<string, string>()
  world(on, { writes, sessionId: () => 's-1' })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await notesPane($)
  await saveNote(ui, 'a\r\n\r\n    indented\rlast\n\n')
  await ui.unmount()
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  expect(dataOf(writes)).toMatchObject({ notes: [{ id: 1, text: 'a\n\n    indented\nlast\n\n' }] })
})

test('notes: edit then save without a change gives back the identical string; send inserts it exactly', async ($, on) => {
  const text = '  one\n\n\ttwo  \n日本語 😀\nend\n'
  const fills: { text: string; mode?: string }[] = []
  const writes = new Map<string, string>()
  world(on, { fills, writes, sessionId: () => 's-1', dataFile: JSON.stringify({ history: [], prs: [], notes: [{ id: 3, text }] }) })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await notesPane($)
  await ui.press({ key: 'note:send:3' })
  await settleAll()
  expect(fills).toEqual([{ text, mode: 'append' }])
  await ui.press({ key: 'note:edit:3' })
  await settleAll()
  const value = (await ui.find({ type: 'Input', key: 'note:edit-field' }))?.props.value
  expect(value).toBe(text)
  await ui.input({ key: 'note:edit-field', text: value as string, kind: 'submit' })
  await settleAll()
  await ui.unmount()
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  expect(dataOf(writes)).toMatchObject({ notes: [{ id: 3, text }] })
})

test('notes: an open note draws blank lines and indentation as written', async ($, on) => {
  const lines = ['l1', '', '  l3', 'l4', 'l5', 'l6', 'l7', 'l8']
  world(on, { dataFile: JSON.stringify({ history: [], prs: [], notes: [{ id: 1, text: lines.join('\n') }] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await notesPane($)
  const texts = async () => (await ui.findAll({ type: 'Text' })).map(n => n.text)
  expect(await texts()).not.toContain('l8')
  await ui.press({ key: 'note:toggle:1' })
  await settleAll()
  expect(await texts()).toContain('l1\n \n  l3\nl4\nl5\nl6\nl7\nl8')
  await ui.unmount()
})

// The test harness draws the element tree, not the terminal: the Input's lines on screen are the host's, so this checks what the mod hands it.
type Drawn = { type?: string; props?: { value?: string; rows?: number }; children?: Drawn[] }
const inputsDrawn = (node: unknown): { value?: string; rows?: number }[] => {
  const n = node as Drawn
  return [...(n.type === 'Input' ? [{ value: n.props?.value, rows: n.props?.rows }] : []), ...(n.children ?? []).flatMap(inputsDrawn)]
}

test('notes: editing a multi-line note opens a field as tall as its lines, and typing more lines grows it', async ($, on) => {
  const text = 'one\ntwo\nthree\nfour\nfive'
  world(on, { dataFile: JSON.stringify({ history: [], prs: [], notes: [{ id: 1, text }] }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await notesPane($)
  await ui.press({ key: 'note:edit:1' })
  await settleAll()
  let input = await ui.find({ type: 'Input', key: 'note:edit-field' })
  expect(input?.props.value).toBe(text)
  expect(input?.props.rows).toBe(5)
  expect(input?.props.autoFocus).toBe(true)
  // the mod hands the host the whole multi-line value: the tree it draws holds one Input with all five lines
  expect(inputsDrawn(await ui.drawn())).toEqual([{ value: text, rows: 5 }])
  await ui.input({ key: 'note:edit-field', text: `${text}\nsix`, kind: 'change' })
  await settleAll()
  input = await ui.find({ type: 'Input', key: 'note:edit-field' })
  expect(input?.props.value).toBe(`${text}\nsix`)
  expect(input?.props.rows).toBe(6)
  expect(inputsDrawn(await ui.drawn())).toEqual([{ value: `${text}\nsix`, rows: 6 }])
  await ui.unmount()
})

test('notes: a whitespace-only field saves nothing, newlines included', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await notesPane($)
  await saveNote(ui, ' \n\r\n\t\n')
  expect(await noteKeys(ui, 'send')).toEqual([])
  await ui.unmount()
})

test('scoping: the notes of a session are not the next one\'s, and stay in the first one\'s data file', async ($, on) => {
  let id = 's-1'
  const writes = new Map<string, string>()
  world(on, { sessionId: () => id, writes })
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  let ui = await notesPane($)
  await saveNote(ui, 'keep me')
  expect(rowTexts(await ui.drawn()).some(r => r.startsWith('keep me'))).toBe(true)
  await ui.unmount()
  await $.session.end({ reason: 'clear', sessionId: 's-1', resume: { id: 's-1' } })
  id = 's-2'
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  ui = await notesPane($)
  const rows = rowTexts(await ui.drawn())
  expect(rows).toContain('no saved notes')
  expect(rows.some(r => r.startsWith('keep me'))).toBe(false)
  await ui.unmount()
  expect(dataOf(writes)).toMatchObject({ notes: [{ id: 1, text: 'keep me' }] })
})
