import { expect, test } from 'claude-code/testing'
import { blankSession, parseSessionFile, withoutModOf, type LaneBeat, type SessionFile, type Touch } from '../hooks/coord.ts'
import { classifyGit, indexProblem } from '../hooks/gitshared.ts'
import { headOwner } from '../hooks/opguard.ts'
import { ME, NOW, PROJ, opts, refused, world } from './world.ts'

// Rev 43 (L-47): A126 no lane commits another lane's work (the shared index); A127 every live A5R session is seen at the
// sync cutoff (a slow tick no longer makes a session look mod-less).
const HF = 'E:/s2/Saved/A5R'
const S2 = 'E:/s2'
const ME8 = ME.slice(0, 8)
const MIN = 60_000
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const peer = (id8: string, at = NOW + 600 * MIN): string => JSON.stringify({ ...blankSession(SID(id8), `lane-${id8}`, '', NOW), heartbeatAt: at })
const touch = (w: ReturnType<typeof world>, id8: string, paths: string[], lane = `lane-${id8}`) =>
  w.put(`${HF}/touch/${id8}.json`, JSON.stringify({ session: id8 === ME8 ? ME : SID(id8), id8, lane, paths, updatedAt: NOW }))
const shared = (w: ReturnType<typeof world>) => w.put(`${S2}/.git/HEAD`, 'ref: refs/heads/HaiHuynh/20261005')
const bashRan = (w: ReturnType<typeof world>) => w.seen.filter(e => e.tool === 'Bash').length
const z = (...paths: string[]) => ({ stdout: paths.map(p => `${p}\0`).join('') })
const WALKER = 'docs/intent/walker-unification/findings.md'
const MINE = 'tools/MHMarkerlessBatch/locate.py'
const W: Touch = { session: SID('cccccccc'), id8: 'cccccccc', lane: 'walker', paths: [WALKER], updatedAt: NOW }

// ---------- A126: units ----------
test('A126: unit: classifyGit reads the commit and add forms of the shared index (long options by any unambiguous prefix, as git)', () => {
  const g = (c: string) => classifyGit(c.split(' '))
  const check = (sub: string, paths: string[]) => ({ kind: 'check', sub, paths, untracked: sub === 'add' })
  expect(g('commit -m x')).toEqual({ kind: 'staged' })
  expect(g('commit -qm msg --no-edit')).toEqual({ kind: 'staged' }) // `msg` is -m's value, no path
  expect(g('commit -m x -- a.md b.md')).toEqual(check('commit', ['a.md', 'b.md']))
  expect(g('commit -m x a.md 2>&1')).toEqual(check('commit', ['a.md'])) // a redirect is no path
  expect(g('commit --only -m x a.md')).toEqual(check('commit', ['a.md']))
  expect(g('commit --mess x -- a.md')).toEqual(check('commit', ['a.md'])) // --mess is --message: x is its value
  for (const c of ['commit -am x', 'commit -a -m x', 'commit --all -m x', 'commit --amen -m x', 'commit -qam x -- a.md', 'commit -i -m x a.md', 'commit --pathspec-from-file=f']) expect([c, g(c)?.kind]).toEqual([c, 'refuse'])
  for (const c of ['commit --amend --no-edit', 'commit --am --no-edit', 'commit --amend -m x -- a.md']) expect([c, (g(c) as { why?: string })?.why]).toEqual([c, expect.stringContaining('rewrites HEAD')])
  for (const c of ['commit --dry-run -m x', 'commit --dry -m x']) expect([c, g(c)]).toEqual([c, null])
  expect(g('add a.md b/')).toEqual(check('add', ['a.md', 'b/']))
  expect(g('add -u -- a.md')).toEqual(check('add', ['a.md']))
  for (const c of ['add -u', 'add --upd']) expect([c, g(c)?.kind]).toEqual([c, 'refuse'])
  for (const c of ['add -A', 'add .', 'add --all', 'add -- .', 'add -Av', 'add --al', 'add -f .', 'add -u .']) expect([c, g(c)?.kind]).toEqual([c, 'refuse']) // the whole tree, in any form
  for (const c of ['add -n x', 'add --dry-run .']) expect([c, g(c)]).toEqual([c, null])
})

test('A126: unit: indexProblem names each foreign staged path and its owner, and offers the commit of exactly this session\'s', () => {
  const mine = new Set([MINE.toLowerCase()])
  const staged = indexProblem([WALKER, MINE], mine, [W])
  expect(staged?.why).toBe(`a commit without paths takes the whole shared index, which holds work that is not this session's: ${WALKER} (walker's, session cccccccc)`)
  expect(staged?.alt).toBe(`commit exactly your own paths, which leaves the others staged: git commit -m "…" -- ${MINE}`)
  expect(indexProblem(['Config/X.ini'], mine, [W])?.why).toContain('Config/X.ini (no session claims it)')
  expect(indexProblem(null, mine, [W])?.why).toContain('could not be read within 8 s')
  expect(indexProblem([MINE], mine, [W])).toBeNull()
})

// ---------- A126: the Proof, through the engine ----------
test('A126: a plain commit with another lane\'s staged path is refused, naming it and its owner, and recorded', opts(), async ($, on) => {
  const w = world(on, { git: { 'diff --cached': z(WALKER, MINE) } })
  shared(w)
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc'))
  touch(w, 'cccccccc', [WALKER], 'walker')
  touch(w, ME8, [MINE])
  await $.session.start(START)
  const why = refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} commit -m "markerless: engine dirs"` }))
  expect(why).toContain(`${WALKER} (walker's, session cccccccc)`)
  expect(why).toContain(`→ commit exactly your own paths, which leaves the others staged: git commit -m "…" -- ${MINE}`)
  expect(bashRan(w)).toBe(0)
  expect(w.runs).toContain(`git -C ${S2} diff --cached --name-only -z`) // one fast read of the index, no status
  expect(w.read(`${HF}/orchestrate.log`)).toContain('| rule=shared-git |')
})

test('A126: a commit with -- <own paths> runs while another lane\'s path is staged; one taking another live session\'s changed path is refused', opts(), async ($, on) => {
  const w = world(on, { git: { 'diff --cached': z(WALKER, MINE), [`-- ${WALKER}`]: { stdout: ` M ${WALKER}\0` } } })
  shared(w)
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc'))
  touch(w, 'cccccccc', [WALKER], 'walker')
  touch(w, ME8, [MINE])
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} commit -m "markerless" -- ${MINE}` }))).toBeUndefined()
  expect(w.runs.filter(r => r.includes('diff --cached'))).toEqual([]) // the index is not read: git commits only those paths
  expect(w.runs).toContain(`git -C ${S2} status --porcelain=v1 -z --untracked-files=no -- ${MINE}`) // one path-scoped status
  expect(refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} commit -m "x" -- ${WALKER}` }))).toContain(`git commit would take work that is not this session's: ${WALKER} (walker's, session cccccccc)`)
  // Once the walker session is gone (its file stale, no lane), its path is the committer's to name.
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', NOW - 20 * MIN))
  await w.clock.advance(MIN) // read at the next minute
  expect(refused(await $.tool.call({ tool: 'Bash', command: `cd ${S2} && git commit -m "x" -- ${WALKER}` }))).toBeUndefined()
})

test('A126: a folder commit or add takes only this session\'s work: an unclaimed file swept in under it is refused', opts(), async ($, on) => {
  const DIR = 'tools/MHMarkerlessBatch'
  const w = world(on, { git: { [`-- ${DIR}/sub`]: { stdout: ` M ${MINE}\0` }, [`-- ${DIR}`]: { stdout: ` M ${MINE}\0?? ${DIR}/other_lane.py\0` } } })
  shared(w)
  touch(w, ME8, [MINE])
  await $.session.start(START)
  for (const c of [`git -C ${S2} add -- ${DIR}/`, `git -C ${S2} commit -m x -- ${DIR}/`]) expect([c, refused(await $.tool.call({ tool: 'Bash', command: c }))]).toEqual([c, expect.stringContaining(`would take work that is not this session's: ${DIR}/other_lane.py (no session claims it)`)])
  expect(refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} add -- Source` }))).toContain('(a whole top folder) cannot be checked on facts')
  // A folder add that passes adds nothing to the touch set: only files named exactly are recorded (review finding 1).
  expect(refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} add -- ${DIR}/sub/` }))).toBeUndefined()
  expect(JSON.parse(w.read(`${HF}/touch/${ME8}.json`)).paths).toEqual([MINE])
})

test('A126: commit -a, -am and --amend are refused in the shared checkout with the path-limited alternative', opts(), async ($, on) => {
  const w = world(on)
  shared(w)
  await $.session.start(START)
  for (const c of [`git -C ${S2} commit -am "x"`, `git -C ${S2} commit -a -m "x"`, `cd ${S2} && git commit --all -m "x"`]) expect([c, refused(await $.tool.call({ tool: 'Bash', command: c }))]).toEqual([c, expect.stringContaining('git commit -a stages and commits every changed tracked file of the shared checkout')])
  expect(refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} commit --amend --no-edit` }))).toContain('which may be another lane\'s (the shared S2 checkout E:/s2) → make a new commit instead: commit exactly your own paths')
  expect(bashRan(w)).toBe(0)
})

test('A126: add of another live session\'s path is refused naming the owner; this session\'s own add runs and is its own at a plain commit', opts(), async ($, on) => {
  const w = world(on, { git: { [`-- ${WALKER}`]: { stdout: `?? ${WALKER}\0` }, [`-- docs/intent/walker-unification`]: { stdout: `?? ${WALKER}\0` }, 'diff --cached': z(MINE) } })
  shared(w)
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc'))
  touch(w, 'cccccccc', [WALKER], 'walker')
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} add -- ${WALKER}` }))).toContain(`${WALKER} (walker's, session cccccccc) → leave it to its owner and stage exact paths: git add -- <path> ... (your own)`)
  expect(refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} add -- docs/intent/walker-unification/` }))).toContain('(walker\'s, session cccccccc)')
  // A file this session wrote by shell, staged by its own add: the staged path joins its touch set.
  expect(refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} add -- ${MINE}` }))).toBeUndefined()
  expect(JSON.parse(w.read(`${HF}/touch/${ME8}.json`)).paths).toEqual([MINE])
  expect(refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} commit -m "markerless"` }))).toBeUndefined()
})

test('A126: a worktree or another repository is untouched; a commit that ends a merge is the merge guard\'s', opts(), async ($, on) => {
  const w = world(on, { git: { 'diff --cached': z(WALKER) } })
  shared(w)
  w.put('E:/wt/x/.git', 'gitdir: E:/s2/.git/worktrees/x')
  w.put('D:/other/.git/HEAD', 'ref: refs/heads/mine')
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc'))
  touch(w, 'cccccccc', [WALKER], 'walker')
  await $.session.start(START)
  for (const c of ['git -C E:/wt/x commit -am "own worktree"', 'git -C E:/wt/x commit -m "x"', `git -C E:/wt/x add -- ${WALKER}`, 'git -C D:/other commit --amend --no-edit', 'git -C D:/other commit -m "x"']) expect([c, refused(await $.tool.call({ tool: 'Bash', command: c }))]).toEqual([c, undefined])
  expect(w.runs.filter(r => r.includes('diff --cached'))).toEqual([])
  // This session's own merge stopped on conflicts: it stages and commits what main brings (other lanes' paths among them).
  w.put(`${S2}/.git/MERGE_HEAD`, 'abc1234\n', NOW - MIN)
  w.put(`${HF}/head-owner.json`, JSON.stringify(headOwner({ head: 'MERGE_HEAD', mtimeMs: NOW - MIN }, { session: ME, id8: ME8, lane: 'tail-vfx' }, NOW - MIN, 'started')))
  for (const c of [`git -C ${S2} add -- ${WALKER}`, `git -C ${S2} commit --no-edit`]) expect([c, refused(await $.tool.call({ tool: 'Bash', command: c }))]).toEqual([c, undefined])
})

// ---------- A127 ----------
const STATUS_TOOL = 'mcp__ather-automata__status'
const INTENT = `${PROJ}/docs/intent/tail-vfx`
const progressWith = (pr: string) => ['# tail-vfx: Progress', '', `- PR: ${pr}`, '', '## Acceptance', '| Item | Verdict | Evidence |', '| --- | --- | --- |', '| A1 | met | PIE |'].join('\n')

test('A127: the acceptance score (gh and git, minutes under load) runs beside the minute tick, never in front of it', opts(), async ($, on) => {
  const git: Record<string, { stdout: string; hold?: Promise<void> }> = { 'worktree list': { stdout: '' } }
  const status = JSON.stringify({ me: 'hai', role: 'techart', tracked: { slug: 'tail-vfx', stage: 'Build', prs: [], directorCalls: [] }, evidence: {} })
  const w = world(on, { out: { [STATUS_TOOL]: status }, git })
  w.put(`${INTENT}/prompt.md`, ['# Tail VFX', '- Rev: 2', '- Status: active', '## Acceptance', '- A1: the tail glows. Proof: PIE.'].join('\n'))
  w.put(`${INTENT}/progress.md`, progressWith('none yet'))
  await $.session.start(START)
  for (let i = 0; i < 6; i += 1) await w.clock.advance(MIN)
  git['pr view 812'] = { stdout: '{}', hold: new Promise<void>(() => undefined) } // GitHub never answers
  w.put(`${INTENT}/progress.md`, progressWith('#812'))
  for (let i = 0; i < 7; i += 1) await w.clock.advance(MIN)
  expect(w.runs.some(r => r.includes('pr view 812'))).toBe(true) // the score started and hangs
  const probeAt = (JSON.parse(w.read(`${HF}/probe.json`) || '{}') as { at?: number }).at ?? 0
  expect(w.clock.now() - probeAt).toBeLessThan(2 * MIN) // the ticks went on (each reads the machine)
})
const lane = (id8: string, mtimeMs = NOW - MIN): LaneBeat => ({ sessionId: SID(id8), hasEnded: false, mtimeMs, intent: 'avian' })
const fileAt = (id8: string, heartbeatAt: number): SessionFile => ({ ...blankSession(SID(id8), `lane-${id8}`, '', NOW), heartbeatAt })

test('A127: unit: a live lane whose a5r file is 4 min old is not mod-less; missing, or older than 10 min, it is', () => {
  const lanes = [lane('aaaaaaaa'), lane('bbbbbbbb'), lane('cccccccc')]
  const files = [fileAt('aaaaaaaa', NOW - 4 * MIN), fileAt('bbbbbbbb', NOW - 11 * MIN)]
  expect(withoutModOf(ME8, files, lanes, NOW).map(n => n.id8)).toEqual(['bbbbbbbb', 'cccccccc'])
  expect(withoutModOf(ME8, files, [lane('aaaaaaaa', NOW - 11 * MIN)], NOW)).toEqual([]) // a gone lane is nobody to message
})

/** The machine probe (PowerShell, `ConvertTo-Json`), held until the test lets it answer: a tick stuck in a slow step. */
const slowProbe = () => {
  let free = () => undefined as void
  const hold = new Promise<void>(r => (free = r))
  return { hold, free, stdout: JSON.stringify({ freeGb: 40, diskGb: 40, procs: [] }) }
}

test('A127: a tick held up in a slow step keeps this session\'s heartbeat fresh (the minute writes it), and a slow tick writes the time it ends', opts(), async ($, on) => {
  const p = slowProbe()
  const git: Record<string, { stdout: string; hold?: Promise<void> }> = {}
  const w = world(on, { git })
  await $.session.start(START)
  git['ConvertTo-Json'] = { stdout: p.stdout, hold: p.hold } // from the next probe on
  const beat = () => parseSessionFile(w.read(`${HF}/editor/${ME8}.json`))?.heartbeatAt ?? 0
  for (let i = 0; i < 4; i += 1) await w.clock.advance(MIN)
  const now = w.clock.now()
  expect(now - beat()).toBeLessThan(2 * MIN) // without the minute's own write it stays at the start (4 min old: "without a5r")
  p.free()
  await w.clock.advance(MIN)
  expect(beat()).toBe(w.clock.now()) // the heartbeat is the time of the write
})
