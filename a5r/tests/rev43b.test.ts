import { expect, test } from 'claude-code/testing'
import { tokenize } from '../hooks/a5r.ts'
import { blankSession, type Touch } from '../hooks/coord.ts'
import { classifyGit, gitPlace, indexProblem, walk } from '../hooks/gitshared.ts'
import { ME, NOW, PROJ, opts, refused, world } from './world.ts'

// Rev 43, the Fable adversary review of a053aea/6cc79be ("fix first"): 1 nested shells read inside, hidden git writes
// refused; 2 a file two live sessions edited is committed by the one that names it; 3 a quoted span inside a word stays
// one word; 4 `git rm` is noted like an add; 5 an earlier add or rm of the same command counts for its commit; 6 the
// alternative quotes a path with spaces.
const HF = 'E:/s2/Saved/A5R'
const S2 = 'E:/s2'
const ME8 = ME.slice(0, 8)
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const peer = (id8: string): string => JSON.stringify({ ...blankSession(SID(id8), `lane-${id8}`, '', NOW), heartbeatAt: NOW + 600 * 60_000 })
const touch = (w: ReturnType<typeof world>, id8: string, paths: string[], lane = `lane-${id8}`) =>
  w.put(`${HF}/touch/${id8}.json`, JSON.stringify({ session: id8 === ME8 ? ME : SID(id8), id8, lane, paths, updatedAt: NOW }))
const shared = (w: ReturnType<typeof world>) => w.put(`${S2}/.git/HEAD`, 'ref: refs/heads/HaiHuynh/20261005')
const bashRan = (w: ReturnType<typeof world>) => w.seen.filter(e => e.tool === 'Bash').length
const z = (...paths: string[]) => ({ stdout: paths.map(p => `${p}\0`).join('') })
const WALKER = 'docs/intent/walker-unification/findings.md'
const INI = 'Config/DefaultEngine.ini'
const walker = (w: ReturnType<typeof world>) => {
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc'))
  touch(w, 'cccccccc', [WALKER, INI], 'walker')
}

test('Fable 1: git inside powershell -Command, cmd /c and bash -c is read and checked; hidden where it cannot be read, it is refused', opts(), async ($, on) => {
  const w = world(on, { git: { 'diff --cached': z(WALKER), [`-- ${WALKER}`]: { stdout: ` M ${WALKER}\0` } } })
  shared(w)
  walker(w)
  await $.session.start(START)
  const cases: [string, string][] = [
    [`powershell -NoProfile -Command "git -C ${S2} commit -am x"`, 'git commit -a stages and commits every changed tracked file'],
    [`cmd /c "git -C ${S2} commit -a -m x"`, 'git commit -a stages and commits every changed tracked file'],
    [`bash -c "git -C ${S2} commit -m x"`, `${WALKER} (walker's, session cccccccc)`],
    [`powershell -Command "git -C ${S2} add -- ${WALKER}"`, `git add would take work that is not this session's: ${WALKER} (walker's, session cccccccc)`],
    [`powershell -Command "git -C ${S2} checkout -- ${WALKER}"`, `git checkout would discard uncommitted changes in the shared checkout: ${WALKER} (walker's, session cccccccc)`],
    [`eval "git -C ${S2} commit -am x"`, 'sits inside a script, eval or deeper shell'],
    [`cd ${S2} && xargs git add < list.txt`, 'sits inside a script, eval or deeper shell'],
    [`cd ${S2} && timeout 5 xargs git add < list.txt`, 'sits inside a script, eval or deeper shell'], // after a wrapper too
    ['eval "git -C E:\\s2 commit -am x"', 'sits inside a script, eval or deeper shell'], // the checkout written with backslashes
  ]
  for (const [c, why] of cases) expect([c, refused(await $.tool.call({ tool: 'Bash', command: c }))]).toEqual([c, expect.stringContaining(why)])
  expect(bashRan(w)).toBe(0)
  // A script that names no git, and git read inside a shell elsewhere, run.
  for (const c of ['powershell -NoProfile -File D:/tools/report.ps1', 'bash -c "git -C D:/other commit -am x"']) expect([c, refused(await $.tool.call({ tool: 'Bash', command: c }))]).toEqual([c, undefined])
})

test('Fable 2: a file two live sessions edited is committed by the one naming it (the other lane\'s changes go along, and it is told); a discard of it is still refused', opts(), async ($, on) => {
  const w = world(on, { git: { [`-- ${INI}`]: { stdout: ` M ${INI}\0` } } })
  shared(w)
  walker(w)
  touch(w, ME8, [INI])
  await $.session.start(START)
  const ran = await $.tool.call({ tool: 'Bash', command: `git -C ${S2} commit -m "engine ini" -- ${INI}` })
  expect(refused(ran)).toBeUndefined()
  expect(JSON.stringify(ran)).toContain(`${INI} (also walker's): another lane's changes to it go along in this commit`)
  expect(refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} add -- ${INI}` }))).toBeUndefined()
  expect(refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} checkout -- ${INI}` }))).toContain(`${INI} (walker's, session cccccccc; this session touched it too)`)
})

test('Fable 3: unit: a quoted span inside a word stays one word (--author="A B", --date="…", -m"two words")', () => {
  expect(tokenize('git commit --author="A B <x@y>" --date="2026-10-29 10:00" -m"two words" -- "My File.md" it\'s')).toEqual(['git', 'commit', '--author=A B <x@y>', '--date=2026-10-29 10:00', '-mtwo words', '--', 'My File.md', "it's"])
  expect(tokenize(`git -C 'E:/a b' log "x y" plain`)).toEqual(['git', '-C', 'E:/a b', 'log', 'x y', 'plain'])
  const act = (c: string) => classifyGit(gitPlace(walk(c, S2)[0]!).args)
  expect(act('git commit --author="A B <x@y>" --date="2026-10-29 10:00" -m"two words"')).toEqual({ kind: 'staged' })
  expect(act('git commit --author "A B <x@y>" -m x -- a.md')).toEqual({ kind: 'check', sub: 'commit', paths: ['a.md'], untracked: false })
})

test('Fable 4 and 5: a git rm, and an earlier add or rm of the same command, make those paths this session\'s for a plain commit', opts(), async ($, on) => {
  const w = world(on, { git: { 'diff --cached': z('Old.txt', 'New.txt') } })
  shared(w)
  walker(w)
  await $.session.start(START)
  // Both paths staged (as git would after the add): an earlier add in the same command makes New.txt this session's.
  expect(refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} add -- New.txt && git -C ${S2} rm -- Old.txt && git -C ${S2} commit -m x` }))).toBeUndefined()
  // Alone, a plain commit with them staged runs once the rm and the add are on record.
  expect(JSON.parse(w.read(`${HF}/touch/${ME8}.json`)).paths).toEqual(['New.txt', 'Old.txt'])
  expect(refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} commit -m y` }))).toBeUndefined()
})

test('Fable 6: unit: the alternative quotes an own path with spaces', () => {
  const W: Touch = { session: SID('cccccccc'), id8: 'cccccccc', lane: 'walker', paths: [WALKER], updatedAt: NOW }
  expect(indexProblem([WALKER, 'Content/My File.uasset'], new Set(['content/my file.uasset']), [W])?.alt).toBe('commit exactly your own paths, which leaves the others staged: git commit -m "…" -- "Content/My File.uasset"')
})
