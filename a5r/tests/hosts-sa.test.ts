import { expect, test } from 'claude-code/testing'
import { score, type AcceptInput } from '../hooks/accept.ts'
import { claimedBy, claimOf, claimsOf, covers, exclusiveGlobs, exclusiveHits, type Claiming } from '../hooks/claims.ts'
import { baseRefOf, checkBase, fieldsOf, fieldsProblem, handoffId, mayMove, newHandoff, parseHandoff, parseHandoffCommand, resultKindOf, statusRows, writeProblem, type Handoff } from '../hooks/handoff.ts'
import { statusOf } from '../hooks/syncplan.ts'
import { NO_TIMES } from '../hooks/syncplan.ts'
import { CONFIG } from './config.fixture.ts'
import { NOW } from './world.ts'

// a5r-hosts S-a (L0): the hand-off file and its writer guard, D7's base check on a mocked git, D13's secret refusal,
// claimedBy (globs, the exclusive defaults, the own-claim exemption), the command and tool parsing, rule 1 at acceptance.
const ORIGIN = '0a1b2c3d'
const GLOBS = exclusiveGlobs(undefined)
const fields = fieldsOf({ label: 'rig', branch: 'intent/tail-vfx', claims: ['Content/S2/Tail/', '!Source/S2/Tail/Glow.cpp', 'Content/S2/Maps/L_Tail.umap'], task: 'bake the tail' })
const fresh = (o: Partial<Handoff> = {}): Handoff => ({ ...newHandoff(fields, { id: handoffId(ORIGIN, NOW, 1), from: ORIGIN, by: { id8: 'cccccccc', lane: 'rig-lane' }, sha: 'f'.repeat(40), now: NOW, globs: GLOBS }), ...o })
const SECRETS = CONFIG.secret_regex

test('S-a: unit: a hand-off file reads back field by field; anything else reads as none', () => {
  const h = fresh()
  expect(h.id).toBe('0a1b2c3d-2610061440-1')
  expect(h.intent).toEqual({ slug: 'tail-vfx', branch: 'intent/tail-vfx' })
  expect(h.base).toEqual({ remote: 'origin', ref: 'intent/tail-vfx', sha: 'f'.repeat(40) })
  expect(h.result).toEqual({ kind: 'pr', target: 'intent/tail-vfx' })
  expect([h.state, h.host, h.wants, h.needs, h.proof]).toEqual(['proposed', 'rig', [], {}, ''])
  expect(parseHandoff(JSON.stringify(h))).toEqual(h)
  expect(parseHandoff(JSON.stringify({ ...h, unknown: 1 }))).toEqual(h) // readers ignore unknown keys
  for (const bad of ['', 'null', '{}', JSON.stringify({ ...h, v: 2 }), JSON.stringify({ ...h, state: 'running' }), JSON.stringify({ ...h, base: null }), '{"v":1,"id":"x"'])
    expect([bad.slice(0, 30), parseHandoff(bad)]).toEqual([bad.slice(0, 30), null])
})

test('S-a: unit: the writer guard: one origin writes its own files, origin-side states only, merged needs a result, no secret (D5, D13)', () => {
  const h = fresh()
  expect(writeProblem(null, h, ORIGIN, SECRETS)).toBeNull()
  expect(writeProblem(null, { ...h, from: 'ffffffff' }, ORIGIN, SECRETS)?.[0]).toBe(`a hand-off from ffffffff cannot be written by this origin (${ORIGIN})`)
  expect(writeProblem({ ...h, from: 'ffffffff' }, h, ORIGIN, SECRETS)?.[0]).toBe(`hand-off ${h.id} was written by another origin (ffffffff)`)
  expect(writeProblem(null, { ...h, state: 'cancelled' }, ORIGIN, SECRETS)?.[0]).toBe('a new hand-off starts as proposed, not cancelled')
  expect(writeProblem({ ...h, state: 'cancelled' }, h, ORIGIN, SECRETS)?.[0]).toBe(`hand-off ${h.id} is cancelled; it cannot become proposed`)
  expect(writeProblem({ ...h, state: 'merged', result: { kind: 'pr', ref: '#1' } }, { ...h, state: 'cancelled' }, ORIGIN, SECRETS)?.[0]).toBe(`hand-off ${h.id} is merged; it cannot become cancelled`)
  expect(writeProblem(h, { ...h, state: 'merged' }, ORIGIN, SECRETS)).toEqual([`hand-off ${h.id} has no result yet`, `record it first (result ${h.id} <ref>)`])
  expect(writeProblem(h, { ...h, state: 'merged', result: { kind: 'pr', ref: '#12' } }, ORIGIN, SECRETS)).toBeNull()
  expect(writeProblem(h, { ...h, state: 'cancelled' }, ORIGIN, SECRETS)).toBeNull()
  expect(writeProblem(null, { ...h, task: `use ghp_${'a'.repeat(36)} to push` }, ORIGIN, SECRETS)).toEqual(['the hand-off holds a secret (D13: hand-offs carry none)', 'take the credential out; each host keeps its own'])
  expect([mayMove(null, 'proposed'), mayMove('proposed', 'proposed'), mayMove('proposed', 'merged'), mayMove('merged', 'proposed'), mayMove('cancelled', 'merged')]).toEqual([true, true, true, false, false])
})

test('S-a: unit: D7: the base must be on the remote (ls-remote tip, or an ancestor of it); else the D7 refusal', async () => {
  const TIP = 'abc1234def5678900000000000000000000000000'
  const git = (answers: Record<string, { exitCode: number; stdout: string } | null>) => {
    const ran: string[] = []
    return { ran, run: async (args: string[]) => (ran.push(args.join(' ')), Object.entries(answers).find(([k]) => args.join(' ').startsWith(k))?.[1] ?? null) }
  }
  const tipOnly = git({ 'ls-remote': { exitCode: 0, stdout: `${TIP}\trefs/heads/intent/tail-vfx\n` } })
  expect([baseRefOf('origin', 'origin/intent/tail-vfx'), baseRefOf('origin', 'refs/remotes/origin/main'), baseRefOf('origin', 'refs/heads/main'), baseRefOf('up.stream', 'up.stream/x')]).toEqual(['intent/tail-vfx', 'main', 'main', 'x'])
  expect(fieldsOf({ label: 'x', task: 'y', base: 'refs/remotes/origin/intent/tail-vfx' }).base).toBe('intent/tail-vfx') // normalized once: checked and stored alike
  expect(await checkBase(tipOnly.run, { remote: 'origin', ref: 'intent/tail-vfx' })).toEqual({ sha: TIP })
  expect(tipOnly.ran).toEqual(['ls-remote origin intent/tail-vfx'])
  expect(await checkBase(tipOnly.run, { remote: 'origin', ref: 'intent/tail-vfx', sha: 'abc1234' })).toEqual({ sha: TIP }) // a short sha of the tip is recorded whole
  const ancestor = git({ 'ls-remote': { exitCode: 0, stdout: `${TIP}\trefs/heads/main\n` }, 'merge-base': { exitCode: 0, stdout: '' } })
  expect(await checkBase(ancestor.run, { remote: 'origin', ref: 'main', sha: '1111111' })).toEqual({ sha: '1111111' })
  expect(ancestor.ran).toEqual(['ls-remote origin main', `merge-base --is-ancestor 1111111 ${TIP}`])
  const notAncestor = git({ 'ls-remote': { exitCode: 0, stdout: `${TIP}\trefs/heads/main\n` }, 'merge-base': { exitCode: 1, stdout: '' } })
  expect(await checkBase(notAncestor.run, { remote: 'origin', ref: 'main', sha: 'abc9999' })).toEqual({ why: ['base abc9999 is not on origin', 'push the branch, then create the hand-off'] })
  const absent = git({ 'ls-remote': { exitCode: 2, stdout: '' } })
  expect(await checkBase(absent.run, { remote: 'origin', ref: 'intent/local-only' })).toEqual({ why: ['base intent/local-only is not on origin', 'push the branch, then create the hand-off'] })
  expect(await checkBase(git({}).run, { remote: 'origin', ref: 'main' })).toEqual({ why: ['origin could not be read (git ls-remote did not run)', 'check the remote and the network, then create the hand-off again'] })
})

test('S-a: unit: claims: globs, folders and files; binary assets exclusive by default (and the option\'s globs); ! and ~ say it', () => {
  expect([covers('Content/S2/Tail/', 'Content/S2/Tail/M_Glow.uasset'), covers('Content/S2/Tail', 'content/s2/tail/x.uasset'), covers('Content/S2/Tail', 'Content/S2/TailX.uasset')]).toEqual([true, true, false])
  expect([covers('Content/**/*.umap', 'Content/S2/Maps/L.umap'), covers('Content/*/L.umap', 'Content/S2/Maps/L.umap'), covers('*.uasset', 'Content/A/B.uasset')]).toEqual([true, false, true])
  expect(claimOf('Content/S2/A.uasset', GLOBS)).toEqual({ path: 'Content/S2/A.uasset', exclusive: true })
  expect(claimOf('Content/**/*.umap', GLOBS)).toEqual({ path: 'Content/**/*.umap', exclusive: true })
  expect(claimOf('Source/S2/Tail/', GLOBS)).toEqual({ path: 'Source/S2/Tail/', exclusive: false })
  expect(claimOf('!Source/S2/Tail/', GLOBS)).toEqual({ path: 'Source/S2/Tail/', exclusive: true })
  expect(claimOf('~Content/S2/A.uasset', GLOBS)).toEqual({ path: 'Content/S2/A.uasset', exclusive: false })
  expect(claimOf({ path: 'Config\\DefaultGame.ini', exclusive: true }, GLOBS)).toEqual({ path: 'Config/DefaultGame.ini', exclusive: true })
  expect(claimOf('Art/hero.fbx', exclusiveGlobs('*.fbx, *.png'))).toEqual({ path: 'Art/hero.fbx', exclusive: true })
  expect(claimsOf(['E:/s2/Content/A.uasset', '../x', 'ok.txt'], GLOBS)).toEqual({ claims: [{ path: 'ok.txt', exclusive: false }], bad: ['E:/s2/Content/A.uasset', '../x'] })
})

test('S-a: unit: claimedBy reads open hand-offs only, exclusive first; a hand-off never blocks the session that recorded it', () => {
  const a: Claiming = { id: 'a', host: 'rig', state: 'proposed', by: { id8: 'cccccccc' }, claims: [{ path: 'Source/S2/', exclusive: false }] }
  const b: Claiming = { id: 'b', host: 'pc2', state: 'proposed', by: { id8: 'dddddddd' }, claims: [{ path: 'Source/S2/Tail/*.cpp', exclusive: true }] }
  const gone: Claiming = { id: 'c', host: 'vm', state: 'cancelled', claims: [{ path: 'Content/', exclusive: true }] }
  const merged: Claiming = { ...gone, id: 'm', state: 'merged' }
  expect(claimedBy('Source/S2/Tail/Glow.cpp', [a, b])).toEqual({ id: 'b', host: 'pc2', claim: { path: 'Source/S2/Tail/*.cpp', exclusive: true } })
  expect(claimedBy('Source/S2/Tail/Glow.h', [a, b])).toEqual({ id: 'a', host: 'rig', claim: { path: 'Source/S2/', exclusive: false } })
  expect(claimedBy('Content/A.uasset', [gone, merged])).toBeNull()
  expect(claimedBy('Source/S2/Tail/Glow.cpp', [a, b], 'dddddddd')).toEqual({ id: 'a', host: 'rig', claim: { path: 'Source/S2/', exclusive: false } }) // its own claim steps aside
  expect(claimedBy('Docs/x.md', [a, b])).toBeNull()
  expect(exclusiveHits(['Source/S2/Tail/Glow.cpp', 'Source/S2/Foo.cpp'], [a, b], h => h.id === 'b')).toEqual([])
  expect(exclusiveHits(['Source/S2/Tail/Glow.cpp', 'Source/S2/Foo.cpp'], [a, b], () => false).map(x => x.file)).toEqual(['Source/S2/Tail/Glow.cpp'])
})

test('S-a: unit: /a5r handoff parses key=value words (quotes keep spaces); fields get their defaults; bad fields are named', () => {
  expect(parseHandoffCommand('')).toEqual({ op: 'list' })
  expect(parseHandoffCommand('list')).toEqual({ op: 'list' })
  expect(parseHandoffCommand('cancel 0a1b2c3d-2610061440-1')).toEqual({ op: 'cancel', id: '0a1b2c3d-2610061440-1' })
  expect(parseHandoffCommand('result 0a1b2c3d-2610061440-1 https://github.com/o/r/pull/12')).toEqual({ op: 'result', id: '0a1b2c3d-2610061440-1', ref: 'https://github.com/o/r/pull/12' })
  for (const bad of ['cancel', 'result x', 'park x', 'add host']) expect([bad, parseHandoffCommand(bad)]).toEqual([bad, null])
  const r = parseHandoffCommand('record label="night rig" branch=intent/tail-vfx base=main@abc1234 claims="Content/S2/Tail/,!Source/S2/Tail/Glow.cpp" task="bake the tail, prove PIE"')
  expect(r).toEqual({ op: 'record', fields: { label: 'night rig', branch: 'intent/tail-vfx', slug: 'tail-vfx', base: 'main', sha: 'abc1234', remote: 'origin', claims: ['Content/S2/Tail/', '!Source/S2/Tail/Glow.cpp'], task: 'bake the tail, prove PIE', kind: 'pr', note: '' } })
  expect(fieldsOf({ label: 'x', task: 'y' })).toMatchObject({ branch: '', slug: '', base: 'main', remote: 'origin', claims: [], kind: 'pr' })
  expect(fieldsOf({ label: 'x', branch: 'feature/a', task: 'y', claims: 'a.txt, b.uasset' })).toMatchObject({ base: 'feature/a', slug: '', claims: ['a.txt', 'b.uasset'] })
  expect(fieldsProblem(fieldsOf({ task: 'y' }), GLOBS)?.[0]).toBe('a hand-off names the machine it runs on')
  expect(fieldsProblem(fieldsOf({ label: 'x' }), GLOBS)?.[0]).toBe('a hand-off says in one line what is done there')
  expect(fieldsProblem(fieldsOf({ label: 'x', task: 'y', claims: ['C:/abs.uasset'] }), GLOBS)?.[0]).toBe('claims must be repo-relative paths or globs: C:/abs.uasset')
  expect([resultKindOf('#12'), resultKindOf('https://github.com/o/r/pull/3'), resultKindOf('intent/tail-vfx'), resultKindOf('Saved/report.md')]).toEqual(['pr', 'pr', 'branch', 'report'])
})

test('S-a (A9): unit: rule 1 fails a diff path inside another open hand-off\'s exclusive claim until progress.md or findings.md names it; the branch\'s own hand-off never counts', () => {
  const other = fresh({ intent: { slug: 'other', branch: 'intent/other' } })
  const base: AcceptInput = { slug: 'tail-vfx', branch: 'intent/tail-vfx', files: ['Source/S2/Tail/Glow.cpp', 'Source/S2/Tail/Trail.cpp'], added: new Map(), prompt: '# t\n- Status: active\nChange `Source/S2/Tail/` only.\n## Acceptance\n- A1: x. Proof: y.', progress: '| A1 | met | tests: 3 pass 0 fail |', findings: '', promptDiff: '', proof: null, body: 'x', othersTouch: [], otherIntents: [], untrackedLeft: [], strayWorktrees: [], runningAgents: [], cfg: CONFIG, kitDirs: [], handoffs: [other] }
  const r1 = score(base).find(s => s.rule === 1)
  expect(r1?.state).toBe('fail')
  expect(r1?.issues).toEqual([{ file: 'Source/S2/Tail/Glow.cpp', what: `claimed by hand-off ${other.id} on rig (exclusive)`, todo: 'leave it to that lane, or say why in progress.md or findings.md', group: `claimed by hand-off ${other.id}` }])
  expect(score({ ...base, findings: 'Source/S2/Tail/Glow.cpp: the rig lane handed it back on 2026-10-06' }).find(s => s.rule === 1)?.state).toBe('pass')
  expect(score({ ...base, handoffs: [fresh()] }).find(s => s.rule === 1)?.state).toBe('pass') // its own intent's hand-off
  expect(score({ ...base, handoffs: [{ ...other, state: 'cancelled' }] }).find(s => s.rule === 1)?.state).toBe('pass')
  expect(score({ ...base, handoffs: undefined }).find(s => s.rule === 1)?.state).toBe('pass')
})

test('S-a (D17): unit: status.json carries handoffs only while one is open; without it the file is as before', () => {
  const x = { now: NOW, sync: null, phase: 'none' as never, step: null, times: NO_TIMES, holder: null, queue: [], focus: null }
  expect(Object.keys(statusOf(x))).toEqual(['v', 'at', 'sync', 'editor', 'focus'])
  expect(statusOf({ ...x, handoffs: undefined })).toEqual(statusOf(x))
  const rows = statusRows([fresh(), fresh({ id: 'gone', state: 'cancelled' })])
  expect(rows).toEqual([{ id: '0a1b2c3d-2610061440-1', state: 'proposed', host: 'rig', claims: fresh().claims, updatedAt: NOW }])
  expect(statusOf({ ...x, handoffs: rows }).handoffs).toEqual(rows)
  expect(statusOf({ ...x, handoffs: rows }).v).toBe(1)
})
