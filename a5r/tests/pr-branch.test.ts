import { expect, test } from 'claude-code/testing'
import { commandText, isPrCommand, prCommandRefs } from '../hooks/accept.ts'
import { PROJ, opts, refused, world, type Rec } from './world.ts'

// A41 (rev 12): acceptance scores the branch the PR is opened from: the repository and head come from the command
// (-R/--repo, --head, --base, a leading cd, gh api's path and fields, an MCP tool's input) and are matched to the local
// worktree that has that head checked out; a head no worktree holds is read from origin/<head>; a folder with no
// repository or a head found nowhere is "not scored", never another branch's score. The intent is the one the branch's
// diff touches, not the session's tracked one.
const STATUS_TOOL = 'mcp__ather-automata__status'
const WT = 'E:/wt/avatar-frame'
const GH = ['gh', 'pr', 'create'].join(' ') // spelled apart so this file's own text is never a PR command
const PR = `${GH} -R AskTinNguyen/ather-mods --base main --head intent/avatar-frame --title "Ather: avatar frame" --body "PIE n/a"`
// The session: on intent/a5r-old with its own intent (open rows), tracked by Ather.
const SESSION_STATUS = JSON.stringify({ me: 'hai', role: 'engineer', tracked: { slug: 'a5r-old', directorCalls: [] }, evidence: {} })
// A56 (rev 21): an unread PR is scored under the tracked intent, which enters acceptance only at its checklist's end.
const SESSION_DONE = JSON.stringify({ me: 'hai', role: 'engineer', tracked: { slug: 'a5r-old', checklist: '1/1', directorCalls: [] }, evidence: {} })
const WORKTREES = `worktree ${PROJ}\nHEAD 1111\nbranch refs/heads/intent/a5r-old\n\nworktree ${WT}\nHEAD 2222\nbranch refs/heads/intent/avatar-frame\n`
const machine = (w: ReturnType<typeof world>) => {
  w.put(`${PROJ}/docs/intent/a5r-old/prompt.md`, ['# a5r-old', '- Status: active', 'Change \`a5r/\` only.', '## Acceptance', '- A1: x. Proof: tests.'].join('\n'))
  w.put(`${PROJ}/docs/intent/a5r-old/progress.md`, '| Item | Verdict | Evidence |\n| --- | --- | --- |\n| A1 | open | |\n')
  w.put(`${WT}/.git`, 'gitdir: E:/proj/.git/worktrees/avatar-frame')
  w.put(`${WT}/docs/intent/avatar-frame/prompt.md`, ['# avatar-frame', '- Status: active', 'Change \`ather-automata/hooks/squad.mjs\` only.', '## Acceptance', '- A1: the frame. Proof: tests.'].join('\n'))
  w.put(`${WT}/docs/intent/avatar-frame/progress.md`, '| Item | Verdict | Evidence |\n| --- | --- | --- |\n| A1 | met | tests: 12 pass 0 fail |\n')
  w.put(`${WT}/docs/intent/avatar-frame/findings.md`, '# Findings\n')
}
const git = (wtDiff: string, extra: Record<string, { stdout: string; exitCode?: number }> = {}) => ({
  ...extra,
  'worktree list': { stdout: WORKTREES },
  [`${WT} diff --name-only`]: { stdout: 'ather-automata/hooks/squad.mjs\ndocs/intent/avatar-frame/progress.md\n' },
  [`${WT} diff -U0`]: { stdout: wtDiff },
  [`${PROJ} diff --name-only`]: { stdout: 'a5r/hooks/register.ts\na5/rules/config.json\n' },
  [`${PROJ} diff -U0`]: { stdout: '+++ b/a5r/hooks/register.ts\n+const x = 1 // A5TMP\n' },
  'remote -v': { stdout: 'origin\thttps://github.com/AskTinNguyen/ather-mods.git (fetch)\norigin\thttps://github.com/AskTinNguyen/ather-mods.git (push)\n' }, // A47 (b): remotes from git remote -v
})
const CLEAN = '+++ b/ather-automata/hooks/squad.mjs\n+const frame = 1\n'

test('A41: unit: the PR command names its repository, head, base and folder; here-document text is not a command', () => {
  expect(prCommandRefs(PR)).toEqual({ repo: 'AskTinNguyen/ather-mods', head: 'intent/avatar-frame', base: 'main' })
  expect(prCommandRefs(`cd "D:/x y" && ${GH} --repo=o/r --head=o:feat -B dev`)).toEqual({ dir: 'D:/x y', repo: 'o/r', head: 'o:feat', base: 'dev' })
  expect(prCommandRefs('gh api repos/o/r/pulls -f head=feat -f base=main -f title=t')).toEqual({ repo: 'o/r', head: 'feat', base: 'main' })
  const heredoc = `cat >> notes.md <<'EOF'\nrun ${GH} --head x when done\nEOF\necho ok`
  expect([commandText(heredoc), isPrCommand(heredoc)]).toEqual(["cat >> notes.md <<'EOF'\necho ok", false])
  expect([isPrCommand(`echo "${GH}"`), isPrCommand(`git push && ${GH} --fill`), isPrCommand(PR)]).toEqual([false, true, true])
})

test("A41: the avatar-frame case: the session is on another branch with an open intent; the PR's head is checked out in a second worktree: scored there, it passes", opts(), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: SESSION_STATUS }, git: git(CLEAN) })
  machine(w)
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  expect(refused(await $.tool.call({ tool: 'Bash', command: PR }))).toBeUndefined()
  expect(w.seen.filter(e => e.tool === 'Bash' && String(e.command) === PR).length).toBe(1)
  const diffs = w.runs.filter(r => r.includes('diff --name-only'))
  expect(diffs.length).toBe(1)
  expect(diffs[0]?.startsWith(`git -C ${WT} diff --name-only origin/main...HEAD`)).toBe(true) // the worktree, never the session's checkout
})

test('A41: the same PR with a leftover in that worktree is refused for that worktree\'s file, under that branch\'s intent', opts(), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: SESSION_STATUS }, git: git(`${CLEAN}+let probe = 1 // A5TMP\n`) })
  machine(w)
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  const why = refused(await $.tool.call({ tool: 'Bash', command: PR })) ?? ''
  expect(why).toContain('- 4 Keep it clean: ather-automata/hooks/squad.mjs: a debug leftover')
  expect(why).not.toContain('a5r-old') // the session's own intent plays no part
  expect(why).not.toContain('a5r/hooks/register.ts')
})

test('A41: a head no worktree holds is read from origin/<head> without a checkout; a head found nowhere is not scored', opts(), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: SESSION_DONE }, git: { ...git(CLEAN), 'worktree list': { stdout: `worktree ${PROJ}\nbranch refs/heads/intent/a5r-old\n` }, 'origin/intent/gone^{commit}': { stdout: '', exitCode: 1 }, 'intent/gone^{commit}': { stdout: '', exitCode: 1 } } })
  machine(w)
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  await $.tool.call({ tool: 'Bash', command: PR })
  expect(w.runs.find(r => r.includes('diff --name-only'))).toBe(`git -C ${PROJ} diff --name-only origin/main...origin/intent/avatar-frame`)
  const why = refused(await $.tool.call({ tool: 'Bash', command: PR.replace('intent/avatar-frame', 'intent/gone') }))
  expect(why).toBe('A5R · Acceptance — could not read the whole branch diff (head intent/gone is neither checked out in a worktree of this repository nor at origin/intent/gone: fetch it, or open the PR from its own checkout) → open the PR from a slice branch cut from origin/main and call again (nothing waits on an answer; Hai lets one through with /a5r pass)')
})

test('A41: a PR run from a folder with no repository is not scored (never the session\'s checkout instead)', opts(), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: SESSION_DONE }, git: { ...git(CLEAN), 'E:/nowhere rev-parse --show-toplevel': { stdout: '', exitCode: 128 } } })
  machine(w)
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  expect(refused(await $.tool.call({ tool: 'Bash', command: `cd E:/nowhere && ${GH} --head intent/avatar-frame --fill` }))).toContain('could not read the whole branch diff (no git repository at E:/nowhere)')
  expect(w.runs.some(r => r.includes(`${PROJ} diff`))).toBe(false)
})

test('A41: an MCP create-PR tool is matched the same way: its owner/repo/head/base pick the worktree', opts(), async ($, on) => {
  const w = world(on, { out: { [STATUS_TOOL]: SESSION_STATUS }, git: git(CLEAN) })
  machine(w)
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  const call = { tool: 'mcp__github__create_pull_request', owner: 'AskTinNguyen', repo: 'ather-mods', head: 'intent/avatar-frame', base: 'main', title: 't', body: 'b' } as Rec
  expect(refused(await $.tool.call(call as never))).toBeUndefined()
  expect(w.runs.find(r => r.includes('diff --name-only'))?.startsWith(`git -C ${WT} `)).toBe(true)
})
