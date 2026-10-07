import { expect, test } from 'claude-code/testing'
import { blankSession, newSync } from '../hooks/coord.ts'
import { OLD, OLD_NAMES, oldNamesIn, uncovered } from './old-names.ts'
import { A5RPANE, NOW, PANE, PROJ, all, atherTree, opts, world, type Rec } from './world.ts'

// A48 (rev 15): the feature is A5R (Agent 5 Rules). Nothing a5r builds at run time carries an old name: both panes
// (every text, label, alt, title and Svg source), the dialogs, refusals, notices, toasts, status, the /a5r replies, the
// registered command, tools and agent, the pane it opens and its prompt section. The files of the mod are scanned by
// tests/scan-old-names.mjs (the runner has no file system); both read the names and exceptions in tests/old-names.ts.
const U = OLD.upper
const L = OLD.lower
const HF = 'E:/s2/Saved/A5R'
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()

test('A48: unit: every old form is an old name; the A5R forms, hex colours and row ids are not', () => {
  const old = [`${U} · Editor — granted`, `★ ${U} ›`, `${L}:sync`, `mcp__${L}__editor`, `Saved/${U}/sync.json`, `/${L} on`, `${U}TMP`, `${OLD.flow} · refused`, `# Hai${"'"}s flow`, `hai-${L}-line`, `${U}_LOOK`, `read${U}`, `${L}On`, `"name": "${L}"`, `Nghiệm thu ${U}`]
  for (const s of old) expect([s, oldNamesIn(s).length > 0]).toEqual([s, true])
  const fresh = ['A5R · Editor — granted', '★ A5R ›', 'a5r:sync', 'mcp__a5r__editor', 'Saved/A5R/sync.json', '/a5r on', 'A5RTMP', 'hai-a5r-line', 'A5R_LOOK', 'readA5R', 'a5rOn', '"name": "a5r"', 'Nghiệm thu A5R', 'fill="#A5B4C3"', 'row A50 met', 'A 5 R']
  for (const s of fresh) expect([s, oldNamesIn(s)]).toEqual([s, []])
  expect(OLD_NAMES.length).toBe(8)
})

const strings = (tree: unknown): string[] =>
  all(tree).flatMap(n => [...(n.children ?? []).filter((c): c is string => typeof c === 'string'), ...['label', 'alt', 'title', 'source'].map(k => n.props?.[k]).filter((v): v is string => typeof v === 'string')])

for (const surface of ['terminal', 'desktop'] as const)
  test(`A48 (${surface}): no old name in anything a5r draws, registers, asks, refuses, notifies or answers`, opts('ask'), async ($, on) => {
    const w = world(on, { ram: '4.2', ask: 'No' })
    w.put(`${HF}/editor/bbbbbbbb.json`, JSON.stringify(blankSession('bbbbbbbb-1111-4000-8000-000000000000', 'walker', 'Walker', NOW)))
    w.put(`${HF}/sync.json`, JSON.stringify(newSync(T(14, 30), { session: 'bbbbbbbb-1111-4000-8000-000000000000', id8: 'bbbbbbbb', lane: 'walker' }, 'walker', NOW)))
    on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
    on('prompt.compose', async () => ({ sections: [] })) // the engine's own sections; a5r adds its rules section on top
    await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
    const said: string[] = []
    for (const command of ['git commit --no-verify -m x', 'git reset --hard', 'git -C E:/s2 commit -m x', ['gh', 'pr', 'create', '--title t --body b'].join(' ')])
      said.push(JSON.stringify(await $.tool.call({ tool: 'Bash', command })))
    for (const args of ['', 'status', 'accept', 'gate', 'gate many', 'gate 30 27', 'gate reset', 'sync', 'sync 15:10', 'nonsense', 'on'])
      said.push(String((await $.command.run({ command: 'a5r', args } as never)).text))
    // Both panes, a rule card open, the compact line's button pressed (the pane it opens).
    await $.ui.render({ ...A5RPANE, surface } as never)
    await $.ui.press({ plugin: 'a5r', key: 'hai-a5r-chip-1', surface } as never)
    const drawn = [...strings(await $.ui.render({ ...A5RPANE, surface } as never)), ...strings(await $.ui.render({ ...PANE, surface } as never))]
    await $.ui.press({ plugin: 'a5r', key: 'hai-a5r-open', surface } as never)
    const sections = (await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [surface], tools: ['Bash'], outputStyle: null, traits: [] } as never)).sections.filter(s => s.id.startsWith('a5r'))
    said.push(String((await $.command.run({ command: 'a5r', args: 'off' } as never)).text))
    said.push(JSON.stringify(await $.tool.call({ tool: 'Bash', command: 'git commit --no-verify -m x' })))
    for (const ev of ['ask', 'prompt.submit', 'ui.toast', 'ui.status', 'ui.log', 'ui.open', 'command.register', 'tool.register', 'agent.register'])
      said.push(...(w.calls[ev] ?? []).map(e => JSON.stringify(e)))
    expect(drawn.length).toBeGreaterThan(20)
    expect(uncovered([...drawn, ...said, ...sections.map(s => JSON.stringify(s))].join('\n'))).toEqual([])
    // The A5R names themselves.
    expect((w.calls['command.register'] ?? []).map(e => (e as Rec).name)).toEqual(['a5r'])
    expect((w.calls['tool.register'] ?? []).map(e => (e as Rec).name)).toEqual(['editor', 'sync']) // mcp__a5r__editor, mcp__a5r__sync
    expect((w.calls['ui.open'] ?? [])[0]).toEqual({ id: 'a5r', title: 'A5R' })
    expect(sections.map(s => s.id)).toEqual(['a5r:rules'])
    expect(said.some(s => s.includes('A5R · '))).toBe(true)
  })
