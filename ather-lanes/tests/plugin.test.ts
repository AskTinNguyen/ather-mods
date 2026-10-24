// Ather Lanes as the engine loads it (`claude plugin test ather-lanes`). The pure modules are covered by
// lanes.test.mjs under node; this checks /lanes, its pane on the terminal (72 and 110 columns) and the desktop,
// presses, and when processes run (D3), against the made-up machine of fixtures/machine.mjs, which the test's
// hooks answer for: its files, and lanes.ps1, git and gh's output.
import { expect, mock, test } from 'claude-code/testing'

import { AMBER, LIME } from '../hooks/ather/rows.mjs'
import * as M from './fixtures/machine.mjs'

// The engine hands hooks absolute paths of the machine's own form ("D:\work\game"): compared as "/work/game". Off Windows
// a drive path is not absolute, so the engine puts the plugin's folder in front of it first: that part goes too.
const norm = (path: string) => path.replace(/\\/g, '/').replace(/^(?:.*\/)?[A-Za-z]:(?=\/)/, '').replace(/\/+$/, '')

type World = { ran: { argv: string[], at: number }[], toasts: string[], shown: boolean }

const FILES: Record<string, string> = {
  '/work/game/.git/HEAD': 'ref: refs/heads/main\n',
  '/work/game/.git/config': M.GIT_CONFIG,
  '/work/game/.git/logs/refs/remotes/origin/main': M.REFLOG,
  '/work/game/.agents/skills/s2-agent-lanes/scripts/lanes.ps1': '# lanes.ps1',
  ...Object.fromEntries(Object.entries(M.SLOTS).map(([id, text]) => [`/work/lanes/_machine/slots/${id}.txt`, text])),
  ...Object.fromEntries(Object.entries(M.LANE_BEATS).map(([name, text]) => [`/work/lanes/_machine/heartbeats/${name}.json`, text])),
  ...Object.fromEntries(Object.entries(M.SESSION_BEATS).map(([name, text]) => [`/work/lanes/${name}/Saved/AtherAutomata/lanes/s.json`, text])),
  ...Object.fromEntries(Object.entries(M.INTENTS).flatMap(([slug, files]) => {
    const lane = slug === 'frame-budget' ? 'perf-capture' : slug
    return [[`/work/lanes/${lane}/docs/intent/${slug}/prompt.md`, files.prompt], [`/work/lanes/${lane}/docs/intent/${slug}/findings.md`, files.findings]]
  })),
}

// The machine: lane 0 at /work/game (the session's checkout), its lanes and machine folder beside it.
function machine(on: any, { hasMachine = true }: { hasMachine?: boolean } = {}): World {
  const world: World = { ran: [], toasts: [], shown: true }
  const files = Object.fromEntries(Object.entries(FILES).filter(([path]) => hasMachine || !path.startsWith('/work/lanes/_machine')))
  const dirs = new Set(['/work/game/.git', ...Object.keys(files).flatMap(path => path.split('/').slice(1, -1).map((_, index, parts) => `/${parts.slice(0, index + 1).join('/')}`))])
  on('session.root', () => ({ value: '/work/game' }))
  on('session.id', () => ({ value: 'lanes-test-session' }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', (_$: unknown, e: { text: string }) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: world.shown ? [{ id: 'lanes', title: 'LANES', isShown: true, isFocused: true, isPlaced: true }] : [] }))
  on('command.register', () => ({ value: undefined }))
  on('fs.exists', (_$: unknown, e: { path: string }) => ({ value: norm(e.path) in files || dirs.has(norm(e.path)) }))
  on('fs.stat', (_$: unknown, e: { path: string }) => {
    const path = norm(e.path)
    if (!(path in files) && !dirs.has(path)) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: dirs.has(path) ? 'dir' : 'file', size: 1, mtimeMs: M.NOW, isLink: false } }
  })
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const path = norm(e.path)
    if (path in files) return { value: files[path] }
    throw new Error(`ENOENT ${e.path}`)
  })
  on('fs.list', (_$: unknown, e: { path: string }) => {
    const dir = norm(e.path)
    const names = new Map<string, 'file' | 'dir'>()
    for (const path of [...Object.keys(files), ...dirs]) if (path.startsWith(`${dir}/`)) names.set(path.slice(dir.length + 1).split('/')[0] ?? '', path.slice(dir.length + 1).includes('/') || dirs.has(path) ? 'dir' : 'file')
    return { value: [...names].map(([name, kind]) => ({ name, kind })) }
  })
  on('process.run', (_$: unknown, e: { argv: readonly string[] }) => {
    world.ran.push({ argv: [...e.argv], at: Date.now() })
    const stdout = e.argv[0] === 'powershell' ? M.STATUS : e.argv[0] === 'git' ? M.REFS : e.argv[0] === 'gh' ? M.PRS : ''
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  return world
}

const pane = (columns: number) => ({ component: 'Pane' as const, requestId: 'lanes', props: { title: 'LANES', isFocused: true, bodyColumns: columns } as any })

// The drawn tree's lines (the row Boxes under the pane's own Box), each with its key and its pieces: the words of
// each Text, Button and Link, the Text's colour and the Button's hotkey (drawn as "r: " before its words). The engine keeps a Box's and a Button's key, not a Text's.
type Piece = { key: string, text: string, color?: string, hotkey?: string }
const piecesOf = (node: any, out: Piece[] = []): Piece[] => {
  if (!node || typeof node !== 'object') return out
  const kids = (node.children ?? []) as any[]
  const own = typeof node.props?.label === 'string' ? node.props.label : node.type === 'Text' || node.type === 'Link' ? kids.filter(kid => typeof kid === 'string').join('') : null
  if (own !== null) out.push({ key: String(node.props?.key ?? ''), text: own, color: node.props?.color, hotkey: node.props?.hotkey })
  for (const kid of kids) piecesOf(kid, out)
  return out
}
const linesOf = (drawn: any) => ((drawn?.children ?? []) as any[]).map(line => ({ key: String(line.props?.key ?? ''), pieces: piecesOf(line) }))
const textOf = (drawn: any) => linesOf(drawn).map(line => line.pieces.map(one => one.text).join('')).join('\n')
const count = (world: World, name: string) => world.ran.filter(one => one.argv[0] === name).length

test('/lanes opens the pane, and nothing runs before it is opened (A4, D3)', async ($, on) => {
  const clock = mock.clock(on)
  const world = machine(on)
  await clock.advance(5 * 60 * 1000)
  expect(world.ran.length).toBe(0)
  const ran = await $.command.run({ command: 'lanes', args: '' })
  expect(ran.text ?? '').toBe('Lanes opened.')
  await clock.advance(10)
  expect(world.ran.map(one => one.argv[0])).toEqual(['powershell', 'git', 'gh'])
  // Status as D2.1 names it; the one for-each-ref over named lane branches, never all of refs/heads.
  expect(world.ran[0]?.argv.slice(0, 6)).toEqual(['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'])
  expect(world.ran[0]?.argv).toContain('-Json')
  expect(world.ran[1]?.argv).toContain('for-each-ref')
  expect(world.ran[1]?.argv.includes('refs/heads/fix/editor-filter')).toBe(true)
  expect(world.ran.flatMap(one => one.argv).some(arg => arg === 'refs/heads/' || /^(status|fetch|diff|merge-tree)$/.test(arg))).toBe(false)
})

test('the board at 72 and 110 columns and on the desktop: its sections, no line over the width, lime and amber in place (A3)', async ($, on) => {
  const clock = mock.clock(on)
  machine(on)
  await $.command.run({ command: 'lanes', args: '' })
  await clock.advance(10)
  for (const [surface, columns] of [['terminal', 72], ['terminal', 110], ['desktop', 60]] as const) {
    const ui = await $.ui.mount({ plugin: 'ather-lanes', surface, ...pane(columns) })
    for (const isFoldOpen of [false, true]) {
      const drawn = await ui.drawn()
      const text = textOf(drawn)
      expect(text).toMatch(/F O R   Y O U|FOR YOU/)
      expect(text).toContain('Keep the old filter')
      expect(text).toContain('#398 checks failing')
      // A quiet lane is absent at rest and listed once the fold opens.
      expect(text.includes('docs-sweep')).toBe(isFoldOpen)
      if (isFoldOpen) expect(text).toContain('combat-hitstop · editor')
      for (const line of linesOf(drawn)) {
        for (const one of line.pieces) {
          if (one.color === LIME) expect(`${line.key} ${one.text}`).toMatch(/^you (F O R {3}Y O U|FOR YOU|\d+ decisions?)$/)
          if (one.color === AMBER) expect(line.key).toMatch(/^look-/)
        }
        if (surface === 'terminal') expect(`${line.key} ${line.pieces.reduce((sum, one) => sum + [...one.text].length + (one.hotkey ? one.hotkey.length + 2 : 0), 0) <= columns}`).toBe(`${line.key} true`)
      }
      await ui.press({ key: 'fold-press' })
    }
    await ui.unmount()
  }
})

test('a registered lane opens in place with its details; an unregistered one with the Register line; a second press closes it (A3, D4)', async ($, on) => {
  const clock = mock.clock(on)
  const world = machine(on)
  await $.command.run({ command: 'lanes', args: '' })
  await clock.advance(10)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'ather-lanes', surface, ...pane(72) })
    await ui.press({ key: 'look-editor-fix-press' })
    const details = linesOf(await ui.drawn()).filter(line => line.key.startsWith('detail-editor-fix-')).map(line => line.pieces.map(one => one.text).join('')).join('\n')
    expect(details).toContain('#398 open · checks failing')
    expect(details).toContain('open on GitHub')
    expect(details).toContain('answer them in the session that tracks editor-fix')
    await ui.press({ key: 'look-editor-fix-press' })
    expect(textOf(await ui.drawn())).not.toContain('open on GitHub')
    await ui.press({ key: 'look-scratch-a-press' })
    expect(textOf(await ui.drawn())).toContain('lanes.ps1 -Action Register -Name scratch-a')
    await ui.press({ key: 'look-scratch-a-press' })
    expect(textOf(await ui.drawn())).not.toContain('lanes.ps1 -Action Register')
    await ui.unmount()
  }
  // Opening and closing drew from what the last refresh left: no process for a press.
  expect(world.ran.length).toBe(3)
})

test('shown: Status every 2 minutes and gh every 5; closed or behind another tab nothing runs; r reads again at once (A4, D3)', async ($, on) => {
  const clock = mock.clock(on)
  const world = machine(on)
  await $.command.run({ command: 'lanes', args: '' })
  await clock.advance(10)
  await clock.advance(10 * 60 * 1000)
  expect(count(world, 'powershell')).toBe(6)
  expect(count(world, 'gh')).toBe(3)
  // One process at a time: each starts after the one before it ended (the test answers each at once).
  for (const [index, one] of world.ran.entries()) if (index > 0) expect(one.at >= (world.ran[index - 1]?.at ?? 0)).toBe(true)
  world.shown = false
  const hidden = world.ran.length
  await clock.advance(10 * 60 * 1000)
  expect(world.ran.length).toBe(hidden)
  world.shown = true
  const ui = await $.ui.mount({ plugin: 'ather-lanes', surface: 'terminal', ...pane(72) })
  await ui.press({ key: 'refresh' })
  expect(count(world, 'powershell')).toBe(7)
  await ui.unmount()
  // Closed: the engine lists no pane of the mod's.
  world.shown = false
  const closed = world.ran.length
  await clock.advance(10 * 60 * 1000)
  expect(world.ran.length).toBe(closed)
})

test('no machine folder: the pane says so, draws the rest, and starts no process (D6)', async ($, on) => {
  const clock = mock.clock(on)
  const world = machine(on, { hasMachine: false })
  await $.command.run({ command: 'lanes', args: '' })
  await clock.advance(10)
  const ui = await $.ui.mount({ plugin: 'ather-lanes', surface: 'terminal', ...pane(72) })
  const text = textOf(await ui.drawn())
  expect(text).toMatch(/No machine folder at .*\/work\/lanes\/_machine/)
  expect(text).toContain('Nothing needs you.')
  expect(text).toContain('Editor free')
  expect(world.ran.length).toBe(0)
  await ui.unmount()
})

test('an Edit and a merge attempt raise no Lanes toast and start nothing (A5)', async ($, on) => {
  const clock = mock.clock(on)
  const world = machine(on)
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: 'Edit', file_path: '/work/game/a.txt', old_string: 'a', new_string: 'b' } as any)
  await $.tool.call({ tool: 'Bash', command: 'gh pr merge 398' } as any)
  await clock.advance(60 * 1000)
  expect(world.toasts).toEqual([])
  expect(world.ran.length).toBe(0)
})
