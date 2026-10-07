import { expect, test } from 'claude-code/testing'
import { A5RPANE, LOCK, PANE, PENDING, PROJ, all, atherTree, find, keys, opts, world, type Tree } from './world.ts'

// A37: the entrance. When the A5R pane opens (and when the compact line first draws) each block dithers in from
// seal-red pixels in order (band, tools, sessions, rules), the whole sequence within 300 ms, then still: on the
// desktop only (SVG/SMIL), never with motion off, the terminal draws at once. MEASURED in the engine types: a Box can
// be `position: "absolute"` ("placed against its parent by the offsets, no room among its siblings, painted over those
// before it"), so each curtain is an absolute box spanning its block with one SVG over the text.
const RED = '#B3261E'
const curtains = (tree: unknown) => all(tree).filter(n => /^hai-a5r-(in|line-in)/.test(String(n.props?.key ?? '')))
const timings = (svg: string) => [...svg.matchAll(/begin="(\d+)ms" dur="(\d+)ms"/g)].map(m => [Number(m[1]), Number(m[2])] as const)
const svgOf = (c: Tree) => String(((c.children ?? [])[0] as Tree)?.props?.source ?? '')

test('A37 (desktop): /a5r opens the pane with a curtain over each block, in order, all done within 300 ms; still a second later', opts(), async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  await $.command.run({ command: 'a5r', args: '' } as never)
  const P = { ...A5RPANE, surface: 'desktop' } as never
  let tree = (await $.ui.render(P)) as Tree
  const blocks = keys(tree)
  expect(blocks).toEqual(['hai-a5r-band', 'hai-tiles', 'hai-overview', 'hai-a5r-rules'])
  const starts: number[] = []
  let end = 0
  blocks.forEach((k, i) => {
    const block = find(tree, k) as Tree
    const c = (block.children ?? []).at(-1) as Tree // the curtain is the block's last child: painted over the rest
    expect([k, c.props?.key, c.props?.position, c.props?.top, c.props?.left, c.props?.right, c.props?.bottom, c.props?.overflow, block.props?.position]).toEqual([k, `hai-a5r-in-${i}`, 'absolute', 0, 0, 0, 0, 'hidden', 'relative'])
    const svg = ((c.children ?? [])[0] as Tree)
    expect([svg.type, svg.props?.isInteractive]).toEqual(['Svg', true])
    const t = timings(svgOf(c))
    expect([k, t.length, svgOf(c).includes(`fill="${RED}"`), svgOf(c).includes('from="1" to="0"')]).toEqual([k, 16, true, true])
    starts.push(Math.min(...t.map(([b]) => b)))
    end = Math.max(end, ...t.map(([b, d]) => b + d))
  })
  expect(starts[0]).toBe(0)
  expect([...starts].sort((a, b) => a - b)).toEqual(starts) // band, tools, sessions, rules in order
  expect(end).toBeLessThanOrEqual(300)
  await w.clock.advance(1_100)
  tree = (await $.ui.render(P)) as Tree
  expect(curtains(tree)).toEqual([])
})

test('A37 (desktop): the compact line dithers in when it first draws, then stays still', opts(), async ($, on) => {
  const w = world(on)
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  const P = { ...PANE, surface: 'desktop' } as never
  const first = await $.ui.render(P)
  const c = (find(first, 'hai-a5r-line')?.children ?? []).at(-1) as Tree
  expect([c.props?.key, c.props?.position]).toEqual(['hai-a5r-line-in', 'absolute'])
  expect(Math.max(...timings(svgOf(c)).map(([b, d]) => b + d))).toBeLessThanOrEqual(300)
  await w.clock.advance(1_100)
  expect(curtains(await $.ui.render(P))).toEqual([])
})

test('A37: the terminal draws at once (no curtain); motion off draws at once on the desktop too', opts(), async ($, on) => {
  world(on)
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  await $.command.run({ command: 'a5r', args: '' } as never)
  expect(curtains(await $.ui.render(A5RPANE as never))).toEqual([])
  expect(curtains(await $.ui.render(PANE as never))).toEqual([])
})

test('A37: motion off: no curtain on the desktop', { options: { a5rWhenPresent: 'deny', editorLock: LOCK, pendingFile: PENDING, motion: 'off' } }, async ($, on) => {
  world(on)
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  await $.command.run({ command: 'a5r', args: '' } as never)
  expect(curtains(await $.ui.render({ ...A5RPANE, surface: 'desktop' } as never))).toEqual([])
  expect(curtains(await $.ui.render({ ...PANE, surface: 'desktop' } as never))).toEqual([])
})
