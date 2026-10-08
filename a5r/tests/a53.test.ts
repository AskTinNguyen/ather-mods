import { expect, test } from 'claude-code/testing'
import { acceptText, cappedItems, type Issue, type RuleScore } from '../hooks/accept.ts'
import { A5RPANE, PROJ, all, find, keys, minWidth, opts, placed, still, text, world, type Tree } from './world.ts'

// A53 (Hai's screenshot: "1 Love / the / project, / love / your / fellow / sessions" beside a long list): the
// acceptance card and the refusal list stay readable however long the list: per rule at most three lines, the rest
// grouped by folder with a count and "and N more"; the full list stays in the `/a5r accept` reply; the rule's name
// on its own line above its items.
const STATUS_TOOL = 'mcp__ather-automata__status'
const SLUG = 'filler'
const PROMPT = ['# Filler enemies', '- Rev: 1', '- Status: active', 'Change `Source/S2/Filler/` only.', '## Acceptance', '- A1: the fillers stagger. Proof: PIE.'].join('\n')
const PROGRESS = [`# ${SLUG}: Progress`, '', '- PR: none yet', '', '## Acceptance', '| Item | Verdict | Evidence |', '| --- | --- | --- |', '| A1 | met | PIE: stagger plays |'].join('\n')
const OTHER = ['# MC loco stop triage', '- Rev: 1', '- Status: active', 'Change `tools/TALab/scenarios/` only.', '## Acceptance', '- A1: x. Proof: y.'].join('\n')
const status = JSON.stringify({ me: 'hai', role: 'techart', tracked: { slug: SLUG, stage: 'Build', prs: [], directorCalls: [] }, evidence: { pie: { state: 'pass' }, editor: { state: 'pass' } } })
const n = (k: number, f: (i: number) => string) => Array.from({ length: k }, (_, i) => f(i))
// 60 paths: 38 another intent names, 12 + 6 + 4 outside this intent's paths in three more folders.
const PATHS = [...n(38, i => `tools/TALab/scenarios/stop-${i}.json`), ...n(12, i => `.agents/skills/explicit-commit-pr/ref-${i}.md`), ...n(6, i => `Config/Tags/T${i}.ini`), ...n(4, i => `Plugins/Foo/F${i}.cpp`)]
const GIT = { 'diff --name-only': { stdout: `${PATHS.join('\n')}\n` }, 'diff -U0': { stdout: '+++ b/Plugins/Foo/F0.cpp\n+int F = 0;\n' }, 'worktree list': { stdout: '' } }
const OUTSIDE = 'outside the paths the intent names'

test('A53: unit: up to three issues are listed one by one; more are grouped by folder with a count, then "and N more"', () => {
  const issue = (file: string, group: string): Issue => ({ file, what: `${group} (one)`, todo: 'fix it', group })
  expect(cappedItems([issue('a/b/c.txt', 'x'), issue('a/d.txt', 'x')]).map(i => i.text)).toEqual(['a/b/c.txt: x (one)', 'a/d.txt: x (one)'])
  const many = PATHS.map(p => issue(p, p.startsWith('tools/') ? 'named by intent mc-loco-stop-triage' : OUTSIDE))
  expect(cappedItems(many.slice(0, 38)).map(i => i.text)).toEqual(['tools/TALab/scenarios/ · 38 files: named by intent mc-loco-stop-triage'])
  expect(cappedItems(many.slice(38)).map(i => i.text)).toEqual([`.agents/skills/explicit-commit-pr/ · 12 files: ${OUTSIDE}`, `Config/Tags/ · 6 files: ${OUTSIDE}`, `Plugins/Foo/ · 4 files: ${OUTSIDE}`])
  const all60 = PATHS.map(p => issue(p, OUTSIDE))
  expect(cappedItems(all60).map(i => i.text)).toEqual([`tools/TALab/scenarios/ · 38 files: ${OUTSIDE}`, `.agents/skills/explicit-commit-pr/ · 12 files: ${OUTSIDE}`, `Config/Tags/ · 6 files: ${OUTSIDE}`, 'and 4 more (/a5r accept lists them all)'])
  // The refusal: the same cap per rule, each line with what to do.
  const scores: RuleScore[] = [{ rule: 3, state: 'fail', line: '', issues: all60 }]
  const lines = acceptText(scores, 'this PR').split('\n').slice(1)
  expect(lines).toEqual([
    `- 3 Unity and discipline: tools/TALab/scenarios/ · 38 files: ${OUTSIDE} → fix it`,
    `- 3 Unity and discipline: .agents/skills/explicit-commit-pr/ · 12 files: ${OUTSIDE} → fix it`,
    `- 3 Unity and discipline: Config/Tags/ · 6 files: ${OUTSIDE} → fix it`,
    '- 3 Unity and discipline: and 4 more (/a5r accept lists them all)',
  ])
})

for (const surface of ['terminal', 'desktop'] as const)
  for (const columns of surface === 'terminal' ? [44, 100] : [40, 100])
    test(`A53 (${surface}, ${columns} columns): a 60-path score: each rule's name on its own line, at most three items and "and N more", the card inside the pane; /a5r accept lists all 60`, opts(), async ($, on) => {
      const w = world(on, { out: { [STATUS_TOOL]: status }, git: GIT })
      w.put(`${PROJ}/docs/intent/${SLUG}/prompt.md`, PROMPT)
      w.put(`${PROJ}/docs/intent/${SLUG}/progress.md`, PROGRESS)
      w.put(`${PROJ}/docs/intent/mc-loco-stop-triage/prompt.md`, OTHER)
      await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
      const reply = String((await $.command.run({ command: 'a5r', args: 'accept' } as never)).text)
      for (const p of PATHS) expect(reply).toContain(p) // the full list stays in the reply
      const P = { ...A5RPANE, surface, props: { ...A5RPANE.props, bodyColumns: columns } } as never
      await $.ui.render(P)
      await w.clock.advance(2_100)
      const tree = still(await $.ui.render(P)) as Tree
      expect(keys(tree)).toContain('hai-accept')
      // Rule 1: one grouped line; rule 3: three folders and "and 4 more".
      const items = (rule: number) => keys(find(tree, `hai-accept-${rule}`)).filter(k => /-item-\d+$/.test(k)).map(k => text(find(tree, k)))
      expect(items(1)).toEqual(['tools/TALab/scenarios/ · 38 files: named by intent mc-loco-stop-triage'])
      expect(items(3)).toEqual([`tools/TALab/scenarios/ · 38 files: ${OUTSIDE}`, `.agents/skills/explicit-commit-pr/ · 12 files: ${OUTSIDE}`, `Config/Tags/ · 6 files: ${OUTSIDE}`, 'and 4 more (/a5r accept lists them all)'])
      for (const rule of [1, 2, 3, 4, 5]) {
        expect([rule, items(rule).length <= 4]).toEqual([rule, true])
        // The name on its own line: the mark and the name only, the name in a box that takes the row's width and wraps at words.
        const name = find(tree, `hai-accept-${rule}-name`) as Tree
        expect([rule, keys(find(tree, `hai-accept-${rule}`))[0], (name.children ?? []).length]).toEqual([rule, `hai-accept-${rule}-name`, 2])
        const title = find(tree, `hai-accept-${rule}-title`) as Tree
        expect([rule, title.props?.flexGrow, all(title).find(t => t.type === 'Text')?.props?.wrap]).toEqual([rule, 1, 'wrap'])
      }
      expect(text(find(tree, 'hai-accept-1-name'))).toBe('✗1 Love the project, love your fellow sessions')
      // The card lies inside the pane; each rule's name row fits its content width (no word-per-line column); every
      // item wraps (a single path longer than the card's text width, 34 characters here at 40 columns, can only break
      // inside the path, as the surface wraps it).
      const card = placed(tree, columns).get('hai-accept')
      expect(card !== undefined && card.x >= 0 && card.x + card.w <= columns).toBe(true)
      const inner = (card?.w ?? 0) - (surface === 'desktop' ? 4 : 0) // the desktop card's border and padding
      for (const rule of [1, 2, 3, 4, 5]) {
        expect([rule, minWidth(find(tree, `hai-accept-${rule}-name`), true) <= inner]).toEqual([rule, true])
        for (const k of keys(find(tree, `hai-accept-${rule}`)).filter(x => /-item-\d+$/.test(x))) expect([k, all(find(tree, k)).find(t => t.type === 'Text')?.props?.wrap]).toEqual([k, 'wrap'])
      }
      for (const p of PATHS.slice(1)) expect(text(find(tree, 'hai-accept'))).not.toContain(p)
    })
