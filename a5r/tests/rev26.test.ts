import { expect, test } from 'claude-code/testing'
import { saysNotDone, score, type AcceptInput } from '../hooks/accept.ts'
import { CONFIG } from './config.fixture.ts'

// A72 (MEASURED 2026-10-10 at the close of a5r: 9 false alarms, all A5R's own): rule 2's TODO scan skips what rule 4's
// marker scan skips (docs, Markdown, the kit's rules/ and tests/); rule 5 reads "pending", "todo", "not yet", "chưa"
// in a met row's evidence only as a status (not in code spans, not PENDING.md or a PENDING line, not "a pending request").
const PROMPT = ['# a5r', '- Status: active', 'Change `a5r/` only.', '## Acceptance', '- A1: x. Proof: tests.'].join('\n')
const progress = (evidence: string) => ['# a5r: Progress', '', '## Acceptance', '| Item | Verdict | Evidence |', '| --- | --- | --- |', `| A1 | met | ${evidence} |`].join('\n')
const input = (added: [string, string[]][], evidence = 'tests: 3 pass 0 fail'): AcceptInput => ({
  slug: 'a5r',
  branch: 'intent/a5r',
  files: added.map(([f]) => f),
  added: new Map(added),
  prompt: PROMPT,
  progress: progress(evidence),
  findings: '',
  promptDiff: '',
  proof: null,
  body: '',
  othersTouch: [],
  otherIntents: [],
  untrackedLeft: [],
  strayWorktrees: [],
  runningAgents: [],
  cfg: CONFIG,
  kitDirs: ['a5r/rules/', 'a5r/tests/'],
})
const issues = (x: AcceptInput, rule: number) => score(x).find(s => s.rule === rule)?.issues.map(i => `${i.file ?? ''}: ${i.what}`) ?? []

test('A72: rule 2\'s TODO scan skips the rule\'s own text and the kit\'s regex (the two close-time lines); a source file\'s TODO still counts', () => {
  const readme = '| 2 | Mọi dòng Acceptance `met` có bằng chứng; proof của Ather đủ cho role; TODO/FIXME mới có trong progress.md hoặc findings.md. |'
  const fixture = '  "todo_regex": "\\\\b(TODO|FIXME|HACK|XXX)\\\\b",'
  expect(issues(input([['a5r/README.md', [readme]], ['a5r/tests/config.fixture.ts', [fixture]]]), 2)).toEqual([])
  expect(issues(input([['a5r/hooks/watch.ts', ['// TODO: draw the card']]]), 2)).toEqual(['a5r/hooks/watch.ts: a new TODO/FIXME is not listed in progress.md or findings.md'])
})

test('A72: rule 5 reads the close-time evidence of A10, A13, A23, A52, A56, A62, A64 as done (none flagged)', () => {
  const evidence = [
    'the cleared session still passes the Editor gate and releases; a pending request keeps `requestedAt`; `86 pass 0 fail`', // A10
    '`expired`, notice to the session, one 🟥 (title, unread, one PENDING.md line, alert file), git open again', // A13
    'card `PR #812 · scored after the fact`, one 🟥 (PENDING line, title); listed-at-first-read and', // A23
    'the alert written `withdrawn`, its PENDING line ticked `- [x] … withdrawn …`, no new 🟥', // A52
    'with A2 open the PR runs (no refusal, no dialog, no card, no PENDING line); with A2 waived the same PR is scored', // A56
    'a live holder idle since 14:05 with an open PENDING line naming its session → one `no-editor`', // A62
    'S72 `tests/rev23.test.ts` "A64: a red title and an open PENDING line alone trigger nothing": a holder titled 🟥, two open PENDING lines naming it; `tests/rev22.test.ts` A62 candidates: the mark/PENDING candidate is gone', // A64
  ]
  for (const e of evidence) expect([e.slice(0, 40), saysNotDone(e)]).toEqual([e.slice(0, 40), false])
  expect(issues(input([], evidence.join('; ')), 5)).toEqual([])
})

test('A72: rule 5 still flags a met row whose evidence says it is not done', () => {
  for (const e of ['gate met, pending review', 'met, pending Hai', 'unit tests not run yet', 'chưa chạy test', 'todo: rerun on the real pane', 'not yet measured'])
    expect([e, saysNotDone(e)]).toEqual([e, true])
  expect(issues(input([], 'pending review by Hai'), 5)).toEqual(['docs/intent/a5r/progress.md: A1 is met but its evidence says it is not done'])
})
