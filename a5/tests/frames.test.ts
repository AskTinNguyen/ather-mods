import { expect, test } from 'claude-code/testing'
import { FRAME_STYLE, curtainSvg, pixelSvg, sealSvg, stampSvg, sweepSvg, ICONS } from '../hooks/icons.ts'
import { withFrameStyle } from '../hooks/theme.ts'
import { AVATARS } from './avatars.fixture.ts'
import { SVG_CALLS } from './svg-calls.fixture.ts'
import { A5PANE, PANE, PROJ, all, atherTree, opts, world, type Tree } from './world.ts'

// A43 (rev 13): every Svg a5 draws with isInteractive carries `<style>:root{color-scheme:light dark;background:transparent}</style>`
// as the first child of its svg, so the sandboxed frame's page takes the app's scheme and stays transparent (the svg
// root's style alone does not reach it: Hai's dark-theme screenshot showed a white square beside each rule chip).
// SVG_CALLS lists every `Svg(` call in a5/hooks (tests/make_svg_calls_fixture.mjs; regenerate it when one is added).
const firstChild = (source: string): string => source.slice(source.indexOf('>', source.indexOf('<svg')) + 1).slice(0, FRAME_STYLE.length)
const starts = (source: string) => firstChild(source) === FRAME_STYLE

test('A43: unit: every Svg call in a5/hooks, its isInteractive, and the source each one draws: FRAME_STYLE first', () => {
  expect(FRAME_STYLE).toBe('<style>:root{color-scheme:light dark;background:transparent}</style>')
  expect(SVG_CALLS.map(c => [c.file, c.source.slice(0, 20), c.isInteractive])).toEqual([
    ['icons.ts', 'pixelSvg(ICONS[name]', true], // the tool icons (interactive only while they move)
    ['register.ts', 'sealSvg(A5_LOOK.seal', true], // the brand seal while it stamps in
    ['register.ts', 'source', true], // withOverlay: the entrance curtains and the event dithers
    ['theme.ts', "`${svgOpen('viewBox=", true], // the rule chips' tooltip dots
  ])
  // What each call draws.
  const moving = pixelSvg(ICONS.editor, '#F2C14E', { kind: 'reveal', from: '#000000', ms: 700 })
  const sweeping = pixelSvg(ICONS.branch, '#F2C14E', { kind: 'sweep' })
  const overlays = [curtainSvg({ color: '#B3261E', begin: 0, step: 4, clear: true }), stampSvg('#B3261E'), sweepSvg('#F6D98A', false), sweepSvg('#F6D98A', true)]
  for (const s of [moving, sweeping, sealSvg('#B3261E', '#F6D98A', true), sealSvg('#B3261E', '#F6D98A', false), ...overlays]) expect([s.slice(0, 60), starts(s)]).toEqual([s.slice(0, 60), true])
  // A scarfed running avatar: the rule goes in when Ather's source lacks it; a still one is left as Ather drew it.
  const running = AVATARS.find(a => a.state === 'running')?.source ?? ''
  expect(starts(withFrameStyle(running, true))).toBe(true)
  expect(withFrameStyle(running, false)).toBe(running)
  expect(withFrameStyle(withFrameStyle(running, true), true)).toBe(withFrameStyle(running, true)) // once
})

for (const theme of ['dark', 'light'] as const)
  test(`A43 (${theme}): every interactive Svg in either pane starts with the frame rule (tooltips, entrance, stamp, score, sweep, seal, a running avatar)`, opts(), async ($, on) => {
    const running = AVATARS.find(a => a.state === 'running')?.source ?? ''
    world(on, { theme })
    on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => ({ ...(atherTree(true) as object), children: [...((atherTree(true) as unknown as Tree).children ?? []), { type: 'Svg', props: { source: running, alt: 'editor', width: 40, height: 40, isInteractive: true } }] }) as never)
    await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
    await $.command.run({ command: 'a5', args: 'off' } as never)
    await $.command.run({ command: 'a5', args: 'on' } as never) // the seal stamps in
    await $.command.run({ command: 'a5', args: '' } as never) // the entrance
    await $.tool.call({ tool: 'Bash', command: 'git push --force origin HaiHuynh/x' }) // a chip stamp
    await $.command.run({ command: 'a5', args: 'accept' } as never) // the score resolve
    const svgs = [...all(await $.ui.render({ ...A5PANE, surface: 'desktop' } as never)), ...all(await $.ui.render({ ...PANE, surface: 'desktop' } as never))].filter(n => n.type === 'Svg' && n.props?.isInteractive === true)
    expect(svgs.length).toBeGreaterThan(10)
    expect(svgs.filter(n => !starts(String(n.props?.source))).map(n => String(n.props?.source).slice(0, 90))).toEqual([])
    expect(svgs.some(n => String(n.props?.alt) === 'editor')).toBe(true) // the running avatar was checked too
  })
