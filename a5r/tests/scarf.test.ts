import { expect, test } from 'claude-code/testing'
import { AVATARS } from './avatars.fixture.ts'
import { SCARF, withScarf } from '../hooks/theme.ts'
import { PANE, PROJ, all, opts, world, type Tree } from './world.ts'

// A39: with A5R on, every worker avatar Ather draws (squad.mjs avatarSvg, read here as Ather ships it) wears a red Young
// Pioneer scarf (the avatars come from tests/avatars.fixture.ts, generated from Ather's squad.mjs): inside the round clip, right after the body and before the prop, so it bobs with the body; the ring,
// the badge and the root's transparency untouched. With A5R off the avatar is Ather's own, byte for byte.
const kinds = [...new Set(AVATARS.map(a => a.kind))]
const crew = () =>
  ({
    type: 'Box',
    props: { flexDirection: 'column' },
    children: [
      { type: 'Box', props: { key: 'head-words', flexDirection: 'column' }, children: [{ type: 'Text', props: {}, children: ['A T H E R'] }] },
      { type: 'Box', props: { key: 'strip' }, children: [{ type: 'Text', props: {}, children: ['Checklist'] }] },
      ...kinds.map(k => AVATARS.find(a => a.kind === k && a.state === 'running' && a.prop === null)).map((a, i) => ({ type: 'Box', props: { key: `crew-${i}` }, children: [{ type: 'Svg', props: { source: a?.source, alt: a?.kind, width: 40, height: 40, isInteractive: i < 2 ? true : undefined } }] })),
      { type: 'Box', props: { key: 'foot' }, children: [{ type: 'Text', props: {}, children: ['Esc closes'] }] },
    ],
  }) as never
const avatars = (tree: unknown) => all(tree).filter(n => n.type === 'Svg' && String(n.props?.source).includes('<clipPath id="round">'))

test('A39: unit: the scarf goes inside the clip, after the body and before the prop, on every body kind; ring and root kept', () => {
  for (const { kind: k, prop, source: src } of AVATARS) {
    const out = withScarf(src)
    const at = out.indexOf('data-a5r="scarf"')
    expect([k, at > out.indexOf('clip-path="url(#round)"'), (prop === null || at < out.indexOf('translate(67 75)')), at < out.indexOf('r="45.5"')]).toEqual([k, true, true, true])
    expect(out.replace(SCARF.svg, '')).toBe(src) // nothing else changed: ring, badge, root style, bob
    expect(out).toContain('style="color-scheme: light dark; background: transparent"')
    expect(withScarf(out)).toBe(out) // once
  }
  expect(withScarf('<svg viewBox="0 0 10 10"><rect/></svg>')).toBe('<svg viewBox="0 0 10 10"><rect/></svg>')
})

for (const surface of ['desktop'] as const) // avatars are Svg: Ather draws them on the desktop only
  test(`A39 (${surface}): with A5R on every avatar in Ather's pane wears the scarf; with A5R off none does`, opts(), async ($, on) => {
    world(on)
    on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => crew())
    await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
    let shown = avatars(await $.ui.render({ ...PANE, surface } as never))
    expect(shown.length).toBe(kinds.length)
    for (const a of shown) expect([a.props?.alt, String(a.props?.source).includes(SCARF.svg)]).toEqual([a.props?.alt, true])
    expect(shown.filter(a => a.props?.isInteractive).length).toBe(2) // running ones keep their frame
    await $.command.run({ command: 'a5r', args: 'off' } as never)
    shown = avatars(await $.ui.render({ ...PANE, surface } as never))
    const ather = avatars(crew()) as Tree[]
    expect(shown.map(a => a.props?.source)).toEqual(ather.map(a => a.props?.source))
  })
