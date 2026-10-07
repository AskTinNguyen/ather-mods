import { expect, test } from 'claude-code/testing'
import { MARK_ROLES, PALETTES, TEXT_ROLES, themeOf } from '../hooks/theme.ts'
import { A5PANE, PANE, PROJ, all, atherTree, find, opts, text, world, type Tree } from './world.ts'

// A40: a5 reads right in both app themes. One palette per theme for every colour a5 draws; text ≥ 4.5:1 and marks
// ≥ 3:1 against that theme's pane background (measured here); the theme read from /config ("theme") and followed when
// it changes; every interactive Svg a5 draws keeps a transparent root in both themes; the rule chips' tooltips are an
// Svg <title>.
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}
const TRANSPARENT = 'style="color-scheme: light dark; background: transparent"'

test('A40: unit: both palettes: text roles ≥ 4.5:1 and marks ≥ 3:1 on their pane; pale gold on the reds in both', () => {
  for (const name of ['dark', 'light'] as const) {
    const p = PALETTES[name]
    for (const role of TEXT_ROLES) expect([name, role, contrast(p[role], p.bg) >= 4.5]).toEqual([name, role, true])
    for (const role of MARK_ROLES) expect([name, role, contrast(p[role], p.bg) >= 3]).toEqual([name, role, true])
  }
  for (const red of ['#B3261E', '#7A1712']) expect([red, contrast('#F6D98A', red) >= 4.5]).toEqual([red, true]) // band and seal words
  expect(contrast('#B3261E', PALETTES.dark.bg) < 3).toBe(true) // why the dark theme marks a hit in #E5534B instead
  expect(['dark', 'light', 'dark-daltonized', 'light-daltonized', 'light-ansi', 'dark-ansi', '', undefined].map(themeOf)).toEqual(['dark', 'light', 'dark', 'light', 'light', 'dark', 'dark', 'dark'])
})

test('A40: the light theme draws the light palette: ink, labels, the gold accent on Ather\'s pane, the A5 button with a red rim', opts(), async ($, on) => {
  world(on, { theme: 'light', ram: '28.5' })
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  const ather = await $.ui.render({ ...PANE, surface: 'desktop' } as never)
  const brand = all(ather).find(n => n.type === 'Text' && text(n) === 'A T H E R')
  expect(brand?.props?.color).toBe(PALETTES.light.gold) // Ather's lime accent becomes the dark gold on a light pane
  expect(find(ather, 'hai-a5-line-open')?.props).toMatchObject({ borderStyle: 'round', borderColor: '#B3261E' })
  expect(find(ather, 'hai-a5-line-open')?.props?.backgroundColor).toBeUndefined()
  const a5 = await $.ui.render({ ...A5PANE, surface: 'desktop' } as never)
  // The band keeps its own colours on its red in both themes; everything else follows the palette.
  const colours = new Set(all({ ...(a5 as Tree), children: ((a5 as Tree).children ?? []).filter(c => (c as Tree).props?.key !== 'hai-a5-band') }).map(n => n.props?.color).filter(Boolean))
  for (const c of [PALETTES.light.ink, PALETTES.light.label, PALETTES.light.a5Quiet]) expect([c, colours.has(c)]).toEqual([c, true])
  for (const c of [PALETTES.dark.ink, PALETTES.dark.label, PALETTES.dark.gold]) expect([c, colours.has(c)]).toEqual([c, false])
})

test('A40: the dark theme keeps the dark palette and seal red behind the A5 button; a /config change to light follows at once', opts(), async ($, on) => {
  world(on, { ram: '28.5' })
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  let ather = await $.ui.render({ ...PANE, surface: 'desktop' } as never)
  expect(find(ather, 'hai-a5-line-open')?.props?.backgroundColor).toBe('#B3261E')
  expect(all(ather).find(n => n.type === 'Text' && text(n) === 'A T H E R')?.props?.color).toBe(PALETTES.dark.gold)
  await $.config.set({ key: 'theme', value: 'light' } as never)
  ather = await $.ui.render({ ...PANE, surface: 'desktop' } as never)
  expect(all(ather).find(n => n.type === 'Text' && text(n) === 'A T H E R')?.props?.color).toBe(PALETTES.light.gold)
  expect(find(ather, 'hai-a5-line-open')?.props?.borderColor).toBe('#B3261E')
})

for (const theme of ['dark', 'light'] as const)
  test(`A40 (${theme}): every interactive Svg a5 draws keeps a transparent root (entrance, events, icon motion, chip tooltips)`, opts(), async ($, on) => {
    world(on, { theme })
    on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
    await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
    await $.command.run({ command: 'a5', args: '' } as never) // the entrance
    await $.tool.call({ tool: 'Bash', command: 'git push --force origin HaiHuynh/x' }) // a chip stamp
    await $.command.run({ command: 'a5', args: 'accept' } as never) // the score resolve
    const svgs = [...all(await $.ui.render({ ...A5PANE, surface: 'desktop' } as never)), ...all(await $.ui.render({ ...PANE, surface: 'desktop' } as never))].filter(n => n.type === 'Svg' && n.props?.isInteractive)
    expect(svgs.length).toBeGreaterThan(10)
    expect(svgs.filter(n => !String(n.props?.source).includes(TRANSPARENT)).map(n => String(n.props?.source).slice(0, 80))).toEqual([])
  })

test('A40: each rule chip carries its tooltip as an Svg <title>: the full name and the purpose', opts(), async ($, on) => {
  world(on)
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  const tree = await $.ui.render({ ...A5PANE, surface: 'desktop' } as never)
  const tips = [1, 2, 3, 4, 5].map(n => (find(tree, `hai-a5-chip-${n}-box`)?.children ?? []).find(c => (c as Tree).type === 'Svg') as Tree | undefined)
  expect(tips.map(t => /<title>([^<]+)<\/title>/.exec(String(t?.props?.source))?.[1])).toEqual(['Love the project, love your fellow sessions', 'Study well, work well', 'Unity and discipline', 'Keep it clean', 'Modest, honest, brave'])
  expect(tips.every(t => t?.props?.isInteractive === true)).toBe(true)
})
