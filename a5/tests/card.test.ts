import { expect, test } from 'claude-code/testing'
import { A5PANE, PROJ, atherTree, find, keys, opts, text, world } from './world.ts'

// A19: the Nghiệm thu A5 card on the pane: shown when the tracked intent is in Ship (or a score exists, e.g. /a5
// accept), five rows ✓ / ✗ / – with one line each, scored again when files change; terminal and desktop.
const INTENT = `${PROJ}/docs/intent/tail-vfx`
const PROMPT = ['# Tail VFX', '- Rev: 2', '- Status: active', 'Change `Source/S2/Tail/` only.', '## Acceptance', '- A1: the tail glows. Proof: PIE.', '- A2: the trail fades. Proof: PIE.'].join('\n')
const MET = ['| Item | Verdict | Evidence |', '| --- | --- | --- |', '| A1 | met | PIE: glow visible |', '| A2 | met | PIE: fade 0.4 s |'].join('\n')
const OPEN = MET.replace('| A2 | met | PIE: fade 0.4 s |', '| A2 | open | |')
const status = (stage: string) => JSON.stringify({ me: 'hai', role: 'techart', tracked: { slug: 'tail-vfx', stage, directorCalls: [] }, evidence: { pie: { state: 'pass' }, editor: { state: 'pass' } } })
const git = { 'diff --name-only': { stdout: 'Source/S2/Tail/Glow.cpp\n' }, 'diff -U0': { stdout: '+++ b/Source/S2/Tail/Glow.cpp\n+float Glow = 1.f;\n' }, 'worktree list': { stdout: '' } }
const rowText = (tree: unknown, n: number) => text(find(tree, `hai-accept-${n}`))

for (const surface of ['terminal', 'desktop'] as const) {
  test(`A19 (${surface}): a tracked intent in Ship gets the Nghiệm thu A5 card: five rows ✓/✗/– with one line, scored again when files change`, opts(), async ($, on) => {
    const w = world(on, { out: { 'mcp__ather-automata__status': status('Ship') }, git })
    on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
    w.put(`${INTENT}/prompt.md`, PROMPT)
    w.put(`${INTENT}/progress.md`, OPEN)
    const P = { ...A5PANE, surface } as never
    await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
    await $.ui.render(P)
    await w.clock.advance(50) // the score runs off the render
    let tree = await $.ui.render(P)
    expect(keys(tree)).toEqual(['hai-a5-band', 'hai-tiles', 'hai-overview', 'hai-accept', 'hai-a5-rules']) // A29: the A5 pane, the rules last; A33: the band first
    expect(text(find(tree, 'hai-accept-head'))).toContain('Nghiệm thu A5● 1 of 5 not mettail-vfx · Ship · 14:40')
    expect(rowText(tree, 1)).toBe('✓1 Yêu Project, yêu đồng bào· no other session\'s or intent\'s paths; not on main')
    expect(rowText(tree, 2)).toBe('✗2 Học tập tốt, lao động tốt· docs/intent/tail-vfx/progress.md: A2 is open')
    for (const n of [3, 4, 5]) expect(rowText(tree, n).startsWith('✓')).toBe(true)
    if (surface === 'desktop') expect(find(tree, 'hai-accept')?.props?.borderStyle).toBe('round')
    // A2 is proved and progress.md edited: the card scores again.
    w.put(`${INTENT}/progress.md`, MET)
    await $.tool.call({ tool: 'Edit', file_path: `${INTENT}/progress.md`, old_string: '| A2 | open | |', new_string: '| A2 | met | PIE: fade 0.4 s |' })
    await $.ui.render(P)
    await w.clock.advance(50)
    tree = await $.ui.render(P)
    expect(text(find(tree, 'hai-accept-head'))).toContain('5 of 5 met')
    expect(rowText(tree, 2).startsWith('✓')).toBe(true)
  })
}

test('A19: not in Ship, no card until /a5 accept asks for one; without an intent, rule 2 reads –', opts(), async ($, on) => {
  const w = world(on, { out: { 'mcp__ather-automata__status': 'ok' }, git })
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  await $.ui.render(A5PANE as never)
  await w.clock.advance(50)
  expect(find(await $.ui.render(A5PANE as never), 'hai-accept')).toBeUndefined()
  await $.command.run({ command: 'a5', args: 'accept' } as never)
  const tree = await $.ui.render(A5PANE as never)
  expect(text(find(tree, 'hai-accept-head'))).toContain('5 of 5 met')
  expect(rowText(tree, 2)).toBe('–2 Học tập tốt, lao động tốt· no intent: acceptance rows not scored')
})

test('review: when the branch diff cannot be read whole the card says "not scored" and every rule reads – with why', opts(), async ($, on) => {
  const w = world(on, { out: { 'mcp__ather-automata__status': status('Ship') }, git: { ...git, 'diff -U0': { stdout: '', truncated: true } } })
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  w.put(`${INTENT}/prompt.md`, PROMPT)
  w.put(`${INTENT}/progress.md`, MET)
  const P = { ...A5PANE, surface: 'desktop' } as never
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  await $.ui.render(P)
  await w.clock.advance(50)
  const tree = await $.ui.render(P)
  expect(text(find(tree, 'hai-accept-head'))).toContain('● not scored')
  for (const n of [1, 2, 3, 4, 5]) expect(rowText(tree, n).startsWith('–') && rowText(tree, n).endsWith('could not read the whole branch diff (git diff -U0 output passed 4 MiB)')).toBe(true)
})
