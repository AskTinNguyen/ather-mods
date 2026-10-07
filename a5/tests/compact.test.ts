import { expect, test } from 'claude-code/testing'
import { blankSession, heldLine, newSync } from '../hooks/coord.ts'
import { A5PANE, LOCK, NOW, PANE, PROJ, all, atherTree, find, keys, minWidth, opts, text, world, type Tree } from './world.ts'

// A28: Ather's pane carries exactly one A5 block, right under its strip, and (A30) it is icons and values only: the
// Editor holder and until, free GB, main's −N, then "★ A5 ›" on the seal red; only the holder's name may shorten. A29: the A5 pane opens from that button,
// from `/a5` with no words, and `/a5 status` keeps its text reply.
const HF = 'E:/s2/Saved/A5'
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const WARN = '#E0A93B'
const SEAL_RED = '#B3261E' // A33: the approved seal red
const LONG_LANE = '1006-walkerext-s9-retarget'
const held = (lane: string, id8: string, end: number) => `${heldLine({ lane, sessionName: lane, id8, since: T(14, 30), pid: null, end, mode: 'interactive', pausable: false, nextSafe: 'after save', note: 'capture' })}\n`
const peer = (id8: string, lane: string) => JSON.stringify({ ...blankSession(`${id8}-1111-4000-8000-000000000000`, lane, '', NOW), holding: { since: T(14, 30), end: T(15, 10), extended: 0 } })
const partText = (tree: unknown, k: string) => text(find(tree, `hai-a5-line-${k}`))
const partColor = (tree: unknown, k: string) => all(find(tree, `hai-a5-line-${k}`)).filter(n => n.type === 'Text').map(n => n.props?.color).at(-1)
const valueOf = (tree: unknown, k: string) => find(tree, `hai-a5-line-${k}-value`)
const A5_BLOCKS = ['hai-tiles', 'hai-overview', 'hai-accept', 'hai-a5-rules']

for (const surface of ['terminal', 'desktop'] as const)
  for (const columns of surface === 'terminal' ? [44, 100] : [40, 100])
    test(`A28/A30 (${surface}, ${columns} columns): one A5 line under Ather's strip, icons and values, quiet, never wider than the pane; only the holder name shortens`, opts(), async ($, on) => {
      const w = world(on, { ram: '28.5' })
      w.put(LOCK, held(LONG_LANE, 'bbbbbbbb', T(15, 10)))
      w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', LONG_LANE))
      on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
      await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
      const P = { ...PANE, surface, props: { ...PANE.props, bodyColumns: columns } } as never
      await $.ui.render(P)
      await w.clock.advance(50) // the branch read runs off the render
      const tree = await $.ui.render(P)
      expect(keys(tree)).toEqual(['head-words', 'strip', 'hai-a5-line', 'foot'])
      for (const k of A5_BLOCKS) expect([k, find(tree, k)]).toEqual([k, undefined])
      const line = find(tree, 'hai-a5-line') as Tree
      expect([line.props?.flexDirection, line.props?.flexWrap, line.props?.width]).toEqual(['row', undefined, '100%'])
      expect(all(line).filter(n => n.type === 'Box' && n.props?.flexDirection === 'column')).toEqual([]) // one line / one row
      expect(minWidth(line) <= columns).toBe(true)
      // A30: no words, values only; numbers and times sit in boxes that never shrink, only the holder name truncates.
      expect([partText(tree, 'editor'), partText(tree, 'memory'), partText(tree, 'main')].map(t => t.replace(/^[▣▥⎇]/, ''))).toEqual([`${LONG_LANE} →15:10`, '28.5 GB', '−12'])
      for (const k of ['editor', 'memory', 'main']) expect([k, valueOf(tree, k)?.props?.flexShrink, all(valueOf(tree, k)).some(n => String(n.props?.wrap ?? '').startsWith('truncate'))]).toEqual([k, 0, false])
      expect(find(tree, 'hai-a5-line-editor-name')?.children?.[0]).toMatchObject({ type: 'Text', props: { wrap: 'truncate-end' } })
      expect([find(tree, 'hai-a5-line-memory-name'), find(tree, 'hai-a5-line-main-name')]).toEqual([undefined, undefined])
      expect(partText(tree, 'editor') + partText(tree, 'memory') + partText(tree, 'main')).not.toMatch(/Editor|Memory|Sync|behind|GB free/)
      expect([partColor(tree, 'editor'), partColor(tree, 'memory'), partColor(tree, 'main')]).toEqual(['#8E918A', '#8E918A', '#8E918A'])
      expect(find(tree, 'hai-a5-line-open')?.props?.flexShrink).toBe(0)
      expect(text(find(tree, 'hai-a5-line-open'))).toBe('')
      expect(String(find(tree, 'hai-a5-open')?.props?.label)).toBe('★ A5 ›')
      expect(find(tree, 'hai-a5-line-open')?.props?.backgroundColor).toBe(SEAL_RED)
      if (surface === 'desktop') expect((find(tree, 'hai-a5-line-editor')?.children ?? [])[0]).toMatchObject({ type: 'Svg' })
    })

test('A28: only what waits on Hai or this session turns the warning colour: RAM under a gate (⚠), a sync in its freeze, an overrun lease', opts(), async ($, on) => {
  const w = world(on, { ram: '4.2' })
  w.put(LOCK, held('walker', 'bbbbbbbb', T(14, 35))) // 5 min over
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', 'walker'))
  w.put(`${HF}/sync.json`, JSON.stringify(newSync(T(14, 30), { session: 'bbbbbbbb-1111-4000-8000-000000000000', id8: 'bbbbbbbb', lane: 'walker' }, 'walker', NOW)))
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  const tree = await $.ui.render(PANE as never)
  expect([partText(tree, 'memory'), partText(tree, 'main')]).toEqual(['▥4.2 GB ⚠', '⎇14:30 ❄'])
  expect([partColor(tree, 'editor'), partColor(tree, 'memory'), partColor(tree, 'main')]).toEqual([WARN, WARN, WARN])
})

test('A29: "A5 ›" opens the A5 pane; /a5 with no words opens it too; /a5 status keeps its text reply', opts(), async ($, on) => {
  const w = world(on)
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  await $.ui.render(PANE as never)
  await $.ui.press({ plugin: 'a5', key: 'hai-a5-open', surface: 'terminal' } as never)
  expect(w.calls['ui.open']).toEqual([{ id: 'a5', title: 'A5' }])
  expect(String((await $.command.run({ command: 'a5', args: '' } as never)).text)).toBe('A5 pane opened.')
  expect((w.calls['ui.open'] ?? []).length).toBe(2)
  expect(String((await $.command.run({ command: 'a5', args: 'status' } as never)).text).startsWith('A5 is ON.')).toBe(true)
  expect((w.calls['ui.open'] ?? []).length).toBe(2)
})

for (const surface of ['terminal', 'desktop'] as const)
  test(`A29 (${surface}): the A5 pane holds the tools, the sessions, the card when scored, the rules last; with A5 off it says how to turn it on`, opts(), async ($, on) => {
    world(on)
    await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
    await $.command.run({ command: 'a5', args: 'accept' } as never)
    let tree = await $.ui.render({ ...A5PANE, surface } as never)
    expect(keys(tree)).toEqual(['hai-a5-band', 'hai-tiles', 'hai-overview', 'hai-accept', 'hai-a5-rules'])
    await $.command.run({ command: 'a5', args: 'off' } as never)
    tree = await $.ui.render({ ...A5PANE, surface } as never)
    expect(keys(tree)).toEqual(['hai-a5-band', 'hai-a5-off'])
    expect(text(tree)).toContain('/a5 on')
  })
