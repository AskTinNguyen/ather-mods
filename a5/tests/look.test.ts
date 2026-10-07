import { expect, test } from 'claude-code/testing'
import { bandTitle } from '../hooks/theme.ts'
import { A5PANE, LOCK, PANE, PROJ, all, atherTree, find, keys, opts, text, world, type Tree } from './world.ts'

// A33 (Hai's approved mockup, L-12): the A5 pane in seal red, gold, pale gold and ivory: a seal-red title band with a
// gold ★ and "A5 · NĂM ĐIỀU" in pale gold, gold icons, the RAM meter red on a dark red track, ivory text, the rule
// seals red with a gold rim; Ather's pane stays restrained (its seal, its gold accent and the red "★ A5 ›" only).
const LOOK = { red: '#B3261E', gold: '#F2C14E', pale: '#F6D98A', ivory: '#E9E4D8', meter: '#E8473C', track: '#4A2220' }
const FREE = 'FREE since=14:00 2026-10-06 by=walker note=Editor closed background=none · free since 14:00\n'
const colorsIn = (t: unknown): string[] => all(t).map(n => String(n.props?.color ?? n.props?.backgroundColor ?? n.props?.borderColor ?? ''))

test('A33: unit: the band title is letter-spaced in capitals', () => {
  expect(bandTitle('A5 · Năm điều')).toBe('A 5  ·  N Ă M  Đ I Ề U')
})

for (const surface of ['terminal', 'desktop'] as const)
  test(`A33 (${surface}): the A5 pane's band, gold icons, red meter, ivory text and red-and-gold seals`, opts(), async ($, on) => {
    const w = world(on, { ram: '28.5' })
    w.put(LOCK, FREE)
    await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
    const tree = await $.ui.render({ ...A5PANE, surface } as never)
    expect(keys(tree)[0]).toBe('hai-a5-band')
    const band = find(tree, 'hai-a5-band') as Tree
    expect([band.props?.backgroundColor, band.props?.width]).toEqual([LOOK.red, '100%'])
    expect(find(tree, 'hai-a5-band-star')?.children?.[0]).toMatchObject({ props: { color: LOOK.gold }, children: ['★'] })
    expect(find(tree, 'hai-a5-band-title')?.children?.[0]).toMatchObject({ props: { color: LOOK.pale }, children: ['A 5  ·  N Ă M  Đ I Ề U'] })
    expect(text(find(tree, 'hai-a5-band-on'))).toBe('đang bật')
    // Gold icons for the tools in a fine state (a free Editor, RAM above the gates).
    for (const k of ['editor', 'memory']) {
      const iconEl = (find(tree, `hai-tile-${k}-main`)?.children ?? [])[0] as Tree
      expect([k, surface === 'desktop' ? String(iconEl.props?.source).includes(LOOK.gold) : iconEl.props?.color]).toEqual([k, surface === 'desktop' ? true : LOOK.gold])
    }
    // The RAM meter: red on a dark red track.
    const meter = all(find(tree, 'hai-tile-memory')).filter(n => n.type === 'Text' && /━/.test(text(n)) && typeof n.props?.color === 'string').map(n => n.props?.color)
    expect([...new Set(meter)].sort()).toEqual([LOOK.meter, LOOK.track].sort())
    // Ivory text: the tools' values and the session titles.
    expect(colorsIn(find(tree, 'hai-tile-memory-main'))).toContain(LOOK.ivory)
    expect(colorsIn(find(tree, 'hai-overview'))).toContain(LOOK.ivory)
    // The seals: red fill, gold rim.
    expect(find(tree, 'hai-a5-seal-1-box')?.props).toMatchObject({ backgroundColor: LOOK.red, borderColor: LOOK.gold })
  })

test("A33: Ather's pane stays restrained: no band, the line in quiet grey, the seal red only behind the A5 button", opts(), async ($, on) => {
  world(on, { ram: '28.5' })
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  const tree = await $.ui.render({ ...PANE, surface: 'desktop' } as never)
  expect(find(tree, 'hai-a5-band')).toBeUndefined()
  const line = find(tree, 'hai-a5-line') as Tree
  const reds = all(line).filter(n => n.props?.backgroundColor === LOOK.red).map(n => n.props?.key)
  expect(reds).toEqual(['hai-a5-line-open'])
  expect(colorsIn(line).filter(c => [LOOK.ivory, LOOK.meter, LOOK.track].includes(c))).toEqual([])
})

test('A33: with A5 off the band says "đang tắt"', opts(), async ($, on) => {
  world(on, { a5: false })
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  expect(text(find(await $.ui.render(A5PANE as never), 'hai-a5-band-on'))).toBe('đang tắt')
})
