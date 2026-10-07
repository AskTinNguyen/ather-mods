import { expect, test } from 'claude-code/testing'
import { ruleCards } from '../hooks/theme.ts'
import { A5PANE, LOCK, PANE, PENDING, PROJ, all, atherTree, find, keys, opts, text, world } from './world.ts'

// A27 → A32 (rev 9): the five rules are the A5 pane's last block as five round seals (red fill, gold rim, gold
// numeral) in one row under "The five rules" (rule 1's country / project word beside it); pressing a seal opens that rule's
// card (name, purpose, "At the action", "Nghiệm thu", "Hits today"), pressing it again closes it. No paragraph.
// The rule lines below follow rules-a5.md's format (`- <n> <name> (<purpose>) [H] … [N] … [P] …`).
const RULES_MD = [
  '## ★ A5 is ON',
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

for (const surface of ['terminal', 'desktop'] as const)
  test(`A32 (${surface}): five seal buttons, last in the A5 pane; a press opens the right card with its four parts; again closes it`, opts(), async ($, on) => {
    world(on, { a5: true, rules: RULES_MD })
    on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
    await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
    const P = { ...A5PANE, surface } as never
    let tree = await $.ui.render(P)
    expect(keys(tree).at(-1)).toBe('hai-a5-rules')
    expect(find(await $.ui.render({ ...PANE, surface } as never), 'hai-a5-rules')).toBeUndefined() // none in Ather's pane
    expect(text(find(tree, 'hai-a5-rules-head')).startsWith('The five rules')).toBe(true)
    expect(find(tree, 'hai-rule1')?.type).toBe('Client') // A20: the switch rides the heading
    const seals = all(find(tree, 'hai-a5-seals')).filter(n => n.type === 'Button').map(n => [n.props?.key, n.props?.label])
    expect(seals).toEqual([1, 2, 3, 4, 5].map(n => [`hai-a5-seal-${n}`, String(n)]))
    for (const n of [1, 2, 3, 4, 5]) expect(find(tree, `hai-a5-seal-${n}-box`)?.props).toMatchObject({ borderStyle: 'round', flexShrink: 0 })
    expect(find(tree, 'hai-a5-rule-card')).toBeUndefined()
    // Rule 3 is hit once (an edit outside the scope file would; here the counter is driven through a refused call).
    await $.ui.press({ plugin: 'a5', key: 'hai-a5-seal-3', surface } as never)
    tree = await $.ui.render(P)
    const card = (find(tree, 'hai-a5-rule-card')?.children ?? []).map(c => text(c))
    expect(card).toEqual(['3 · Unity and discipline', 'right role, right scope, right channel', 'At the action: With a scope file, edits outside it need approval.', 'At acceptance: The diff stays within the paths the intent names.', 'Hits today: 0'])
    expect(text(find(tree, 'hai-a5-seals'))).toBe('') // no paragraph: the seals carry nothing but their numeral labels
    expect(keys(find(tree, 'hai-a5-rules'))).toEqual(['hai-a5-rules-head', 'hai-a5-seals', 'hai-a5-rule-card'])
    await $.ui.press({ plugin: 'a5', key: 'hai-a5-seal-2', surface } as never)
    tree = await $.ui.render(P)
    expect((find(tree, 'hai-a5-rule-card')?.children ?? []).map(c => text(c))[2]).toBe('At the action: — (nothing is blocked at the call)')
    await $.ui.press({ plugin: 'a5', key: 'hai-a5-seal-2', surface } as never)
    expect(find(await $.ui.render(P), 'hai-a5-rule-card')).toBeUndefined()
  })

test('A32: "Hits today" counts the rule\'s hits (a refused --no-verify is rule 1 and 5)', opts(), async ($, on) => {
  world(on, { a5: true, rules: RULES_MD })
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: 'Bash', command: 'git commit --no-verify -m x' })
  await $.ui.render(A5PANE as never)
  await $.ui.press({ plugin: 'a5', key: 'hai-a5-seal-1', surface: 'terminal' } as never)
  const card = (find(await $.ui.render(A5PANE as never), 'hai-a5-rule-card')?.children ?? []).map(c => text(c))
  expect(card.at(-1)).toBe('Hits today: 1')
})

test('A32: motion off keeps the seals with a still "Love the project" beside the heading', { options: { a5WhenPresent: 'deny', editorLock: LOCK, pendingFile: PENDING, motion: 'off' } }, async ($, on) => {
  world(on, { a5: true })
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  const tree = await $.ui.render({ ...A5PANE, surface: 'desktop' } as never)
  expect(text(find(tree, 'hai-a5-rules-head'))).toBe('The five rules·Love the project')
  expect(find(tree, 'hai-rule1')).toBeUndefined()
  expect(keys(tree).at(-1)).toBe('hai-a5-rules')
})
