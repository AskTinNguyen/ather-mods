// The board as the engine loads it (`claude plugin test ather-board`). The pure modules are covered by
// board.test.mjs under node; this checks /board and its pane in the engine's own host (A6-A13), against
// a stand-in checkout the test's hooks answer for: one intent folder, no git repository, a git user.name,
// and a model whose replies the test writes.
import { expect, mock, test } from 'claude-code/testing'

const ROOT = '/w'
const DAY = 86400000
const PROMPT = ['# Snow look', '', '- Rev: 1', '- Status: active', '- Area: VFX', '- Owner: LamPhung-Art', '', '## Goal', '', 'Snow that reads.', '', '## Acceptance', '', '- A1: Snow.', '- A2: Sand.', ''].join('\n')
const PROGRESS = ['# Progress', '', '## Acceptance', '', '| Item | Verdict |', '| --- | --- |', '| A1 | met |', '| A2 | open |', ''].join('\n')
// The model's replies: a brief naming one real intent and one that does not exist, and an answer.
const BRIEF = JSON.stringify({ headline: 'Snow is stuck.', suggestions: [{ title: 'Unstick snow-look', why: 'Eight days without a change.', action: 'unstick', intents: ['snow-look', 'no-such-intent'] }, { title: 'Close a ghost', why: 'x', action: 'close', intents: ['no-such-intent'] }] })
const MAPPED = JSON.stringify({ 'snow-look': ['env-presets', 'vfx'] })
const ANSWER = JSON.stringify({ answer: 'snow-look is the stuck one.', view: '', area: 'VFX', owner: '', stage: '', intents: ['snow-look'] })

// The engine hands hooks absolute paths of the machine's own form ("D:\w\docs" on Windows): compared as "/w/docs".
const norm = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

type World = { written: { path: string, text: string }[], sent: string[], ran: string[][], asked: string[] }

// A checkout with docs/intent/snow-look, owned by LamPhung-Art and last touched 8 days ago; nothing is a
// git repository, but git knows the user (`me`, '' for none). The model answers briefs and questions.
function checkout(on: any, { hasIntents = true, me = 'LamPhung-Art', settings = '' } = {}): World {
  const world: World = { written: [], sent: [], ran: [], asked: [] }
  const files: Record<string, string> = hasIntents ? { [`${ROOT}/docs/intent/snow-look/prompt.md`]: PROMPT, [`${ROOT}/docs/intent/snow-look/progress.md`]: PROGRESS, ...(settings ? { [`${ROOT}/.ather/board.json`]: settings } : {}) } : {}
  on('session.root', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 'board-test-session' }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: undefined }))
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: hasIntents && (norm(e.path) === `${ROOT}/docs/intent` || norm(e.path) in files) }))
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const path = norm(e.path)
    if (path.endsWith('/page/board.css')) return { value: 'body { margin: 0 }' }
    if (path.endsWith('/page/client.js')) return { value: '/* the page script */' }
    if (path in files) return { value: files[path] }
    throw new Error(`ENOENT ${e.path}`)
  })
  on('fs.list', (_$: unknown, e: { path: string }) => ({ value: hasIntents && norm(e.path) === `${ROOT}/docs/intent` ? [{ name: 'snow-look', kind: 'dir' }] : [] }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: Date.now() - 8 * DAY, isLink: false } }))
  on('fs.write', (_$: unknown, e: { path: string, text: string }) => {
    world.written.push({ path: norm(e.path), text: e.text })
    return { value: undefined }
  })
  on('process.run', (_$: unknown, e: { argv: readonly string[] }) => {
    world.ran.push([...e.argv])
    if (e.argv[0] === 'git' && e.argv.includes('user.name')) return { value: { exitCode: me ? 0 : 1, stdout: me ? `${me}\n` : '', stderr: '' } }
    return { value: { exitCode: e.argv[0] === 'git' ? 128 : 0, stdout: '', stderr: e.argv[0] === 'git' ? 'fatal: not a git repository' : '' } }
  })
  on('model.complete', (_$: unknown, e: { model: string, prompt: string }) => {
    const kind = e.prompt.includes('Their question:') ? 'ask' : e.prompt.startsWith('The modules') ? 'map' : 'brief'
    world.asked.push(`${e.model}: ${kind}`)
    return { value: { isAnswered: true, text: kind === 'ask' ? ANSWER : kind === 'map' ? MAPPED : `Here it is:\n${BRIEF}`, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('prompt.submit', (_$: unknown, e: { text: string }) => {
    world.sent.push(e.text)
    return { text: e.text }
  })
  return world
}

const PANE = { component: 'Pane' as const, requestId: 'board', props: { title: 'ATHER BOARD', isFocused: true, bodyColumns: 100 } as any }

test('/board in a repository without intents says what it reads, and opens nothing', async ($, on) => {
  checkout(on, { hasIntents: false })
  const ran = await $.command.run({ command: 'board', args: '' })
  expect(ran.text ?? '').toMatch(/reads a repository.s intents \(its docs\/intent folder\)/)
})

test('/board opens on For you: the person\u2019s stuck intent, and Sonnet\u2019s brief with only real intents in it, on the terminal and the desktop (A10, A12)', async ($, on) => {
  const world = checkout(on)
  const ran = await $.command.run({ command: 'board', args: '' })
  expect(ran.text ?? '').toBe('Board opened.')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'ather-board', surface, ...PANE })
    expect(await ui.find({ key: 'you-stuck-snow-look' })).toBeDefined()
    expect(await ui.find({ text: /Snow is stuck\./ })).toBeDefined()
    expect(await ui.find({ key: 'suggest-brief-0-press' })).toBeDefined()
    expect(await ui.find({ text: /Close a ghost/ })).toBeUndefined()
    await ui.unmount()
  }
  // One brief for this read of the board, from Sonnet, however often the pane is drawn.
  expect(world.asked).toEqual(['sonnet: brief'])
})

test('without a git user.name, For you says how to set it and Triage still lists the team\u2019s (A10)', async ($, on) => {
  checkout(on, { me: '' })
  const ui = await $.ui.mount({ plugin: 'ather-board', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /Set git user\.name/ })).toBeDefined()
  await ui.press({ key: 'tab-triage' })
  expect(await ui.find({ key: 'attention-stale-snow-look' })).toBeDefined()
  expect(await ui.find({ text: /No change for 5 days or more/ })).toBeDefined()
  await ui.unmount()
})

test('the Table and Areas views; an area pressed opens the table filtered to it (A6)', async ($, on) => {
  checkout(on)
  const ui = await $.ui.mount({ plugin: 'ather-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-areas' })
  await ui.press({ key: 'lines-area-VFX-press' })
  expect(await ui.find({ key: 'words' })).toBeDefined()
  // The generic pack has no studio name rules: the owner reads as git spells it, split.
  expect(await ui.find({ key: 'group-Lam Phung Art-snow-look' })).toBeDefined()
  await ui.unmount()
})

test('pressing an intent opens it in place with its next action first; an action hands the session one prompt that changes nothing unasked (A11)', async ($, on) => {
  const clock = mock.clock(on)
  const world = checkout(on)
  const ui = await $.ui.mount({ plugin: 'ather-board', surface: 'desktop', ...PANE })
  await ui.press({ key: 'you-stuck-snow-look' })
  expect(await ui.find({ text: /Snow that reads/ })).toBeDefined()
  expect((await ui.find({ key: 'act-snow-look-unstick' }))?.props.variant).toBe('primary')
  expect(await ui.find({ key: 'act-snow-look-about' })).toBeDefined()
  await ui.press({ key: 'act-snow-look-unstick' })
  await clock.advance(100)
  expect(world.sent.length).toBe(1)
  expect(world.sent[0] ?? '').toMatch(/^Intent snow-look has had no change/)
  expect(world.sent[0] ?? '').toContain('Change nothing until I say.')
  expect(await ui.find({ text: /Handed to the session: unstick it, snow-look/ })).toBeDefined()
  await ui.unmount()
})

test('a suggestion pressed hands its action over for the intents it names (A12)', async ($, on) => {
  const clock = mock.clock(on)
  const world = checkout(on)
  const ui = await $.ui.mount({ plugin: 'ather-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'suggest-brief-0-press' })
  await clock.advance(100)
  expect(world.sent.length).toBe(1)
  expect(world.sent[0] ?? '').toMatch(/^Intent snow-look has had no change/)
  await ui.unmount()
})

test('a question in the ask box comes back as an answer and a cut of the board, cleared with one press (A13)', async ($, on) => {
  const world = checkout(on)
  const ui = await $.ui.mount({ plugin: 'ather-board', surface: 'terminal', ...PANE })
  await ui.input({ key: 'ask', text: 'what is stuck?' })
  expect(world.asked).toContain('sonnet: ask')
  expect(await ui.find({ text: /snow-look is the stuck one\./ })).toBeDefined()
  expect(await ui.find({ key: 'group-Lam Phung Art-snow-look' })).toBeDefined()
  await ui.press({ key: 'ask-clear' })
  expect(await ui.find({ text: /snow-look is the stuck one\./ })).toBeUndefined()
  await ui.unmount()
})

test('/board open writes one self-contained page where the pack keeps local files, and opens it (A7)', async ($, on) => {
  const world = checkout(on)
  const ran = await $.command.run({ command: 'board', args: 'open' })
  expect(world.written.length).toBe(1)
  expect(world.written[0]?.path ?? '').toBe(`${ROOT}/.ather/local/board/index.html`)
  expect(world.written[0]?.text ?? '').toMatch(/^<!doctype html>/)
  expect(world.written[0]?.text ?? '').toContain('"slug":"snow-look"')
  expect(ran.text ?? '').toContain('Page written and opened')
  expect(world.ran.some(argv => argv[0] === 'open' || argv[0] === 'cmd')).toBe(true)
})

test('/board publish writes the page and hands the session one prompt to publish it (A8)', async ($, on) => {
  const clock = mock.clock(on)
  const world = checkout(on)
  const ran = await $.command.run({ command: 'board', args: 'publish' })
  await clock.advance(100)
  expect(ran.text ?? '').toContain('The session publishes it through vesper-sites')
  expect(world.sent.length).toBe(1)
  expect(norm(world.sent[0] ?? '')).toContain(`${ROOT}/.ather/local/board/index.html`)
})

test('anything else after /board says what it takes', async ($, on) => {
  checkout(on)
  const ran = await $.command.run({ command: 'board', args: 'kanban' })
  expect(ran.text ?? '').toMatch(/^\/board opens the board, on what is yours to act on\./)
})

test('Modules: without a list of its own, the board maps intents by Area and asks no model to (A15)', async ($, on) => {
  const world = checkout(on)
  const ui = await $.ui.mount({ plugin: 'ather-board', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-modules' })
  expect(await ui.find({ key: 'module-vfx-snow-look' })).toBeDefined()
  expect(world.asked.filter(one => one.endsWith('map'))).toEqual([])
  await ui.unmount()
})

test('Modules: a repository’s own list is sorted by Sonnet once, kept in the store, and drawn as groups (A15)', async ($, on) => {
  const world = checkout(on, { settings: JSON.stringify({ modules: [{ key: 'env-presets', name: 'Environment presets' }, { key: 'vfx', name: 'VFX' }] }) })
  const kept: { key: string, value: unknown }[] = []
  on('store.get', () => ({ value: undefined }))
  on('store.set', (_$: unknown, e: { key: string, value: unknown }) => {
    kept.push({ key: e.key, value: e.value })
    return { value: undefined }
  })
  const ui = await $.ui.mount({ plugin: 'ather-board', surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab-modules' })
  expect(await ui.find({ key: 'module-env-presets-snow-look' })).toBeDefined()
  expect(await ui.find({ key: 'module-vfx-snow-look' })).toBeDefined()
  expect(world.asked.filter(one => one.endsWith('map'))).toEqual(['sonnet: map'])
  expect(kept.map(one => one.key)).toEqual(['modules:w'])
  expect(JSON.stringify(kept[0]?.value)).toContain('"modules":["env-presets","vfx"]')
  await ui.unmount()
})
