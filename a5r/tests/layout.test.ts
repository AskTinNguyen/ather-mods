import { expect, test } from 'claude-code/testing'
import { blankSession, heldLine, newSync } from '../hooks/coord.ts'
import { LOCK, ME, NOW, A5PANE, PROJ, all, atherTree, find, minWidth, opts, text, world } from './world.ts'

// A25: the three tools never leave their box, at the narrowest and a wide pane, desktop and terminal: every tool
// is a full-width row whose narrowest possible layout (wrapping text at words, nothing truncated) fits the pane,
// its one action sits in a box that never shrinks, and each tool has the action set it should.
const HF = 'E:/s2/Saved/A5'
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
      const P = { ...A5PANE, surface, props: { ...A5PANE.props, bodyColumns: columns } } as never
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
    const P = { ...A5PANE, surface, props: { ...A5PANE.props, bodyColumns: surface === 'terminal' ? 44 : 40 } } as never
    let tree = await $.ui.render(P)
    expect([buttons(tree, 'hai-tile-editor'), buttons(tree, 'hai-tile-memory'), buttons(tree, 'hai-tile-main')]).toEqual([['Release'], [], ['Sync ⋯']])
    for (const k of ['editor', 'main']) expect([k, minWidth(find(tree, `hai-tile-${k}`)) <= (surface === 'terminal' ? 44 : 40)]).toEqual([k, true])
    await $.ui.press({ plugin: 'a5', key: 'hai-editor-release', surface })
    expect(w.read(LOCK).startsWith('FREE')).toBe(true)
    tree = await $.ui.render(P)
    expect(buttons(tree, 'hai-tile-editor')).toEqual([])
  })

test('A25: /a5 gate shows, sets and resets the launch gate; a bad argument explains itself', opts(), async ($, on) => {
  world(on)
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  const run = async (args: string) => String((await $.command.run({ command: 'a5', args } as never)).text)
  expect(await run('gate')).toContain('≥ 31 GB with PIE, ≥ 28 GB without (plugin options)')
  expect(await run('gate 33 30')).toContain('≥ 33 GB with PIE, ≥ 30 GB without')
  expect(await run('gate')).toContain('(set with /a5 gate)')
  expect(await run('gate many')).toContain('/a5 gate <with PIE GB> <without PIE GB>')
  expect(await run('gate reset')).toContain('back to the plugin options: ≥ 31 GB with PIE, ≥ 28 GB without')
})
