import { expect, test } from 'claude-code/testing'
import { blankSession, newSync } from '../hooks/coord.ts'
import { A5PANE, LOCK, NOW, PENDING, PROJ, all, find, opts, text, world, type Tree } from './world.ts'

// A38: one-shot event dithers on the desktop (≤ 1 s, no loop): a rule chip stamps red when its rule is hit; the band
// sweeps with a ❄ coming in at the sync freeze, and sweeps back at the lift; a new acceptance score resolves the five
// chips one by one from a dither to ✓ / ✗. None without its trigger; none on the terminal or with motion off.
const HF = 'E:/s2/Saved/A5'
const MIN = 60_000
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const RED = '#B3261E'
const D = { ...A5PANE, surface: 'desktop' } as never
const fx = (tree: unknown) => all(tree).map(n => String(n.props?.key ?? '')).filter(k => k.startsWith('hai-a5-fx-'))
const svgIn = (tree: unknown, key: string) => String((((find(tree, key)?.children ?? [])[0] as Tree)?.props?.source) ?? '')
const ends = (svg: string) => [...svg.matchAll(/begin="(\d+)ms" dur="(\d+)ms"/g)].map(m => Number(m[1]) + Number(m[2]))
const begins = (svg: string) => [...svg.matchAll(/begin="(\d+)ms"/g)].map(m => Number(m[1]))
const PEER = 'bbbbbbbb-1111-4000-8000-000000000000'
const peer = (at: number) => JSON.stringify({ ...blankSession(PEER, 'walker', 'Walker', at), heartbeatAt: at })

test('A38: a rule hit stamps its chip red once (≤ 1 s), only that chip; then still', opts(), async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  await w.clock.advance(1_100) // past the entrance
  expect(fx(await $.ui.render(D))).toEqual([])
  await $.tool.call({ tool: 'Bash', command: 'git push --force origin HaiHuynh/x' }) // rule 1, refused
  const tree = await $.ui.render(D)
  expect(fx(tree)).toEqual(['hai-a5-fx-hit-1'])
  const svg = svgIn(tree, 'hai-a5-fx-hit-1')
  expect([svg.includes(`fill="${RED}"`), svg.includes('values="0;1;0"'), svg.includes('repeatCount')]).toEqual([true, true, false])
  expect(Math.max(...ends(svg))).toBeLessThanOrEqual(1_000)
  await w.clock.advance(1_100)
  expect(fx(await $.ui.render(D))).toEqual([])
})

test('A38: the sync freeze sweeps the band and brings ❄; the lift sweeps it back the other way and ❄ goes', opts(), async ($, on) => {
  const w = world(on)
  w.put(`${HF}/editor/bbbbbbbb.json`, peer(NOW))
  w.put(`${HF}/sync.json`, JSON.stringify(newSync(T(14, 42), { session: PEER, id8: 'bbbbbbbb', lane: 'walker' }, 'walker', NOW)))
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  await w.clock.advance(1_100)
  let tree = await $.ui.render(D)
  expect([fx(tree), find(tree, 'hai-a5-band-freeze')]).toEqual([[], undefined]) // cutoff, not frozen yet
  for (let n = 0; n < 2; n += 1) {
    w.put(`${HF}/editor/bbbbbbbb.json`, peer(w.clock.now() + MIN))
    await w.clock.advance(MIN)
  }
  tree = await $.ui.render(D)
  expect(fx(tree)).toEqual(['hai-a5-fx-freeze'])
  expect(text(find(tree, 'hai-a5-band-freeze'))).toBe('❄')
  const forward = begins(svgIn(tree, 'hai-a5-fx-freeze'))
  expect(forward[0]).toBeLessThan(forward.at(-1) as number) // left to right
  expect(Math.max(...ends(svgIn(tree, 'hai-a5-fx-freeze')))).toBeLessThanOrEqual(1_000)
  await w.clock.advance(1_100)
  expect(fx(await $.ui.render(D))).toEqual([])
  // The holder ends the sync: the band sweeps back, the ❄ is gone.
  const s = JSON.parse(w.read(`${HF}/sync.json`))
  w.put(`${HF}/sync.json`, JSON.stringify({ ...s, state: 'done', endedAt: w.clock.now(), endNote: 'merged' }))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer(w.clock.now() + MIN))
  await w.clock.advance(MIN) // the minute tick reads the ended sync
  tree = await $.ui.render(D)
  expect([fx(tree), find(tree, 'hai-a5-band-freeze')]).toEqual([['hai-a5-fx-lift'], undefined])
  const back = begins(svgIn(tree, 'hai-a5-fx-lift'))
  expect(back[0]).toBeGreaterThan(back.at(-1) as number) // right to left
})

test('A38: a new acceptance score resolves the chips one by one (dither, then ✓ / ✗); the marks stay, the dither goes', opts(), async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  await w.clock.advance(1_100)
  expect(fx(await $.ui.render(D))).toEqual([])
  await $.command.run({ command: 'a5', args: 'accept' } as never)
  let tree = await $.ui.render(D)
  expect(fx(tree)).toEqual([1, 2, 3, 4, 5].map(n => `hai-a5-fx-score-${n}`))
  const firsts = [1, 2, 3, 4, 5].map(n => Math.min(...begins(svgIn(tree, `hai-a5-fx-score-${n}`))))
  expect(firsts).toEqual([0, 150, 300, 450, 600]) // one by one
  expect(Math.max(...[1, 2, 3, 4, 5].flatMap(n => ends(svgIn(tree, `hai-a5-fx-score-${n}`))))).toBeLessThanOrEqual(1_000)
  const marks = () => [1, 2, 3, 4, 5].map(n => text(find(tree, `hai-a5-chip-${n}-box`)).replace(/^\d .+?(?=[✓✗–]$)/, ''))
  expect(marks().every(m => /^[✓✗–]$/.test(m))).toBe(true)
  await w.clock.advance(1_100)
  tree = await $.ui.render(D)
  expect(fx(tree)).toEqual([])
  expect(marks().every(m => /^[✓✗–]$/.test(m))).toBe(true)
})

test('A38: none on the terminal; none with motion off', { options: { a5WhenPresent: 'deny', editorLock: LOCK, pendingFile: PENDING, motion: 'off' } }, async ($, on) => {
  world(on)
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  await $.tool.call({ tool: 'Bash', command: 'git push --force origin HaiHuynh/x' })
  await $.command.run({ command: 'a5', args: 'accept' } as never)
  expect(fx(await $.ui.render(D))).toEqual([])
  expect(fx(await $.ui.render(A5PANE as never))).toEqual([])
})
