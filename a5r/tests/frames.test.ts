import { expect, test } from 'claude-code/testing'
import { FRAME_STYLE, curtainSvg, pixelSvg, sealSvg, stampSvg, sweepSvg, ICONS } from '../hooks/icons.ts'
import { svgOpenEnd, withFrameStyle } from '../hooks/theme.ts'
import { AVATARS } from './avatars.fixture.ts'
import { A5RPANE, PANE, PROJ, all, atherTree, opts, world, type Tree } from './world.ts'

// A43 (rev 13): every Svg a5r draws with isInteractive carries `<style>:root{color-scheme:light dark;background:transparent}</style>`
// as the first child of its svg, so the sandboxed frame's page takes the app's scheme and stays transparent (the svg
// root's style alone does not reach it: Hai's dark-theme screenshot showed a white square beside each rule chip).
// A47 (d): the evidence that every interactive Svg a5r draws has the rule is the engine test below (both panes, both
// themes, every effect drawn); rev 13's generated list of Svg calls (a fixture the suite could not regenerate, blind to a
// multi-line, reordered or destructured call) was dropped. The unit test covers each SVG source a5r builds.
const firstChild = (source: string): string => source.slice(svgOpenEnd(source) + 1).slice(0, FRAME_STYLE.length)
const starts = (source: string) => firstChild(source) === FRAME_STYLE

test('A43: unit: every SVG source a5r builds has FRAME_STYLE as its first child', () => {
  expect(FRAME_STYLE).toBe('<style>:root{color-scheme:light dark;background:transparent}</style>')
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
    await $.command.run({ command: 'a5r', args: 'off' } as never)
    await $.command.run({ command: 'a5r', args: 'on' } as never) // the seal stamps in
    await $.command.run({ command: 'a5r', args: '' } as never) // the entrance
    await $.tool.call({ tool: 'Bash', command: 'git push --force origin HaiHuynh/x' }) // a chip stamp
    await $.command.run({ command: 'a5r', args: 'accept' } as never) // the score resolve
    const svgs = [...all(await $.ui.render({ ...A5RPANE, surface: 'desktop' } as never)), ...all(await $.ui.render({ ...PANE, surface: 'desktop' } as never))].filter(n => n.type === 'Svg' && n.props?.isInteractive === true)
    expect(svgs.length).toBeGreaterThan(10)
    expect(svgs.filter(n => !starts(String(n.props?.source))).map(n => String(n.props?.source).slice(0, 90))).toEqual([])
    expect(svgs.some(n => String(n.props?.alt) === 'editor')).toBe(true) // the running avatar was checked too
  })

test('A47 (c): the frame rule goes right after the real end of the svg open tag: quotes and comments are passed over', () => {
  const tricky = '<?xml version="1.0"?><!-- <svg> in a comment --><svg xmlns="http://www.w3.org/2000/svg" aria-label="a > b" style=\'x>y\' viewBox="0 0 1 1"><rect/></svg>'
  const out = withFrameStyle(tricky, true)
  expect(out).toBe(tricky.replace("viewBox=\"0 0 1 1\">", `viewBox="0 0 1 1">${FRAME_STYLE}`))
  expect(withFrameStyle(out, true)).toBe(out) // once
  expect(withFrameStyle('<svg viewBox="0 0 1 1"><style>p{}</style><rect/></svg>', true).startsWith(`<svg viewBox="0 0 1 1">${FRAME_STYLE}<style>p{}`)).toBe(true) // another style first: ours still goes first
  expect(withFrameStyle('<!-- no svg here -->', true)).toBe('<!-- no svg here -->')
  expect(svgOpenEnd('<svg>')).toBe(4)
})
