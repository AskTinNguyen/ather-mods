import { expect, test } from 'claude-code/testing'
import { blankSession, heldLine, newSync } from '../hooks/coord.ts'
import { LOCK, ME, NOW, A5RPANE, PROJ, all, atherTree, find, keys, minWidth, opts, placed, still, text, world, type Tree } from './world.ts'

// A25: the three tools never leave their box, at the narrowest and a wide pane, desktop and terminal: every tool
// is a full-width row whose narrowest possible layout (wrapping text at words, nothing truncated) fits the pane,
// its one action sits in a box that never shrinks, and each tool has the action set it should.
const HF = 'E:/s2/Saved/A5R'
const ME8 = ME.slice(0, 8)
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const LONG_LANE = '1006-walkerext-s9-retarget' // a long holder name, like the ones Hai's screenshot cut to "Edi…"

const buttons = (tree: unknown, key: string): string[] => all(find(tree, key)).filter(n => n.type === 'Button').map(n => String(n.props?.label))

const setup = async ($: any, on: any, surface: 'terminal' | 'desktop', mine: boolean) => {
  const w = world(on, { ram: '28.5' })
  const holder = mine ? { lane: 'tail-vfx', sessionName: 'tail-vfx', id8: ME8 } : { lane: LONG_LANE, sessionName: LONG_LANE, id8: 'bbbbbbbb' }
  w.put(LOCK, `${heldLine({ ...holder, since: T(14, 30), pid: null, end: T(15, 10), mode: 'interactive', pausable: false, nextSafe: 'after save', note: 'capture' })}\n`)
  if (!mine) w.put(`${HF}/editor/bbbbbbbb.json`, JSON.stringify({ ...blankSession('bbbbbbbb-1111', LONG_LANE, '', NOW), holding: { since: T(14, 30), end: T(15, 10), extended: 0 } }))
  else w.put(`${HF}/sync.json`, JSON.stringify(newSync(T(16, 0), { session: ME, id8: ME8, lane: 'tail-vfx' }, 'tail-vfx', NOW)))
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
  return w
}

for (const surface of ['terminal', 'desktop'] as const)
  for (const columns of surface === 'terminal' ? [44, 100] : [40, 100])
    test(`A25 (${surface}, ${columns} columns): each tool fits its row, nothing truncated, one action at most, inside a box that never shrinks`, opts(), async ($, on) => {
      const w = await setup($, on, surface, false)
      const P = { ...A5RPANE, surface, props: { ...A5RPANE.props, bodyColumns: columns } } as never
      await $.ui.render(P)
      await w.clock.advance(50)
      const tree = await $.ui.render(P)
      for (const k of ['editor', 'memory', 'main']) {
        const row = find(tree, `hai-tile-${k}`)
        expect([k, row?.props?.width]).toEqual([k, '100%'])
        expect([k, minWidth(row) <= columns]).toEqual([k, true])
        expect(all(row).filter(n => typeof n.props?.wrap === 'string' && String(n.props?.wrap).startsWith('truncate'))).toEqual([])
        const action = find(tree, `hai-tile-${k}-action`)
        if (action) expect([k, action.props?.flexShrink, find(tree, `hai-tile-${k}-main`)?.props?.flexShrink]).toEqual([k, 0, 1])
      }
      // A35: one label column on both surfaces.
      for (const [n, k] of ['editor', 'memory', 'main'].entries()) expect(text(find(tree, `hai-tile-${k}-label`))).toBe(['Editor', 'Memory', 'Sync main'][n] as string)
      expect(text(find(tree, 'hai-tile-editor'))).toContain(LONG_LANE)
      expect([buttons(tree, 'hai-tile-editor'), buttons(tree, 'hai-tile-memory'), buttons(tree, 'hai-tile-main')]).toEqual([[], [], ['Plan sync']])
      expect(text(find(tree, 'hai-tile-memory'))).not.toMatch(/[−+] ?1 GB/)
    })

for (const surface of ['terminal', 'desktop'] as const)
  test(`A25 (${surface}): holding the Editor and the sync, the actions are Release and Sync ⋯; Release frees the Editor`, opts(), async ($, on) => {
    const w = await setup($, on, surface, true)
    const P = { ...A5RPANE, surface, props: { ...A5RPANE.props, bodyColumns: surface === 'terminal' ? 44 : 40 } } as never
    let tree = await $.ui.render(P)
    expect([buttons(tree, 'hai-tile-editor'), buttons(tree, 'hai-tile-memory'), buttons(tree, 'hai-tile-main')]).toEqual([['Release'], [], ['Sync ⋯']])
    for (const k of ['editor', 'main']) expect([k, minWidth(find(tree, `hai-tile-${k}`)) <= (surface === 'terminal' ? 44 : 40)]).toEqual([k, true])
    await $.ui.press({ plugin: 'a5r', key: 'hai-editor-release', surface })
    expect(w.read(LOCK).startsWith('FREE')).toBe(true)
    tree = await $.ui.render(P)
    expect(buttons(tree, 'hai-tile-editor')).toEqual([])
  })

test('A25: /a5r gate shows, sets and resets the launch gate; a bad argument explains itself', opts(), async ($, on) => {
  world(on)
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  const run = async (args: string) => String((await $.command.run({ command: 'a5r', args } as never)).text)
  expect(await run('gate')).toContain('≥ 31 GB with PIE, ≥ 28 GB without (plugin options)')
  expect(await run('gate 33 30')).toContain('≥ 33 GB with PIE, ≥ 30 GB without')
  expect(await run('gate')).toContain('(set with /a5r gate)')
  expect(await run('gate many')).toContain('/a5r gate <with PIE GB> <without PIE GB>')
  expect(await run('gate reset')).toContain('back to the plugin options: ≥ 31 GB with PIE, ≥ 28 GB without')
})

// A49 (Hai's dark-theme screenshots, 2026-10-07: a session row's "· 2m" read "· 2", cut at the pane's right edge):
// every block on the gutter lies inside the pane (its margins inside the pane's width, not added to a full width),
// and each session row fits its block, so the status at its end is whole and only the title shortens. At the
// narrowest pane (terminal 44, desktop 40, as A25) and wider ones up to 100 columns.
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const LANES = 'E:/s2/Saved/AtherAutomata/lanes'
const MIN = 60_000
const LONG_TITLE = 'Walker capture — a long session title the row has to shorten somewhere before its end'
for (const surface of ['terminal', 'desktop'] as const)
  for (const columns of surface === 'terminal' ? [44, 60, 100] : [40, 60, 100])
    test(`A49 (${surface}, ${columns} columns): the blocks sit inside the pane and a session row's status is whole at its end`, opts(), async ($, on) => {
      const list = JSON.stringify([{ sessionId: 'local_1', title: LONG_TITLE, cwd: 'E:\\s2', isArchived: false, isRunning: false, lastActivityAt: new Date(NOW - 2 * MIN).toISOString() }])
      const w = world(on, { out: { mcp__ccd_session_mgmt__list_sessions: list } })
      w.put(`${HF}/editor/bbbbbbbb.json`, JSON.stringify(blankSession(SID('bbbbbbbb'), 'lane-bbbbbbbb', LONG_TITLE, NOW)))
      w.put(`${LANES}/${SID('bbbbbbbb')}.json`, JSON.stringify({ sessionId: SID('bbbbbbbb'), intent: 'fx-sand', branch: 'HaiHuynh/x', updatedAt: NOW, lastActiveAt: NOW - 2 * MIN, hasEnded: false }))
      await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
      const P = { ...A5RPANE, surface, props: { ...A5RPANE.props, bodyColumns: columns } } as never
      await $.ui.render(P)
      await w.clock.advance(50)
      const tree = still(await $.ui.render(P))
      const at = placed(tree, columns)
      // Every block lies inside the pane: the band at full width, the rest on the 2-column gutter.
      for (const key of keys(tree)) {
        const b = at.get(key)
        expect([key, b !== undefined && b.x >= 0 && b.x + b.w <= columns]).toEqual([key, true])
        if (key !== 'hai-a5r-band') expect([key, b?.x, b && b.x + b.w]).toEqual([key, 2, columns - 2])
      }
      // Each session row fits its block: dot, the shortened title and the whole status; the status never shrinks.
      const rows = (find(tree, 'hai-overview')?.children ?? []).map(c => String((c as Tree).props?.key)).filter(k => /^hai-session-[0-9a-f]{8}$/.test(k))
      expect(rows).toEqual([`hai-session-${ME8}`, 'hai-session-bbbbbbbb'])
      for (const key of rows) {
        const r = at.get(key)
        expect([key, r !== undefined && r.x + r.w <= columns - 2, minWidth(find(tree, key)) <= (r?.w ?? 0)]).toEqual([key, true, true])
        expect([key, find(tree, `${key}-status`)?.props?.flexShrink, find(tree, `${key}-title`)?.props?.flexShrink]).toEqual([key, 0, 1])
      }
      expect(text(find(tree, 'hai-session-bbbbbbbb-status'))).toBe('fx-sand · 2m')
      expect(text(find(tree, 'hai-session-bbbbbbbb-title'))).toBe(LONG_TITLE)
    })
