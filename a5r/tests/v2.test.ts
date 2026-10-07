import { expect, test } from 'claude-code/testing'
import { blankSession, heldLine } from '../hooks/coord.ts'
import { A5RPANE, LOCK, NOW, PROJ, all, find, keys, minWidth, opts, text, still, world, type Tree } from './world.ts'

// A35 (mockup v2, Hai: "Ok better"): the A5R pane as one gutter and one gap: a thin band whose words sit on the
// content gutter, the three tools as ONE list in one hairline box with hairline dividers (icon, a fixed label column,
// the bold value, at most one button, one quiet sub-line), section labels in one small quiet capital style, Memory
// reading "<n> GB free · below launch gate" with the gates in its sub-line; nothing wider than the pane.
const HF = 'E:/s2/Saved/A5R'
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const V2 = { band: '#7A1712', hair: '#2E2C29', label: '#8E8A80', amber: '#E0A93B', gutter: 2 }
const LONG = '1006-walkerext-s9-retarget'

for (const surface of ['terminal', 'desktop'] as const)
  for (const columns of surface === 'terminal' ? [44, 100] : [40, 100])
    test(`A35 (${surface}, ${columns} columns): one gutter, one gap, one tools list with hairline dividers, one label style; nothing wider than the pane`, opts(), async ($, on) => {
      const w = world(on, { ram: '4.2' })
      w.put(LOCK, `${heldLine({ lane: LONG, sessionName: LONG, id8: 'bbbbbbbb', since: T(14, 30), pid: null, end: T(15, 10), mode: 'interactive', pausable: false, nextSafe: 'after save', note: 'capture' })}\n`)
      w.put(`${HF}/editor/bbbbbbbb.json`, JSON.stringify({ ...blankSession('bbbbbbbb-1111', LONG, '', NOW), holding: { since: T(14, 30), end: T(15, 10), extended: 0 } }))
      await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
      const P = { ...A5RPANE, surface, props: { ...A5RPANE.props, bodyColumns: columns } } as never
      await $.ui.render(P)
      await w.clock.advance(50)
      const tree = still((await $.ui.render(P))) as Tree
      // One gap between blocks; the band full width with its words on the gutter; every other block on the gutter.
      expect(keys(tree)).toEqual(['hai-a5r-band', 'hai-tiles', 'hai-overview', 'hai-a5r-rules'])
      expect(tree.props?.rowGap).toBe(1)
      const band = find(tree, 'hai-a5r-band') as Tree
      expect([band.props?.backgroundColor, band.props?.paddingX, band.props?.width]).toEqual([V2.band, V2.gutter, '100%'])
      for (const k of ['hai-tiles', 'hai-overview', 'hai-a5r-rules']) expect([k, find(tree, k)?.props?.marginX, find(tree, k)?.props?.marginTop]).toEqual([k, V2.gutter, 0])
      // The tools: one hairline box, rows divided by hairlines, no row a card of its own.
      const list = find(tree, 'hai-tiles') as Tree
      expect(list.props?.borderColor).toBe(V2.hair)
      expect(keys(list)).toEqual(['hai-tile-editor', 'hai-tiles-rule-1', 'hai-tile-memory', 'hai-tiles-rule-2', 'hai-tile-main'])
      for (const k of ['editor', 'memory', 'main']) {
        const row = find(tree, `hai-tile-${k}`) as Tree
        expect([k, row.props?.borderStyle, find(tree, `hai-tile-${k}-label`)?.props?.width, find(tree, `hai-tile-${k}-label`)?.props?.flexShrink]).toEqual([k, undefined, 10, 0])
        expect([k, keys(find(tree, `hai-tile-${k}-main`)).at(-1)]).toEqual([k, `hai-tile-${k}-status`]) // one sub-line under the value
      }
      // Memory: the value with its attention part in amber, the gates in the sub-line.
      const mem = text(find(tree, 'hai-tile-memory-main'))
      expect(mem).toBe('4.2 GB free · below launch gategate 31 GB with PIE, 28 without · PIE needs 5 GB')
      expect(all(find(tree, 'hai-tile-memory-main')).find(n => n.type === 'Text' && text(n) === ' · below launch gate')?.props?.color).toBe(V2.amber)
      // One label style: small, quiet, in capitals.
      expect(find(tree, 'hai-overview-head')?.children?.[0]).toMatchObject({ type: 'Text', props: { color: V2.label }, children: ['SESSIONS · 1 OPEN'] })
      // Nothing wider than the pane.
      for (const k of keys(tree)) expect([k, minWidth(find(tree, k)) <= columns]).toEqual([k, true])
    })

// A50 (Hai's screenshot, 2026-10-07: the whole Memory sub-line amber at 41.6 GB free because of "10 git processes"):
// the Memory row colours only what is wrong. Amber goes on the parts that warn ("below launch gate", "N git
// processes", a low disk); the gate details ("gate 31 GB with PIE, 28 without · PIE needs 5 GB") stay quiet.
const GIT10 = Array.from({ length: 10 }, (_, n) => ({ name: 'git', pid: 100 + n, gb: 0.3, parentAlive: true }))
const GATES = 'gate 31 GB with PIE, 28 without · PIE needs 5 GB'
const CASES = [
  { name: 'above the gate, no warning', ram: '41.6', procs: [], disk: 40, value: '41.6 GB free', sub: GATES, amber: [] },
  { name: 'above the gate with 10 git processes', ram: '41.6', procs: GIT10, disk: 40, value: '41.6 GB free', sub: `${GATES} · 10 git processes`, amber: ['10 git processes'] },
  { name: 'below the gate, 10 git processes and a low disk', ram: '4.2', procs: GIT10, disk: 12, value: '4.2 GB free · below launch gate', sub: `${GATES} · E: 12 GB free · 10 git processes`, amber: [' · below launch gate', 'E: 12 GB free', '10 git processes'] },
]
for (const surface of ['terminal', 'desktop'] as const)
  for (const c of CASES)
    test(`A50 (${surface}): Memory ${c.name}: amber only on what warns, the gate details quiet`, opts(), async ($, on) => {
      const w = world(on, { ram: c.ram, procs: c.procs, disk: c.disk })
      await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
      const P = { ...A5RPANE, surface, props: { ...A5RPANE.props, bodyColumns: 100 } } as never
      await $.ui.render(P)
      await w.clock.advance(50)
      const tree = still(await $.ui.render(P)) as Tree
      const main = find(tree, 'hai-tile-memory-main')
      expect(text(main)).toBe(`${c.value}${c.sub}`)
      // The amber texts are exactly the warning parts, each its own Text; the sub-line's own Text stays quiet.
      expect(all(main).filter(n => n.type === 'Text' && n.props?.color === V2.amber).map(text)).toEqual(c.amber)
      const line = find(tree, 'hai-tile-memory-status')?.children?.[0] as Tree
      expect([line.type, line.props?.color === V2.amber]).toEqual(['Text', false])
      for (const quiet of ['gate 31 GB with PIE, 28 without', 'PIE needs 5 GB']) expect(line.children).toContain(quiet)
    })
