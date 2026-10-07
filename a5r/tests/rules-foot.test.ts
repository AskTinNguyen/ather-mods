import { expect, test } from 'claude-code/testing'
import { ruleCards } from '../hooks/theme.ts'
import { A5RPANE, LOCK, PANE, PENDING, PROJ, all, atherTree, find, keys, opts, text, still, world } from './world.ts'

// A27 → A32 (rev 9) → A36 (rev 10, mockup v2): the five rules are the A5R pane's last block as five round seals (red fill, gold rim, gold
// numeral) in one row under "The five rules" (rule 1's country / project word beside it); pressing a seal opens that rule's
// card (name, purpose, "At the action", "Nghiệm thu", "Hits today"), pressing it again closes it. No paragraph.
// The rule lines below follow rules-a5r.md's format (`- <n> <name> (<purpose>) [H] … [N] … [P] …`).
const RULES_MD = [
  '## ★ A5R is ON',
  "- 1 Love the project, love your fellow sessions (keep shared state and other sessions' work safe) [H] In the shared checkout, git that discards work needs Hai's approval. More text. [N] No path another live session is editing; nothing straight onto main. Tail.",
  '- 2 Study well, work well (understand before acting, finish to proof) [P] Read the target first. [N] Every Acceptance row marked met carries its evidence; more.',
  '- 3 Unity and discipline (right role, right scope, right channel) [P] One writer per intent file. [H] With a scope file, edits outside it need approval. [N] The diff stays within the paths the intent names.',
  '- 4 Keep it clean (leave it clean) [H] Secrets in edits are refused. [P] Tag debug lines. [N] No debug leftovers or secrets in the diff.',
  '- 5 Modest, honest, brave (claim only what was measured) [H] Removing test assertions needs approval. [P] Label claims. [N] The PR body claims no proof rung that Ather has not read pass.',
].join('\n')

test('A32: unit: the cards come from the rule lines: name, purpose, the first sentence of each [H] and [N]', () => {
  const cards = ruleCards(RULES_MD)
  expect(cards.map(c => c.name)).toEqual(['Love the project, love your fellow sessions', 'Study well, work well', 'Unity and discipline', 'Keep it clean', 'Modest, honest, brave'])
  expect(cards[0]).toEqual({ n: 1, id: 'D1', name: 'Love the project, love your fellow sessions', purpose: "keep shared state and other sessions' work safe", action: "In the shared checkout, git that discards work needs Hai's approval.", accept: 'No path another live session is editing;' })
  expect([cards[1]?.action, cards[1]?.accept]).toEqual(['', 'Every Acceptance row marked met carries its evidence;'])
  expect(ruleCards('').map(c => [c.name, c.purpose, c.action])).toEqual([['Love the project, love your fellow sessions', '', ''], ['Study well, work well', '', ''], ['Unity and discipline', '', ''], ['Keep it clean', '', ''], ['Modest, honest, brave', '', '']])
})

const RIM = { neutral: '#3A3833', red: '#E5534B', gold: '#F2C14E' } // A40: the dark theme's hit red (#B3261E reads 2.7:1 on the dark pane)
const SHORT = ['1 Love the project', '2 Study and work well', '3 Unity and discipline', '4 Keep it clean', '5 Modest, honest, brave']
const rims = (tree: unknown) => [1, 2, 3, 4, 5].map(n => find(tree, `hai-a5r-chip-${n}-box`)?.props?.borderColor)

for (const surface of ['terminal', 'desktop'] as const)
  test(`A36 (${surface}): five quiet chips, last in the A5R pane; a press shows the right card below a hairline; again hides it`, opts(), async ($, on) => {
    world(on, { a5r: true, rules: RULES_MD })
    on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
    await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
    const P = { ...A5RPANE, surface } as never
    let tree = still(await $.ui.render(P))
    expect(keys(tree).at(-1)).toBe('hai-a5r-rules')
    expect(find(await $.ui.render({ ...PANE, surface } as never), 'hai-a5r-rules')).toBeUndefined() // none in Ather's pane
    expect(text(find(tree, 'hai-a5r-rules-head')).startsWith('THE FIVE RULES')).toBe(true)
    expect(find(tree, 'hai-rule1')?.type).toBe('Client') // A20: the switch rides the label
    const chips = all(find(tree, 'hai-a5r-chips')).filter(n => n.type === 'Button').map(n => [n.props?.key, n.props?.label])
    expect(chips).toEqual(SHORT.map((label, i) => [`hai-a5r-chip-${i + 1}`, label]))
    expect(find(tree, 'hai-a5r-chips')?.props).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' })
    for (const n of [1, 2, 3, 4, 5]) expect(find(tree, `hai-a5r-chip-${n}-box`)?.props).toMatchObject({ borderStyle: 'round', flexShrink: 0 })
    expect(rims(tree)).toEqual([RIM.neutral, RIM.neutral, RIM.neutral, RIM.neutral, RIM.neutral]) // nothing hit: no red
    expect(find(tree, 'hai-a5r-rule-card')).toBeUndefined()
    await $.ui.press({ plugin: 'a5r', key: 'hai-a5r-chip-3', surface } as never)
    tree = still(await $.ui.render(P))
    expect(rims(tree)).toEqual([RIM.neutral, RIM.neutral, RIM.gold, RIM.neutral, RIM.neutral]) // the selected one gold
    expect(keys(find(tree, 'hai-a5r-rules'))).toEqual(['hai-a5r-rules-head', 'hai-a5r-chips', 'hai-a5r-rule-hair', 'hai-a5r-rule-card'])
    const card = (find(tree, 'hai-a5r-rule-card')?.children ?? []).map(c => text(c))
    expect(card).toEqual(['Unity and discipline', 'right role, right scope, right channel', 'At the action: With a scope file, edits outside it need approval.', 'At acceptance: The diff stays within the paths the intent names.', 'Hits today: 0'])
    await $.ui.press({ plugin: 'a5r', key: 'hai-a5r-chip-2', surface } as never)
    tree = still(await $.ui.render(P))
    expect((find(tree, 'hai-a5r-rule-card')?.children ?? []).map(c => text(c))[2]).toBe('At the action: — (nothing is blocked at the call)')
    await $.ui.press({ plugin: 'a5r', key: 'hai-a5r-chip-2', surface } as never)
    tree = still(await $.ui.render(P))
    expect([find(tree, 'hai-a5r-rule-card'), find(tree, 'hai-a5r-rule-hair')]).toEqual([undefined, undefined])
    expect(rims(tree)).toEqual([RIM.neutral, RIM.neutral, RIM.neutral, RIM.neutral, RIM.neutral])
  })

test('A36: a rule hit today turns its chip\'s rim red (only that rule), and its card says "Hits today: 1" in red', opts(), async ($, on) => {
  world(on, { a5r: true, rules: RULES_MD })
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: 'Bash', command: 'git push --force origin HaiHuynh/x' }) // rule 1, asked and refused (deny mode)
  let tree = await $.ui.render(A5RPANE as never)
  expect(rims(tree)).toEqual([RIM.red, RIM.neutral, RIM.neutral, RIM.neutral, RIM.neutral])
  await $.ui.press({ plugin: 'a5r', key: 'hai-a5r-chip-1', surface: 'terminal' } as never)
  tree = await $.ui.render(A5RPANE as never)
  expect(rims(tree)[0]).toBe(RIM.gold) // selected wins over hit
  const last = (find(tree, 'hai-a5r-rule-card')?.children ?? []).at(-1) as { props?: { color?: string } }
  expect([text(last), last.props?.color]).toEqual(['Hits today: 1', RIM.red])
})

test('A36: motion off keeps the chips with a still "Love the project" beside the label', { options: { a5rWhenPresent: 'deny', editorLock: LOCK, pendingFile: PENDING, motion: 'off' } }, async ($, on) => {
  world(on, { a5r: true })
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  const tree = await $.ui.render({ ...A5RPANE, surface: 'desktop' } as never)
  expect(text(find(tree, 'hai-a5r-rules-head'))).toBe('THE FIVE RULES·Love the project')
  expect(find(tree, 'hai-rule1')).toBeUndefined()
  expect(keys(tree).at(-1)).toBe('hai-a5r-rules')
})
