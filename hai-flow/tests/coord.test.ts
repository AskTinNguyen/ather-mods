import { expect, test } from 'claude-code/testing'
import {
  CUTOFF_MS, DEFAULT_GATES, NOTICES, atNext, blankSession, classify, cleanupPlan, decide, endedSync, freeLine, gatesOf, gitWrites, heldLine, historyBlobs,
  isIntentFile, isLockPath, isSyncCommandOnly, livenessOf, mayAskYield, newSync, noticeIds, parseLockLine, parseMergeTree, parseProbe, presetTimes, queueOf, safeNote, syncPhase,
  writesLock, type GrantInput, type LockLine, type Probe, type SessionFile, type Want,
} from '../hooks/coord.ts'
import { parseEditorLock } from '../hooks/editor.ts'

// Ather Automata's own reader (ather-automata/hooks/packs/unreal.mjs parseEditorLock), copied verbatim so the
// test proves that Ather still reads holder, until and session from the lines hai-flow writes.
const atherParse = (raw: string | null, nowMinutes: number) => {
  const text = (raw ?? '').trim()
  const session = /\bsession\s+([0-9a-f]{8})/i.exec(text)?.[1]?.toLowerCase() ?? ''
  if (text === '') return { state: 'unknown', holder: '', until: '', isStale: false, raw: text, session }
  const free = /free\s+since\s+(\d{1,2}:\d{2})/i.exec(text)
  if (free || /^free\b/i.test(text) || /\bfree (for|to use)\b|\bno (agent|one|lane) holds it\b/i.test(text)) return { state: 'free', holder: '', until: free?.[1] ?? /holds it since\s+(\d{1,2}:\d{2})/i.exec(text)?.[1] ?? '', isStale: false, raw: text, session }
  const until = /until\s+(\d{1,2}:\d{2})/i.exec(text)?.[1] ?? ''
  const named = /(?:holder|owner)\s*[:=]\s*([^,;\n]+)|held by\s+([^,;\n]+)/i.exec(text)
  const holder = (named?.[1] ?? named?.[2] ?? text.split(/\r?\n/)[0] ?? '').replace(/\buntil\b.*$/i, '').trim()
  const end = /^(\d{1,2}):(\d{2})$/.exec(until)
  const endMinutes = end ? Number(end[1]) * 60 + Number(end[2]) : null
  const isStale = endMinutes !== null && nowMinutes - endMinutes > 30 && nowMinutes - endMinutes < 12 * 60
  return { state: 'held', holder: holder.slice(0, 60), until, isStale, raw: text, session }
}

const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const NOW = T(14, 40)
const want = (o: Partial<Want> = {}): Want => ({ minutes: 20, pie: false, build: false, what: 'check the tail VFX', mode: 'interactive', pausable: true, nextSafe: 'after save', requestedAt: NOW - 60_000, ...o })
const sess = (id8: string, o: Partial<SessionFile> = {}): SessionFile => ({ ...blankSession(`${id8}-0000`, `lane-${id8}`, `title ${id8}`, NOW), ...o })
const PROBE = (free: number, procs: Probe['procs'] = []): Probe => ({ freeGb: free, diskGb: 40, procs })
const held = (id8: string, end = '15:10') => parseLockLine(heldLine({ lane: `lane-${id8}`, sessionName: 'x', id8, since: T(14, 30), pid: null, end: T(Number(end.slice(0, 2)), Number(end.slice(3))), mode: 'interactive', pausable: true, nextSafe: 'after save', note: 'PIE proof' }))
const FREE: LockLine = parseLockLine('free since 14:20\n')
const input = (o: Partial<GrantInput>): GrantInput => ({ me8: 'aaaaaaaa', lock: FREE, files: [], lanes: [], now: NOW, sync: null, probe: PROBE(40), gates: { ...DEFAULT_GATES }, ...o })

test('D2 lock lines: the standard\'s fields, and Ather\'s reader still finds holder, until and session', () => {
  const line = heldLine({ lane: '3️⃣ Loco fix', sessionName: 'Loco s3, take 2', id8: 'ab12cd34', since: T(14, 30), pid: 4242, end: T(15, 10), mode: 'interactive', pausable: true, nextSafe: '15:00', note: 'PIE proof until 15:00 · held by nobody; free for Tin; holder: me; session deadbeef' })
  expect(line.startsWith('HELD lane=3️⃣-Loco-fix session=Loco-s3-take-2 since=14:30 2026-10-06 pid=4242 end=15:10 mode=interactive pausable=yes next_safe=15:00 note=')).toBe(true)
  expect(line.endsWith(' · held by 3️⃣-Loco-fix, session ab12cd34, until 15:10')).toBe(true)
  const ather = atherParse(line, 14 * 60 + 40)
  expect([ather.state, ather.holder, ather.until, ather.session]).toEqual(['held', '3️⃣-Loco-fix', '15:10', 'ab12cd34'])
  const own = parseEditorLock(line, 14 * 60 + 40)
  expect([own.state, own.until, own.session]).toEqual(['held', '15:10', 'ab12cd34'])
  const back = parseLockLine(line)
  expect([back.kind, back.lane, back.id8, back.end, back.pid, back.pausable, back.nextSafe]).toEqual(['held', '3️⃣-Loco-fix', 'ab12cd34', '15:10', 4242, true, '15:00'])
  const free = freeLine({ since: T(15, 2), by: '3️⃣ Loco fix', note: 'Editor open PID 4242, reusable', background: 'none' })
  expect(free).toBe('FREE since=15:02 2026-10-06 by=3️⃣-Loco-fix note=Editor open PID 4242, reusable background=none · free since 15:02')
  expect([atherParse(free, 905).state, atherParse(free, 905).until]).toEqual(['free', '15:02'])
  expect(parseEditorLock(free, 905).state).toBe('free')
  const f = parseLockLine(free)
  expect([f.kind, f.by, f.pid, f.background, f.note]).toEqual(['free', '3️⃣-Loco-fix', 4242, 'none', 'Editor open PID 4242, reusable'])
})

test('lock lines: older free-text lines read as the standard says (free since → FREE, else HELD), missing is unknown', () => {
  expect(parseLockLine(null).kind).toBe('missing')
  expect(parseLockLine('  \n').kind).toBe('missing')
  expect(parseLockLine('free since 15:20 (released by s3)\n').kind).toBe('free')
  const old = parseLockLine('1006-walkerext-s9 (worker) since 14:30, expected end 15:10. session ffffffff\n')
  expect([old.kind, old.isStandard, old.id8, old.end, old.since]).toEqual(['held', false, 'ffffffff', '15:10', '14:30'])
  const handed = parseLockLine('HANDED lane=loco from=walker at=14:30 return_by=15:00 pid=none note=PIE check')
  expect([handed.kind, handed.lane, handed.by, handed.end]).toEqual(['handed', 'loco', 'walker', '15:00'])
  expect(safeNote('free since 14:00 until 15:00 holder=x expected end 16:00 session abcd1234')).toBe('clear since 14:00 till 15:00 holding lane:x expected finish 16:00 session-abcd1234')
})

test('liveness from files only: Ather\'s lane ended or 10 min old, or a 3 min old session file with no fresh lane', () => {
  const files = [sess('aaaaaaaa'), sess('bbbbbbbb', { heartbeatAt: NOW - 4 * 60_000 }), sess('cccccccc', { heartbeatAt: NOW - 4 * 60_000 })]
  const lanes = [{ sessionId: 'cccccccc-1', hasEnded: false, mtimeMs: NOW - 30_000 }, { sessionId: 'dddddddd-1', hasEnded: true, mtimeMs: NOW }, { sessionId: 'eeeeeeee-1', hasEnded: false, mtimeMs: NOW - 11 * 60_000 }]
  expect(livenessOf('aaaaaaaa', files, lanes, NOW)).toBe('alive')
  expect(livenessOf('bbbbbbbb', files, lanes, NOW)).toBe('gone')
  expect(livenessOf('cccccccc', files, lanes, NOW)).toBe('alive') // a fresh lane vouches for it
  expect(livenessOf('dddddddd', files, lanes, NOW)).toBe('gone')
  expect(livenessOf('eeeeeeee', files, lanes, NOW)).toBe('gone')
  expect(livenessOf('ffffffff', files, lanes, NOW)).toBe('unknown')
})

test('the queue: live requests, first requested first served, the sync holder first inside a cutoff or freeze', () => {
  const a = sess('aaaaaaaa', { want: want({ requestedAt: NOW - 5 * 60_000 }) })
  const b = sess('bbbbbbbb', { want: want({ requestedAt: NOW - 9 * 60_000 }) })
  const gone = sess('cccccccc', { want: want({ requestedAt: NOW - 20 * 60_000 }), heartbeatAt: NOW - 5 * 60_000 })
  const holding = sess('dddddddd', { want: want(), holding: { since: NOW, end: NOW, extended: 0 } })
  expect(queueOf([a, b, gone, holding], [], NOW, null).map(f => f.id8)).toEqual(['bbbbbbbb', 'aaaaaaaa'])
  const sync = newSync(T(15, 0), { session: 'aaaaaaaa-0000', id8: 'aaaaaaaa', lane: 'lane-a' }, 'lane-a', NOW)
  expect(queueOf([a, b], [], NOW, sync).map(f => f.id8)).toEqual(['aaaaaaaa', 'bbbbbbbb']) // 14:40 is inside 15:00's cutoff
  expect(queueOf([a, b], [], T(13, 0), sync).map(f => f.id8)).toEqual(['bbbbbbbb', 'aaaaaaaa'])
})

test('the grant: only the head takes a free lock, the slot fits before the cutoff, the launch gate holds', () => {
  const me = sess('aaaaaaaa', { want: want({ requestedAt: NOW - 60_000 }) })
  const other = sess('bbbbbbbb', { want: want({ requestedAt: NOW - 120_000 }) })
  expect(decide(input({ files: [me] })).kind).toBe('grant')
  const behind = decide(input({ files: [me, other] }))
  expect(behind.kind === 'wait' && behind.code === 'queue' && behind.place === 2).toBe(true)
  expect(decide(input({ files: [me], lock: parseLockLine(null) })).kind).toBe('wait')
  expect(decide(input({ files: [me], lock: held('aaaaaaaa') })).kind).toBe('mine')
  const heldBy = decide(input({ files: [me, sess('bbbbbbbb')], lock: held('bbbbbbbb') }))
  expect(heldBy.kind === 'wait' && heldBy.code === 'held' && heldBy.why.includes('until 15:10')).toBe(true)
  // RAM: the launch gate applies only when an Editor must be launched; an open one is reused.
  const pie = sess('aaaaaaaa', { want: want({ pie: true }) })
  const low = decide(input({ files: [pie], probe: PROBE(30, [{ name: 'git', pid: 1, gb: 0.1, parentAlive: false }]) }))
  expect(low.kind === 'wait' && low.code === 'ram' && low.why.includes('31 GB') && low.next.includes('git')).toBe(true)
  expect(decide(input({ files: [sess('aaaaaaaa', { want: want({ pie: false }) })], probe: PROBE(30) })).kind).toBe('grant')
  expect(decide(input({ files: [sess('aaaaaaaa', { want: want({ launch: false }) })], probe: PROBE(9) })).kind).toBe('grant') // never launches: no launch gate
  const reuse = decide(input({ files: [pie], probe: PROBE(9, [{ name: 'UnrealEditor', pid: 77, gb: 25, parentAlive: true }]) }))
  expect(reuse.kind === 'grant' && reuse.reuse === 77).toBe(true)
  expect(decide(input({ files: [pie], probe: null })).kind).toBe('wait')
})

test('the grant and the sync: a slot past the cutoff is deferred; inside the cutoff and freeze only the sync holder', () => {
  const me = sess('aaaaaaaa', { want: want({ minutes: 60 }) })
  const sync = newSync(T(16, 0), { session: 'bbbbbbbb-0000', id8: 'bbbbbbbb', lane: 'sync-lane' }, 'sync-lane', NOW)
  const late = decide(input({ files: [me], sync }))
  expect(late).toEqual({ kind: 'wait', code: 'sync', why: 'a 60-min slot would end at 15:40, past the cutoff 15:30 of the sync at 16:00', next: 'ask again for ≤ 50 min, or wait until the sync is done', place: 1 })
  expect(decide(input({ files: [sess('aaaaaaaa', { want: want({ minutes: 50 }) })], sync })).kind).toBe('grant')
  const at = (now: number) => sess('aaaaaaaa', { want: want({ minutes: 60 }), heartbeatAt: now }) // a live session refreshes its file each minute
  const inCutoff = decide(input({ files: [at(T(15, 40))], sync, now: T(15, 40) }))
  expect(inCutoff.kind === 'wait' && inCutoff.code === 'sync' && inCutoff.why.includes('cutoff')).toBe(true)
  const holder = sess('bbbbbbbb', { want: want({ minutes: 40, requestedAt: T(16, 4) }), heartbeatAt: T(16, 5) })
  expect(decide(input({ me8: 'bbbbbbbb', files: [holder, at(T(16, 5))], sync, now: T(16, 5) })).kind).toBe('grant')
  expect(decide(input({ files: [at(T(16, 31))], sync: endedSync(sync, 'done', '', T(16, 30)), now: T(16, 31) })).kind).toBe('grant')
})

test('a stale lease: freed by the head only when its holder is gone and no Editor runs; a live Editor is reported', () => {
  const me = sess('aaaaaaaa', { want: want() })
  const goneHolder = sess('bbbbbbbb', { heartbeatAt: NOW - 10 * 60_000, holding: { since: NOW - 3_600_000, end: NOW - 600_000, extended: 0 } })
  expect(decide(input({ files: [me, goneHolder], lock: held('bbbbbbbb', '14:30') }))).toEqual({ kind: 'recover', holder: 'bbbbbbbb' })
  const editor = decide(input({ files: [me, goneHolder], lock: held('bbbbbbbb', '14:30'), probe: PROBE(20, [{ name: 'UnrealEditor', pid: 91, gb: 26, parentAlive: true }]) }))
  expect(editor.kind === 'wait' && editor.code === 'gone-editor' && editor.next.includes('never kill')).toBe(true)
  // Unknown is not gone: a holder that left no file at all keeps its lease.
  expect(decide(input({ files: [me], lock: held('cccccccc', '14:30') })).kind).toBe('wait')
})

test('yield: ≤ 20 min without a build, at the head, a pausable live holder, once per holder per hour', () => {
  const holder = sess('bbbbbbbb', { holding: { since: NOW - 600_000, end: T(15, 30), extended: 0 } })
  const me = sess('aaaaaaaa', { want: want({ minutes: 15 }) })
  expect(mayAskYield(input({ files: [me, holder], lock: held('bbbbbbbb') }))).toEqual({ holder: 'bbbbbbbb' })
  expect(mayAskYield(input({ files: [sess('aaaaaaaa', { want: want({ minutes: 30 }) }), holder], lock: held('bbbbbbbb') }))).toBe(null)
  expect(mayAskYield(input({ files: [sess('aaaaaaaa', { want: want({ build: true }) }), holder], lock: held('bbbbbbbb') }))).toBe(null)
  const asked = sess('cccccccc', { yieldAsks: [{ holder: 'bbbbbbbb', at: NOW - 30 * 60_000, via: 'file', minutes: 10, lane: 'c' }] })
  expect(mayAskYield(input({ files: [me, holder, asked], lock: held('bbbbbbbb') }))).toBe(null)
  const hourAgo = sess('cccccccc', { yieldAsks: [{ holder: 'bbbbbbbb', at: NOW - 61 * 60_000, via: 'file', minutes: 10, lane: 'c' }] })
  expect(mayAskYield(input({ files: [me, holder, hourAgo], lock: held('bbbbbbbb') }))).toEqual({ holder: 'bbbbbbbb' })
  const unpausable = parseLockLine(heldLine({ lane: 'b', sessionName: 'b', id8: 'bbbbbbbb', since: NOW, pid: null, end: T(15, 30), mode: 'unattended', pausable: false, nextSafe: 'after save', note: 'capture' }))
  expect(mayAskYield(input({ files: [me, holder], lock: unpausable }))).toBe(null)
})

test('the sync timeline: planned → cutoff at T−30 → frozen at T → done or aborted', () => {
  const s = newSync(T(16, 0), { session: 'bbbbbbbb-0', id8: 'bbbbbbbb', lane: 'b' }, 'b', NOW)
  expect(syncPhase(null, NOW)).toBe('none')
  expect(syncPhase(s, T(15, 29))).toBe('planned')
  expect(syncPhase(s, T(16, 0) - CUTOFF_MS)).toBe('cutoff')
  expect(syncPhase(s, T(16, 0))).toBe('frozen')
  expect(syncPhase(s, T(16, 44))).toBe('frozen') // until done or abort, at the latest the hard end (D8)
  expect(s.hardEnd).toBe(T(16, 45))
  expect(syncPhase(s, T(16, 45))).toBe('expired')
  expect(syncPhase(s, T(16, 10), true)).toBe('expired') // the holder is gone
  expect(syncPhase(s, T(15, 40), true)).toBe('cutoff') // before T a gone holder can still be taken over
  expect(newSync(T(16, 0), s.holder, 'b', NOW, true).hardEnd).toBe(T(17, 30)) // with a build
  expect(syncPhase(endedSync(s, 'done', 'merged', T(16, 20)), T(16, 21))).toBe('done')
  expect(syncPhase(endedSync(s, 'aborted', 'asset conflict', T(16, 20)), T(16, 21))).toBe('aborted')
  expect(noticeIds.cutoff(s)).not.toBe(noticeIds.cutoff({ ...s, at: T(16, 30) })) // a moved sync gets its notices again
  expect(atNext('16:00', NOW)).toBe(T(16, 0))
  expect(atNext('09:00', NOW)).toBe(T(9, 0) + 24 * 3_600_000)
  expect(atNext('25:00', NOW)).toBe(null)
  expect(presetTimes(NOW)).toEqual([T(15, 30), T(16, 30), T(17, 30)])
  expect(presetTimes(T(14, 45))).toEqual([T(15, 30), T(16, 30), T(17, 30)])
})

test('conflicts: merge-tree names, then rule 11 (main holds a blob our history had = self)', () => {
  const out = '7e4887eb85fc0a6b1638a284733984d7d06b39f5\nSource/S2/Foo.cpp\nContent/S2/Maps/L_TALab.umap\n\nAuto-merging Source/S2/Foo.cpp\nCONFLICT (content): Merge conflict in Source/S2/Foo.cpp\n'
  expect(parseMergeTree(out)).toEqual({ tree: '7e4887eb85fc0a6b1638a284733984d7d06b39f5', paths: ['Source/S2/Foo.cpp', 'Content/S2/Maps/L_TALab.umap'] })
  expect(parseMergeTree('e4915469f92c9508928a7798d5a43f9f04563726\n').paths).toEqual([])
  const raw = '0b05dc029956b389352543c2aa1437b25dbbe74f\n\n:100644 100644 422c2b7ab3b3c668038da977e4e93a5fc623169c 21e8403505a4e80c11ebae677985027b1ebaa40d M\tf.txt\n091845264d603cced8bd4f79efe7f7ae6a4fb02f\n\n:000000 100644 0000000000000000000000000000000000000000 422c2b7ab3b3c668038da977e4e93a5fc623169c A\tf.txt\n'
  const blobs = historyBlobs(raw)
  expect(classify('f.txt', '422c2b7ab3b3c668038da977e4e93a5fc623169c', blobs)).toEqual({ path: 'f.txt', kind: 'self', match: '091845264d60' })
  expect(classify('f.txt', 'bec2106f4dc90d15b27c7b88b4ca1f4f54d52aff', blobs).kind).toBe('foreign')
})

test('freeze: the git writes in a command, with the folder each runs in; reads pass', () => {
  expect(gitWrites('git status && git log -3')).toEqual([])
  expect(gitWrites('git stash list; git stash show -p')).toEqual([])
  expect(gitWrites('git -C E:/Projects/s2 -c core.x=1 commit -m "a && b"')).toEqual([{ verb: 'commit', dir: 'E:/Projects/s2' }])
  expect(gitWrites('git add Source/x.cpp && git push')).toEqual([{ verb: 'add', dir: '' }, { verb: 'push', dir: '' }])
  expect(gitWrites('bash -c "git -C E:/wt/x merge origin/main"')).toEqual([{ verb: 'merge', dir: 'E:/wt/x' }])
  expect(gitWrites('git --no-pager cherry-pick abc')).toEqual([{ verb: 'cherry-pick', dir: '' }])
  for (const v of ['rm', 'mv', 'checkout', 'switch', 'restore', 'reset', 'stash', 'rebase', 'pull', 'revert', 'clean', 'am']) expect(gitWrites(`git ${v} x`).map(w => w.verb)).toEqual([v])
})

test('A15: exactly the sync\'s own git commands count as sync work; everything else keeps A5\'s rules', () => {
  const ok = [
    'git -C E:/s2 merge origin/main',
    'GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never git -C E:/s2 merge --no-edit origin/main',
    'git -C E:/s2 merge --abort',
    'git -C E:/s2 checkout --ours -- Source/S2/Foo.cpp Content/S2/X.uasset',
    'git -C E:/s2 checkout --theirs -- Config/DefaultGame.ini',
    'git -C E:/s2 revert -m 1 1a2b3c4d --no-edit',
    'git -C E:/s2 add -- Source/S2/Foo.cpp',
    'git -C E:/s2 commit --no-edit',
    'git -C E:/s2 commit -m "Merge origin/main (sync 16:00)"',
    'git -C E:/s2 status && git -C E:/s2 diff --name-only --diff-filter=U && git -C E:/s2 checkout --ours -- a.cpp && git -C E:/s2 add -- a.cpp',
  ]
  for (const c of ok) expect([c, isSyncCommandOnly(c)]).toEqual([c, true])
  const no = [
    'git -C E:/s2 reset --hard',
    'git -C E:/s2 reset --hard ORIG_HEAD',
    'git -C E:/s2 stash',
    'git -C E:/s2 clean -fd',
    'git -C E:/s2 checkout -- Source/S2/Foo.cpp',
    'git -C E:/s2 checkout --ours -- .',
    'git -C E:/s2 add .',
    'git -C E:/s2 add -A',
    'git -C E:/s2 commit -a -m x',
    'git -C E:/s2 commit --amend --no-edit',
    'git -C E:/s2 merge other-branch',
    'git -C E:/s2 rebase origin/main',
    'git -C E:/s2 restore --source=origin/main -- a.cpp',
    'rm -rf E:/s2/Saved/x && git -C E:/s2 add -- a.cpp',
    'bash -c "git -C E:/s2 checkout --ours -- a.cpp"',
  ]
  for (const c of no) expect([c, isSyncCommandOnly(c)]).toEqual([c, false])
})

test('the lock is written by the editor tool: direct writes are spotted, reads are not', () => {
  expect(isLockPath('E:\\Projects\\s2\\Saved\\EDITOR_OWNER.txt')).toBe(true)
  expect(isLockPath('E:/Projects/s2/Saved/EDITOR_QUEUE.md')).toBe(false)
  expect(writesLock('echo "free since 15:00" > E:/Projects/s2/Saved/EDITOR_OWNER.txt')).toBe(true)
  expect(writesLock('Set-Content -Path E:/Projects/s2/Saved/EDITOR_OWNER.txt -Value x')).toBe(true)
  expect(writesLock("powershell -Command \"'x' | Out-File E:/Projects/s2/Saved/EDITOR_OWNER.txt\"")).toBe(true)
  expect(writesLock('[IO.File]::WriteAllText("E:/Projects/s2/Saved/EDITOR_OWNER.txt", "x")')).toBe(true)
  expect(writesLock('cat E:/Projects/s2/Saved/EDITOR_OWNER.txt')).toBe(false)
  expect(writesLock('Get-Content E:/Projects/s2/Saved/EDITOR_OWNER.txt | Select-Object -First 1')).toBe(false)
  expect(isIntentFile('D:/Projects/ather-mods/docs/intent/hai-flow-a5/progress.md')).toBe(true)
})

test('RAM: the probe\'s JSON, the cleanup plan (reaper under 14 GB, LiveCodingConsole only with no Editor), gates', () => {
  const p = parseProbe('{"freeGb":12.5,"diskGb":18.2,"procs":[{"name":"git","pid":5,"gb":0.1,"parentAlive":false},{"name":"LiveCodingConsole","pid":6,"gb":4.7,"parentAlive":true},{"name":"python","pid":7,"gb":0.4,"parentAlive":true}]}')
  expect([p?.freeGb, p?.diskGb, p?.procs.length]).toEqual([12.5, 18.2, 3])
  expect(parseProbe('{"freeGb":30,"diskGb":-1,"procs":{"name":"git","pid":5,"gb":0,"parentAlive":true}}')?.procs.length).toBe(1)
  expect(parseProbe('nonsense')).toBe(null)
  const plan = cleanupPlan(p as Probe)
  expect([plan.reap, plan.stopLiveCoding]).toEqual([true, [6]])
  expect(plan.report.some(r => r.includes('python') && r.includes('not killed'))).toBe(true)
  const withEditor = cleanupPlan({ ...(p as Probe), freeGb: 20, procs: [...(p as Probe).procs, { name: 'UnrealEditor', pid: 8, gb: 26, parentAlive: true }] })
  expect([withEditor.reap, withEditor.stopLiveCoding]).toEqual([false, []])
  expect(withEditor.report.some(r => r.startsWith('LiveCodingConsole kept'))).toBe(true)
  expect(gatesOf(undefined, 31, 28)).toEqual({ pieGb: 31, nopieGb: 28, source: 'options' })
  expect(gatesOf({ pieGb: 33, nopieGb: 30 }, 31, 28)).toEqual({ pieGb: 33, nopieGb: 30, source: 'panel' })
  expect(gatesOf({ pieGb: 200, nopieGb: 1 }, 31, 28)).toEqual({ pieGb: 60, nopieGb: 10, source: 'panel' })
})

test('notices read the one shape: hai-flow · <gate> — <what> → <what to do>', () => {
  const s = newSync(T(16, 0), { session: 'bbbbbbbb-0', id8: 'bbbbbbbb', lane: 'sync-lane' }, 'sync-lane', NOW)
  const texts = [
    NOTICES.granted(T(15, 0), true, null, ''),
    NOTICES.cutoff(s, false, true),
    NOTICES.cutoff(s, true, false),
    NOTICES.frozen(s),
    NOTICES.lifted(endedSync(s, 'done', 'merged', T(16, 20))),
    NOTICES.ownerConflicts(s, [{ path: 'Source/S2/Foo.cpp', kind: 'foreign' }, { path: 'Content/X.uasset', kind: 'self', match: 'abc' }]),
    NOTICES.yield('loco', 15),
  ]
  for (const t of texts) expect(/^hai-flow · [^—]+ — .+ → .+/.test(t)).toBe(true)
  expect(NOTICES.cutoff(s, false, true)).toContain('release the Editor by 15:50')
  expect(NOTICES.ownerConflicts(s, [{ path: 'Content/X.uasset', kind: 'self', match: 'abc' }])).toContain('rule 11')
})
