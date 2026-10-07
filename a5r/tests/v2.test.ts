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
