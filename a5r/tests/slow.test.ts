import { expect, test } from 'claude-code/testing'
import { ENTRANCE_BUDGET_MS, ENTRANCE_MS, FRAME_STYLE, SLOW, curtainEnd, curtainSvg, entranceCurtains, entranceLife, fxLife, paceOf, scoreCurtain, stampSvg, sweepSvg } from '../hooks/icons.ts'
import { blankSession, newSync } from '../hooks/coord.ts'
import { A5RPANE, LOCK, NOW, PENDING, PROJ, all, find, keys, world, type Tree } from './world.ts'

// A51 (Hai saw no red entrance on the real desktop pane, 2026-10-07): `motion: slow` is a review aid that plays the
// A5R pane's entrance (A37) and the event dithers (A38) ten times slower, each curtain kept in the tree until its last
// cell has finished plus a margin, so Hai can tell a too-fast entrance from one the desktop does not draw. `on` keeps
// the ≤ 300 ms entrance, and its curtains stay in the tree 2 s so a frame that loads late (its SMIL clock starts at
// load) still plays them. Every Svg keeps FRAME_STYLE as its first child (A43).
const HF = 'E:/s2/Saved/A5R'
const MIN = 60_000
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const SLOW_OPTS = { options: { a5rWhenPresent: 'deny', editorLock: LOCK, pendingFile: PENDING, motion: 'slow' } }
const D = { ...A5RPANE, surface: 'desktop' } as never
const timings = (svg: string) => [...svg.matchAll(/begin="(\d+)ms" dur="(\d+)ms"/g)].map(m => [Number(m[1]), Number(m[2])] as const)
const lastEnd = (svg: string) => Math.max(...timings(svg).map(([b, d]) => b + d))
const svgIn = (tree: unknown, key: string) => String((((find(tree, key)?.children ?? [])[0] as Tree)?.props?.source) ?? '')
const keyed = (tree: unknown, re: RegExp) => all(tree).map(n => String(n.props?.key ?? '')).filter(k => re.test(k))
const framed = (source: string) => source.startsWith('<svg') && source.slice(source.indexOf('>') + 1).startsWith(FRAME_STYLE)
const svgs = (tree: unknown) => all(tree).filter(n => n.type === 'Svg').map(n => String(n.props?.source ?? ''))
const PEER = 'bbbbbbbb-1111-4000-8000-000000000000'
const peer = (at: number) => JSON.stringify({ ...blankSession(PEER, 'walker', 'Walker', at), heartbeatAt: at })

test('A51: unit: the option reads slow as ×10 and anything else as ×1', () => {
  expect([paceOf('slow'), paceOf('on'), paceOf('off'), paceOf(undefined), SLOW]).toEqual([10, 1, 1, 1, 10])
})

test('A51: unit: slow timings are ten times on: entrance, score, stamp, sweep', () => {
  for (const n of [1, 4, 5, 6]) {
    const on = entranceCurtains(n, '#B3261E', 1)
    const slow = entranceCurtains(n, '#B3261E', SLOW)
    expect(slow.map(c => [c.begin, c.step])).toEqual(on.map(c => [c.begin * 10, c.step * 10]))
    expect(timings(curtainSvg(slow.at(-1)!))).toEqual(timings(curtainSvg(on.at(-1)!)).map(([b, d]) => [b * 10, d * 10]))
  }
  for (const n of [1, 2, 3, 4, 5]) expect(timings(curtainSvg(scoreCurtain(n, '#F2C14E', SLOW)))).toEqual(timings(curtainSvg(scoreCurtain(n, '#F2C14E'))).map(([b, d]) => [b * 10, d * 10]))
  expect(timings(stampSvg('#B3261E', 0, 8 * SLOW, 600 * SLOW))).toEqual(timings(stampSvg('#B3261E')).map(([b, d]) => [b * 10, d * 10]))
  for (const reverse of [false, true]) {
    const on = timings(sweepSvg('#F6D98A', reverse))
    const slow = timings(sweepSvg('#F6D98A', reverse, 900, 120, 2, SLOW))
    expect(slow.length).toBe(on.length)
    // durations exactly ×10; starts ×10 up to the rounding of one cell (≤ 5 ms)
    expect(slow.every(([b, d], i) => d === (on[i]?.[1] ?? 0) * 10 && Math.abs(b - (on[i]?.[0] ?? 0) * 10) <= 5)).toBe(true)
    expect([lastEnd(sweepSvg('#F6D98A', reverse)) <= 900, lastEnd(sweepSvg('#F6D98A', reverse, 900, 120, 2, SLOW)) <= 9_000]).toEqual([true, true])
  }
})

test('A51: unit: on stays within 300 ms; each lifetime covers the last cell plus a margin, at on and at slow', () => {
  for (const n of [1, 4, 5, 6]) {
    const end1 = Math.max(...entranceCurtains(n, '#B3261E', 1).map(curtainEnd))
    const end10 = Math.max(...entranceCurtains(n, '#B3261E', SLOW).map(curtainEnd))
    expect([n, end1 <= ENTRANCE_BUDGET_MS, end10 <= ENTRANCE_BUDGET_MS * 10, end10 === end1 * 10]).toEqual([n, true, true, true])
    // a late frame's margin of at least 1 s after the last cell, at both paces
    expect([n, entranceLife(1) - end1 >= 1_000, entranceLife(SLOW) - end10 >= 1_000]).toEqual([n, true, true])
  }
  expect([ENTRANCE_MS, entranceLife(1), ENTRANCE_MS >= 2_000]).toEqual([2_000, 2_000, true])
  // the events: sweep, stamp and score end before their lifetime, with a margin, at both paces
  for (const pace of [1, SLOW]) {
    const ends = [lastEnd(sweepSvg('#F6D98A', false, 900, 120, 2, pace)), lastEnd(sweepSvg('#F6D98A', true, 900, 120, 2, pace)), lastEnd(stampSvg('#B3261E', 0, 8 * pace, 600 * pace)), lastEnd(curtainSvg(scoreCurtain(5, '#F2C14E', pace)))]
    expect([pace, ends.every(e => fxLife(pace) - e >= 100 * pace)]).toEqual([pace, true])
  }
  expect([fxLife(1), fxLife(SLOW)]).toEqual([1_000, 10_000])
})

test('A51 (desktop, slow): the pane entrance plays ten times slower, over about 3 s, and stays until its last cell plus a margin', SLOW_OPTS, async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  await $.command.run({ command: 'a5r', args: '' } as never)
  let tree = (await $.ui.render(D)) as Tree
  const blocks = keys(tree)
  expect(blocks).toEqual(['hai-a5r-band', 'hai-tiles', 'hai-overview', 'hai-a5r-rules'])
  const plan = entranceCurtains(blocks.length, '#B3261E', 1)
  blocks.forEach((_, i) => {
    const svg = svgIn(tree, `hai-a5r-in-${i}`)
    expect([i, timings(svg)]).toEqual([i, timings(curtainSvg(plan[i]!)).map(([b, d]) => [b * 10, d * 10])])
  })
  const end = Math.max(...blocks.map((_, i) => lastEnd(svgIn(tree, `hai-a5r-in-${i}`))))
  expect([end > 2_500, end <= 3_000]).toEqual([true, true])
  expect(svgs(tree).every(framed)).toBe(true)
  await w.clock.advance(end + 1_000) // past the last cell, still in the tree
  expect(keyed(await $.ui.render(D), /^hai-a5r-in-/).length).toBe(4)
  await w.clock.advance(entranceLife(SLOW) - end - 1_000 + 20)
  tree = (await $.ui.render(D)) as Tree
  expect(keyed(tree, /^hai-a5r-in-/)).toEqual([])
})

test('A51 (desktop, slow): a rule hit stamp and a new score play ten times slower and leave after their last cell', SLOW_OPTS, async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  await w.clock.advance(1_100)
  expect(keyed(await $.ui.render(D), /^hai-a5r-fx-/)).toEqual([])
  await w.clock.advance(entranceLife(SLOW))
  await $.tool.call({ tool: 'Bash', command: 'git push --force origin HaiHuynh/x' }) // rule 1, refused
  await $.command.run({ command: 'a5r', args: 'accept' } as never)
  let tree = await $.ui.render(D)
  expect(keyed(tree, /^hai-a5r-fx-/)).toEqual(['hai-a5r-fx-hit-1', ...[1, 2, 3, 4, 5].map(n => `hai-a5r-fx-score-${n}`)])
  expect(timings(svgIn(tree, 'hai-a5r-fx-hit-1'))).toEqual(timings(stampSvg('#B3261E')).map(([b, d]) => [b * 10, d * 10]))
  expect([1, 2, 3, 4, 5].map(n => Math.min(...timings(svgIn(tree, `hai-a5r-fx-score-${n}`)).map(([b]) => b)))).toEqual([0, 1_500, 3_000, 4_500, 6_000])
  const end = Math.max(lastEnd(svgIn(tree, 'hai-a5r-fx-hit-1')), ...[1, 2, 3, 4, 5].map(n => lastEnd(svgIn(tree, `hai-a5r-fx-score-${n}`))))
  expect([end > 6_000, end < fxLife(SLOW)]).toEqual([true, true])
  expect(svgs(tree).every(framed)).toBe(true)
  await w.clock.advance(end + 100)
  expect(keyed(await $.ui.render(D), /^hai-a5r-fx-/).length).toBe(6)
  await w.clock.advance(fxLife(SLOW) - end)
  tree = await $.ui.render(D)
  expect(keyed(tree, /^hai-a5r-fx-/)).toEqual([])
})

test('A51 (desktop, slow): the sync freeze sweep plays ten times slower and leaves after its last cell', SLOW_OPTS, async ($, on) => {
  const w = world(on)
  w.put(`${HF}/editor/bbbbbbbb.json`, peer(NOW))
  w.put(`${HF}/sync.json`, JSON.stringify(newSync(T(14, 42), { session: PEER, id8: 'bbbbbbbb', lane: 'walker' }, 'walker', NOW)))
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  await w.clock.advance(1_100)
  expect(keyed(await $.ui.render(D), /^hai-a5r-fx-/)).toEqual([])
  for (let n = 0; n < 2; n += 1) {
    w.put(`${HF}/editor/bbbbbbbb.json`, peer(w.clock.now() + MIN))
    await w.clock.advance(MIN)
  }
  let tree = await $.ui.render(D)
  expect(keyed(tree, /^hai-a5r-fx-/)).toEqual(['hai-a5r-fx-freeze'])
  const svg = svgIn(tree, 'hai-a5r-fx-freeze')
  expect(timings(svg).every(([, d]) => d === 2_500)).toBe(true)
  const end = lastEnd(svg)
  expect([end > 5_000, end <= 9_000]).toEqual([true, true])
  expect(framed(svg)).toBe(true)
  await w.clock.advance(end + 100)
  expect(keyed(await $.ui.render(D), /^hai-a5r-fx-/)).toEqual(['hai-a5r-fx-freeze'])
  await w.clock.advance(fxLife(SLOW) - end)
  tree = await $.ui.render(D)
  expect(keyed(tree, /^hai-a5r-fx-/)).toEqual([])
})
