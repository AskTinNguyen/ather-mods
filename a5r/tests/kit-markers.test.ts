import { expect, test } from 'claude-code/testing'
import { score, type AcceptInput } from '../hooks/accept.ts'
import { CONFIG } from './config.fixture.ts'
import { PROJ, opts, world } from './world.ts' // the secret below is assembled at run time, never a literal in the repo

// A42 (rev 12): rule 4's debug-leftover check never flags the markers' own definitions or docs: the a5r kit's rules/ and
// tests/ (where A5TMP, debugger;, console.log( are defined and exercised) and Markdown files are skipped; the same
// marker in any other file still fails. Secrets are still checked everywhere.
const MARK = ['A5R', 'TMP'].join('') // spelled apart so this file's own diff carries no marker
const input = (added: [string, string[]][]): AcceptInput => ({
  slug: null,
  branch: 'intent/x',
  files: added.map(([f]) => f),
  added: new Map(added),
  prompt: '',
  progress: '',
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
const rule4 = (added: [string, string[]][]) => score(input(added)).find(s => s.rule === 4)

test("A42: unit: a5r's own config, rules text and tests, and Markdown, raise nothing; the same marker in a source file fails", () => {
  const own: [string, string[]][] = [
    ['a5r/rules/config.json', [`  "forbidden_added": ["${MARK}", "debugger;", "console\\\\.log\\\\("],`]],
    ['a5r/rules/rules-a5r.md', [`Tag temporary debug lines \`${MARK}\`.`]],
    ['a5r/tests/accept.test.ts', [`  added: new Map([['Source/x.cpp', ['int x = 2; // ${MARK}']]]),`, '  console.log(rows)']],
    ['a5r/tests/make_avatar_fixture.mjs', ['console.log(`avatars.fixture.ts: ${rows.length} avatars`)']],
    ['a5r/README.md', [`Gắn \`${MARK}\` cho dòng debug tạm.`]],
    ['docs/intent/x/progress.md', [`no ${MARK} left`]],
  ]
  expect(rule4(own)?.state).toBe('pass')
  const leftover = rule4([...own, ['ather-automata/hooks/squad.mjs', [`const probe = 1 // ${MARK}`]]])
  expect([leftover?.state, leftover?.issues.map(i => i.file)]).toEqual(['fail', ['ather-automata/hooks/squad.mjs']])
  expect(rule4([['a5r/hooks/register.ts', ['debugger;']]])?.state).toBe('fail') // the kit's own code is not exempt
  expect(rule4([['a5r/tests/x.test.ts', [`const key = "${['ghp', '_0123456789abcdefghijklmnopqrstuvwxyz'].join('')}"`]]])?.state).toBe('fail') // a secret still fails
})

test("A42: through the gate: a PR whose diff carries a5r's own marker definitions passes rule 4", opts(), async ($, on) => {
  const diff = `+++ b/a5r/rules/config.json\n+  "forbidden_added": ["${MARK}", "debugger;"],\n+++ b/a5r/tests/kit.test.ts\n+const w = 'int x = 2; // ${MARK}'\n+++ b/a5r/README.md\n+Tag \`${MARK}\`\n`
  world(on, { git: { 'diff --name-only': { stdout: 'a5r/rules/config.json\na5/tests/kit.test.ts\na5/README.md\n' }, 'diff -U0': { stdout: diff }, 'worktree list': { stdout: '' } } })
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  const shown = String((await $.command.run({ command: 'a5r', args: 'accept' } as never)).text)
  expect(shown.split('\n').find(l => l.includes('4 Keep it clean'))).toBe('✓ 4 Keep it clean: no leftovers, secrets, stray files or background work')
})
