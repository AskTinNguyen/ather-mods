import { expect, test } from 'claude-code/testing'
import { bandTitle } from '../hooks/theme.ts'
import { A5RPANE, LOCK, PANE, PROJ, all, atherTree, find, keys, opts, text, world, type Tree } from './world.ts'

// A33 (Hai's approved mockup, L-12): the A5R pane in seal red, gold, pale gold and ivory: a seal-red title band with a
// gold ★ and "A5R · NĂM ĐIỀU" in pale gold, gold icons, the RAM meter red on a dark red track, ivory text, the rule
// seals red with a gold rim; Ather's pane stays restrained (its seal, its gold accent and the red "★ A5R ›" only).
const LOOK = { red: '#B3261E', gold: '#F2C14E', pale: '#F6D98A', ivory: '#E9E4D8', meter: '#E8473C', track: '#4A2220' }
const FREE = 'FREE since=14:00 2026-10-06 by=walker note=Editor closed background=none · free since 14:00\n'
const colorsIn = (t: unknown): string[] => all(t).map(n => String(n.props?.color ?? n.props?.backgroundColor ?? n.props?.borderColor ?? ''))

test('A33: unit: the band title is letter-spaced in capitals', () => {
  expect(bandTitle('A5R · Five rules')).toBe('A 5 R  ·  F I V E  R U L E S')
})

for (const surface of ['terminal', 'desktop'] as const)
  test(`A33 (${surface}): the A5R pane's band, gold icons, red meter, ivory text and red-and-gold seals`, opts(), async ($, on) => {
    const w = world(on, { ram: '28.5' })
    w.put(LOCK, FREE)
    await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
    const tree = await $.ui.render({ ...A5RPANE, surface } as never)
    expect(keys(tree)[0]).toBe('hai-a5r-band')
    const band = find(tree, 'hai-a5r-band') as Tree
    expect([band.props?.backgroundColor, band.props?.width]).toEqual(['#7A1712', '100%']) // A35: the darker, thinner band
    expect(find(tree, 'hai-a5r-band-star')?.children?.[0]).toMatchObject({ props: { color: LOOK.gold }, children: ['★'] })
    expect(find(tree, 'hai-a5r-band-title')?.children?.[0]).toMatchObject({ props: { color: LOOK.pale }, children: ['A 5 R'] })
    expect(text(find(tree, 'hai-a5r-band-on'))).toBe('on')
    // Gold icons for the tools in a fine state (a free Editor, RAM above the gates).
    for (const k of ['editor', 'memory']) {
      const iconEl = (find(tree, `hai-tile-${k}-icon`)?.children ?? [])[0] as Tree
      expect([k, surface === 'desktop' ? String(iconEl.props?.source).includes(LOOK.gold) : iconEl.props?.color]).toEqual([k, surface === 'desktop' ? true : LOOK.gold])
    }
    // A35 supersedes A33's RAM meter: Memory reads "<n> GB free" with no meter.
    expect(all(find(tree, 'hai-tile-memory')).filter(n => n.type === 'Text' && /━/.test(text(n)))).toEqual([])
    // Ivory text: the tools' values and the session titles.
    expect(colorsIn(find(tree, 'hai-tile-memory-main'))).toContain(LOOK.ivory)
    expect(colorsIn(find(tree, 'hai-overview'))).toContain(LOOK.ivory)
    // A36 supersedes A33's red seals: quiet chips, neutral rim until a rule is hit.
    expect(find(tree, 'hai-a5r-chip-1-box')?.props).toMatchObject({ borderColor: '#3A3833' })
  })

test("A33: Ather's pane stays restrained: no band, the line in quiet grey, the seal red only behind the A5R button", opts(), async ($, on) => {
  world(on, { ram: '28.5' })
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  const tree = await $.ui.render({ ...PANE, surface: 'desktop' } as never)
  expect(find(tree, 'hai-a5r-band')).toBeUndefined()
  const line = find(tree, 'hai-a5r-line') as Tree
  const reds = all(line).filter(n => n.props?.backgroundColor === LOOK.red).map(n => n.props?.key)
  expect(reds).toEqual(['hai-a5r-line-open'])
  expect(colorsIn(line).filter(c => [LOOK.ivory, LOOK.meter, LOOK.track].includes(c))).toEqual([])
})

test('A33: with A5R off the band says "off"', opts(), async ($, on) => {
  world(on, { a5r: false })
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  expect(text(find(await $.ui.render(A5RPANE as never), 'hai-a5r-band-on'))).toBe('off')
})
