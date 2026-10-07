import { expect, test } from 'claude-code/testing'
import { blankSession, newSync } from '../hooks/coord.ts'
import { A5RPANE, NOW, PANE, PROJ, all, atherTree, opts, world, type Rec } from './world.ts'

// A34: everything a5r shows is English: both panes (every text, label and alt), the dialogs, refusals, notices, the
// /a5r replies and the acceptance texts. One exception, by design: the "UE request:" line a5r sends to a session
// without a5r is the S2 coordination standard's own wording (docs/standards/unreal-editor-session-coordination.md).
const VIETNAMESE = /[ăâđêôơưàáạảãầấậẩẫằắặẳẵèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/i
const HF = 'E:/s2/Saved/A5R'
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const strings = (tree: unknown): string[] =>
  all(tree).flatMap(n => [...(n.children ?? []).filter((c): c is string => typeof c === 'string'), ...['label', 'alt', 'title'].map(k => n.props?.[k]).filter((v): v is string => typeof v === 'string')])
const vietnamese = (xs: readonly string[]) => xs.filter(s => VIETNAMESE.test(s))

for (const surface of ['terminal', 'desktop'] as const)
  test(`A34 (${surface}): no Vietnamese letter in anything a5r draws, asks, refuses, notifies or answers`, opts('ask'), async ($, on) => {
    const w = world(on, { ram: '4.2', ask: 'No' })
    w.put(`${HF}/editor/bbbbbbbb.json`, JSON.stringify(blankSession('bbbbbbbb-1111-4000-8000-000000000000', 'walker', 'Walker', NOW)))
    w.put(`${HF}/sync.json`, JSON.stringify(newSync(T(14, 30), { session: 'bbbbbbbb-1111-4000-8000-000000000000', id8: 'bbbbbbbb', lane: 'walker' }, 'walker', NOW)))
    on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
    await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
    const said: string[] = []
    // Refusals and dialogs: a refused flag, an asked destructive command, a frozen git write, a PR with a failing score.
    for (const command of ['git commit --no-verify -m x', 'git reset --hard', 'git -C E:/s2 commit -m x', 'gh pr create --title t --body b'])
      said.push(JSON.stringify(await $.tool.call({ tool: 'Bash', command })))
    said.push(...(w.calls.ask ?? []).map(a => JSON.stringify(a)))
    for (const args of ['', 'status', 'accept', 'gate', 'gate many', 'sync', 'on']) said.push(String((await $.command.run({ command: 'a5r', args } as never)).text))
    said.push(...(w.calls['prompt.submit'] ?? []).map(e => String((e as Rec).text)), ...(w.calls['ui.toast'] ?? []).map(e => JSON.stringify(e)), ...(w.calls['ui.status'] ?? []).map(e => JSON.stringify(e)))
    // Both panes, with a rule card open and the acceptance card drawn.
    await $.ui.render({ ...A5RPANE, surface } as never)
    await $.ui.press({ plugin: 'a5r', key: 'hai-a5r-chip-1', surface } as never)
    const drawn = [...strings(await $.ui.render({ ...A5RPANE, surface } as never)), ...strings(await $.ui.render({ ...PANE, surface } as never))]
    expect(drawn.length).toBeGreaterThan(20)
    expect(vietnamese(drawn)).toEqual([])
    expect(vietnamese(said.filter(s => !s.includes('UE request:')))).toEqual([])
  })
