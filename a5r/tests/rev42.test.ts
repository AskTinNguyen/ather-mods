import { expect, test } from 'claude-code/testing'
import { A5R } from '../hooks/a5r.ts'
import { autoSyncOf, holderMissingText, LOST_NOTE, syncHolderOf, type AutoSyncInput } from '../hooks/autosync.ts'
import { DEFAULT_GATES, NO_MANUAL, blankSession, endedSync, heldLine, newSync, parseLockLine, parseSyncFile, type GrantInput, type Probe, type Proc, type SessionFile, type SyncFile, type Want } from '../hooks/coord.ts'
import { focusLease, parseFocus, type Focus } from '../hooks/focus.ts'
import { hintOf, judgePrompt, type JudgeFacts } from '../hooks/judge.ts'
import { endLease, holderNotices, leaseSummary, type LeaseRecord } from '../hooks/lease.ts'
import { COMEBACK_N, comebackLook, comebackOf, overrunLook } from '../hooks/looks.ts'
import { askLook, closeArgv, closeAnswer, idleArgv, isNight, orphanLook, orphanNotice, orphanOf, parseIdle, sharedEditorPid, type OrphanInput, type OrphanRecord } from '../hooks/orphan.ts'
import { isNoEditorLease, isSyncConcerned, liveWait, liveWaitMin, namesPath, pieSeen, prunable, pruneArgv, staleWants, waitStart } from '../hooks/truth.ts'
import { CONFIG } from './config.fixture.ts'
import { A5RPANE, LOCK, ME, NOW, PROJ, find, opts, still, text, world, type Tree } from './world.ts'

// Rev 42 (L-46, the week's audit of 2026-10-21..28): A121 a lane that keeps coming back is offered a Focus; A122 an overrun
// with people waiting is shown with the person's release, and a running Editor is no work past the end; A123 an Editor left
// by a gone session is closed, gracefully and only when certainly orphaned; A124 main is synced at least twice a day, timed
// to the sessions; A125 the numbers and alerts tell the truth.
const HF = 'E:/s2/Saved/A5R'
const LOG = `${HF}/orchestrate.log`
const SYNC = `${HF}/sync.json`
const UPROJECT = 'E:/s2/S2.uproject'
const ME8 = ME.slice(0, 8)
const MIN = 60_000
const H = 60 * MIN
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const FREE = 'FREE since=14:00 2026-10-06 by=x note=none background=none · free since 14:00\n'
const at = (h: number, m = 0) => new Date(2026, 9, 6, h, m).getTime()
const want = (o: Partial<Want> = {}): Want => ({ minutes: 30, pie: false, build: false, what: 'their slot', mode: 'unattended', pausable: true, nextSafe: 'after save', requestedAt: NOW - 30 * MIN, ...o })
const file = (id8: string, o: Partial<SessionFile> = {}): SessionFile => ({ ...blankSession(SID(id8), `lane-${id8}`, `title ${id8}`, NOW), lastTurnAt: NOW - 2 * MIN, knowsFocus: true, ...o })
const peer = (id8: string, o: Partial<SessionFile> = {}): string => JSON.stringify({ ...file(id8, o), heartbeatAt: NOW + 600 * MIN, ...o })
const held = (id8: string, lane: string, since: number, end: number, pid: number | null = null) => `${heldLine({ lane, sessionName: lane, id8, since, pid, end, mode: 'interactive', pausable: true, nextSafe: 'after save', note: 'their slot' })}\n`
const probe = (procs: Proc[] = [], freeGb = 40): Probe => ({ freeGb, diskGb: 40, procs })
const input = (me8: string, files: SessionFile[], o: Partial<GrantInput> = {}): GrantInput => ({ me8, lock: parseLockLine(FREE), files, lanes: [], now: NOW, sync: null, probe: probe(), gates: DEFAULT_GATES, manual: NO_MANUAL, focus: null, ...o })
const rec = (o: Partial<LeaseRecord>): LeaseRecord => ({ v: 1, lane: 'lane-cccccccc', id8: 'cccccccc', requestedAt: NOW - 100 * MIN, grantedAt: NOW - 99 * MIN, reusedPid: null, minutes: 30, firstEditorSeenAt: NOW - 97 * MIN, pieAt: null, extensions: 0, endAt: NOW - 90 * MIN, endReason: 'released', editorLeftOpen: false, queueAtGrant: 1, pie: true, build: false, pieAborted: false, ...o })
const meFile = (o: Partial<SessionFile> = {}) => JSON.stringify({ ...blankSession(ME, 'tail-vfx', 'Tail', NOW), ...o })
const pane = async ($: any, w: ReturnType<typeof world>): Promise<Tree> => {
  await $.ui.render(A5RPANE as never)
  await w.clock.advance(50)
  return still(await $.ui.render(A5RPANE as never)) as Tree
}
const lockOf = (w: ReturnType<typeof world>) => parseLockLine(w.read(LOCK))

// ---------- A121: a lane that keeps coming back is offered a Focus ----------
/** Leases of lane-cccccccc that each came back within minutes of the last one's end (`n` finished), and a request now. */
const comebacks = (n: number, gapMin = 4): LeaseRecord[] =>
  Array.from({ length: n }, (_, i) => {
    const end = NOW - (n - i) * 25 * MIN
    return rec({ requestedAt: end - 20 * MIN - gapMin * MIN, grantedAt: end - 20 * MIN, firstEditorSeenAt: end - 18 * MIN, endAt: end })
  })

test('A121: unit: the third re-request within 2 h (each within 60 min of the lane\'s own last end) shows the offer; two do not', () => {
  const f = file('cccccccc', { want: want({ requestedAt: NOW - 3 * MIN }) })
  // 3 finished leases: the 2nd and 3rd came back after 4 min, and the request now came back 3 min after the 3rd's end (NOW-25).
  expect(comebackOf({ ...f, want: want({ requestedAt: NOW - 22 * MIN }) }, comebacks(3), NOW)).toMatchObject({ n: 3, launches: 2, leases: 2 })
  const look = (records: LeaseRecord[], o: Partial<Parameters<typeof comebackLook>[0]> = {}) => comebackLook({ records, files: [f], lanes: [], now: NOW, isFocusRunning: false, titleOf: () => '', ...o })
  expect(look(comebacks(3))).toEqual([{ what: 'lane-cccccccc asked for the Editor 3 times in 2 h (re-launching each time)', next: 'Focus it for 2 h?', press: { kind: 'focus', id8: 'cccccccc', label: 'Focus 2 h' } }])
  expect(look(comebacks(2))).toEqual([]) // two re-requests: below the threshold
  const late = [rec({ requestedAt: NOW - 200 * MIN, grantedAt: NOW - 195 * MIN, endAt: NOW - 150 * MIN }), rec({ requestedAt: NOW - 80 * MIN, grantedAt: NOW - 79 * MIN, endAt: NOW - 75 * MIN })]
  expect(look(late)).toEqual([]) // each came back more than 60 min after its end: no re-request
  expect(look(comebacks(3), { isFocusRunning: true })).toEqual([]) // one Focus at a time
  expect(comebackLook({ records: comebacks(3), files: [{ ...f, knowsFocus: undefined }], lanes: [], now: NOW, isFocusRunning: false, titleOf: () => '' })).toEqual([]) // an A5R before 0.25 cannot take one
  expect(comebackLook({ records: comebacks(3), files: [{ ...f, want: null }], lanes: [], now: NOW, isFocusRunning: false, titleOf: () => '' })).toEqual([]) // it asks for nothing now
  expect(look(comebacks(3).map(r => ({ ...r, endAt: r.endAt - 3 * H, requestedAt: (r.requestedAt ?? 0) - 3 * H, grantedAt: r.grantedAt - 3 * H })))).toEqual([]) // all over 2 h ago
  expect(look(comebacks(3).map((r, i) => (i === 2 ? { ...r, reusedPid: 4242 } : r)))[0]?.what).toBe('lane-cccccccc asked for the Editor 3 times in 2 h (1 Editor launch)')
  expect(COMEBACK_N).toBe(3)
})

test('A121: the offer is in NEEDS A LOOK with one press that gives the lane a Focus of 2 h (the person\'s press, as A118)', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, FREE)
  w.put(`${HF}/leases.jsonl`, `${comebacks(3).map(r => JSON.stringify(r)).join('\n')}\n`)
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { want: want({ requestedAt: NOW - 22 * MIN }) }))
  w.put(`${HF}/editor/${ME8}.json`, meFile())
  await $.session.start(START)
  const tree = await pane($, w)
  expect(text(find(tree, 'hai-look'))).toContain('lane-cccccccc asked for the Editor 3 times in 2 h (re-launching each time)→ Focus it for 2 h?')
  expect(find(tree, 'hai-look-focus-cccccccc')?.props?.label).toBe('Focus 2 h')
  await $.ui.press({ plugin: 'a5r', key: 'hai-look-focus-cccccccc', surface: 'terminal' })
  const f = parseFocus(w.read(`${HF}/editor-focus.json`) || null) as Focus
  expect([f.id8, f.endsAt - f.startedAt, f.setBy]).toEqual(['cccccccc', 120 * MIN, 'the person (panel in tail-vfx)'])
  expect(text(find(await pane($, w), 'hai-look'))).not.toContain('asked for the Editor') // a Focus runs: no offer
})

// ---------- A122: an overrun while others wait ----------
test('A122: unit: 30 min past its end with someone queued, NEEDS A LOOK shows the holder, the overrun, the waiters and the release; not before, not with nobody queued, never the Focus\'s lease', () => {
  const holder = file('bbbbbbbb', { want: want({ minutes: 45 }), holding: { since: NOW - 120 * MIN, end: NOW - 35 * MIN, extended: 0 } })
  const waiter = file('cccccccc', { want: want({ requestedAt: NOW - 50 * MIN, waited: 41 * MIN, waitAt: NOW }) })
  const x = (o: Partial<GrantInput> = {}) => ({ ...input(ME8, [holder, waiter], { lock: parseLockLine(held('bbbbbbbb', 'lane-bbbbbbbb', NOW - 120 * MIN, NOW - 35 * MIN)), ...o }), titleOf: () => '' })
  expect(overrunLook(x())).toEqual([{ what: 'lane-bbbbbbbb is 35 min past its lease end (asked 45 min), and 1 session waits (the longest 41 min)', next: 'release it if its Editor work is done (a running Editor alone is no work past the end; it was woken with the overrun), or give it more time on its row', press: { kind: 'release', id8: 'bbbbbbbb', label: 'Release' } }])
  expect(overrunLook(x({ now: NOW - 6 * MIN }))).toEqual([]) // 29 min over
  expect(overrunLook(x({ files: [holder] }))).toEqual([]) // nobody queued
  const focus = focusLease({ v: 1, id8: 'bbbbbbbb', session: SID('bbbbbbbb'), lane: 'lane-bbbbbbbb', milestone: 'm', startedAt: NOW - 120 * MIN, endsAt: NOW + 60 * MIN, setBy: 'p', extensions: [], ended: null }, NOW)
  expect(overrunLook(x({ focus }))).toEqual([]) // the claim's lease ends by its own rules
})

test('A122: unit: past its end a running Editor is no longer "working" for the judge; before its end it still is; the holder is woken once 30 min over with waiters', () => {
  const f: JudgeFacts = { now: NOW, kind: 'editor', lane: 'breakable', id8: 'bbbbbbbb', session: 's', since: NOW - 8 * H, end: NOW - 7 * H, why: 'w', liveness: 'alive', lastTurnAt: NOW - 3 * H, agents: 0, procs: ['UnrealEditor'], hasEditor: true, hasBuild: false, transcript: '' }
  const quiet = [{ at: NOW - 3 * H, role: 'assistant' as const, text: 'built', tools: [], results: [] }]
  expect(hintOf(f, quiet).verdict).toBe('stuck-or-crashed') // was: working (rule): an Unreal Editor runs
  expect(hintOf({ ...f, end: NOW + 10 * MIN }, quiet)).toEqual({ verdict: 'working', evidence: ['an Unreal Editor runs', 'last transcript event 180 min ago'] })
  expect(judgePrompt(f, { verdict: 'unsure', evidence: [] }, '')).toContain('an Unreal Editor that merely runs is no evidence of work')
  expect(judgePrompt({ ...f, end: NOW + 10 * MIN }, { verdict: 'unsure', evidence: [] }, '')).not.toContain('merely runs')
  const h = { since: NOW - 120 * MIN, end: NOW - 31 * MIN, extended: 0 }
  const base = { now: NOW, isFocusLease: false, isClaimed: false, editorUseAt: NOW, lastTurnAt: NOW, agents: 0, isPie: false, isUnattended: false, asks: [], waiting: 2 }
  expect(holderNotices(h, base).map(n => [n.id.split(':')[1], n.isActionable])).toEqual([['overrun', true], ['overrun-wait', true]])
  expect(holderNotices(h, base)[1]?.text).toContain('your lease ended at 14:09, 31 min ago, and 2 sessions wait for the Editor')
  expect(holderNotices(h, { ...base, waiting: 0 }).map(n => n.id.split(':')[1])).toEqual(['overrun'])
  expect(holderNotices({ ...h, end: NOW - 29 * MIN }, base).map(n => n.id.split(':')[1])).toEqual(['overrun'])
})

test('A122: the person\'s Release on the overrun row frees the lock (rule=manual) and the queue goes on', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held('bbbbbbbb', 'lane-bbbbbbbb', NOW - 120 * MIN, NOW - 35 * MIN))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { want: want({ minutes: 45 }), holding: { since: NOW - 120 * MIN, end: NOW - 35 * MIN, extended: 0 } }))
  w.put(`${HF}/editor/${ME8}.json`, meFile({ want: want({ requestedAt: NOW - 20 * MIN }) }))
  await $.session.start(START)
  const tree = await pane($, w)
  expect(text(find(tree, 'hai-look'))).toContain('lane-bbbbbbbb is 35 min past its lease end (asked 45 min), and 1 session waits')
  await $.ui.press({ plugin: 'a5r', key: 'hai-look-release-bbbbbbbb', surface: 'terminal' })
  expect(lockOf(w).id8).not.toBe('bbbbbbbb')
  expect(w.read(LOG)).toContain('| rule=manual |')
})

// ---------- A123: an orphan Editor closed, gracefully, only when certain ----------
const SINCE = NOW - 60 * MIN
const SHARED = { root: 'E:/s2', uproject: UPROJECT }
const S2_EDITOR: Proc = { name: 'UnrealEditor', pid: 777, gb: 22, parentAlive: false, cmd: '"D:\\GameEditors\\5.8\\Engine\\Binaries\\Win64\\UnrealEditor.exe" "E:\\s2\\S2.uproject" -unattended', startedAt: SINCE + 3 * MIN }
const OTHER_EDITOR: Proc = { name: 'UnrealEditor', pid: 888, gb: 10, parentAlive: true, cmd: '"D:\\UE\\UnrealEditor.exe" "E:\\Projects\\FluidNinjaLIVE\\FluidNinja.uproject"', startedAt: SINCE + 5 * MIN }
const goneHolder = (o: Partial<SessionFile> = {}): SessionFile => ({ ...file('bbbbbbbb'), heartbeatAt: NOW - 40 * MIN, lastTurnAt: NOW - 45 * MIN, agents: 0, holding: { since: SINCE, end: NOW + 30 * MIN, extended: 0 }, ...o })
const lockWith = (pid: number | null, since = SINCE, end = NOW + 30 * MIN) => parseLockLine(held('bbbbbbbb', 'lane-bbbbbbbb', since, end, pid))
const orphanIn = (o: Partial<OrphanInput> = {}): OrphanInput => ({ lock: lockWith(777), files: [goneHolder()], lanes: [], now: NOW, probe: probe([S2_EDITOR]), shared: SHARED, queued: 1, claim: null, pieDrivers: [], watchedSince: NOW - 2 * H, idle: null, ...o })

test('A123: unit: every condition holds → close the PID the lock names; each condition failed alone keeps it', () => {
  const ok = orphanOf(orphanIn())
  expect(ok).toMatchObject({ kind: 'close', pid: 777, id8: 'bbbbbbbb', since: SINCE })
  expect(ok.kind === 'close' && ok.why).toContain('(the PID its lock line names)')
  const keep = (o: Partial<OrphanInput>) => orphanOf(orphanIn(o)).kind
  // 1 the holder certainly gone (30 min: no heartbeat, no lane beat, no turn, no agent), watched 30 min by this A5R
  expect(keep({ files: [goneHolder({ heartbeatAt: NOW - MIN })] })).toBe('keep') // alive
  expect(keep({ files: [goneHolder({ heartbeatAt: NOW - 20 * MIN })] })).toBe('keep') // gone, but not 30 min
  expect(keep({ files: [goneHolder({ lastTurnAt: NOW - 10 * MIN })] })).toBe('keep') // a turn 10 min ago
  expect(keep({ files: [goneHolder({ lastTurnAt: undefined })] })).toBe('keep') // no turn on record: uncertain
  expect(keep({ files: [goneHolder({ agents: 1 })] })).toBe('keep') // an agent runs
  expect(keep({ lanes: [{ sessionId: SID('bbbbbbbb'), hasEnded: true, mtimeMs: NOW - 10 * MIN }] })).toBe('keep') // its lane beat 10 min ago
  expect(keep({ files: [] })).toBe('keep') // no file to read
  expect(keep({ watchedSince: NOW - 10 * MIN })).toBe('keep') // Fable review D3: A5R just turned on (or this session just started): it has not watched the 30 min itself
  // 2 the process: its command line names the shared .uproject and its PID is the lock's
  expect(keep({ probe: probe([{ ...S2_EDITOR, cmd: '"D:\\UE\\UnrealEditor.exe" "E:\\s2-wt\\S2.uproject"' }]) })).toBe('keep')
  expect(keep({ probe: probe([{ ...S2_EDITOR, cmd: undefined }]) })).toBe('keep') // unread command line
  expect(keep({ lock: lockWith(999) })).toBe('keep') // the lock names another PID: only that one is ever its Editor
  expect(keep({ probe: null })).toBe('keep') // no reading
  // 3 no build, test or PIE
  expect(keep({ probe: probe([S2_EDITOR, { name: 'UnrealBuildTool', pid: 5, gb: 1, parentAlive: true }]) })).toBe('keep')
  expect(keep({ probe: probe([S2_EDITOR, { name: 'UnrealEditor-Cmd', pid: 6, gb: 4, parentAlive: true, cmd: 'x' }]) })).toBe('keep')
  expect(keep({ probe: probe([{ ...S2_EDITOR, title: 'S2 Preview [NetMode: Standalone 0]  (64-bit/PC D3D SM6)' }]) })).toBe('keep')
  expect(keep({ probe: probe([S2_EDITOR, { name: 'python', pid: 7, gb: 0.1, parentAlive: true, cmd: 'python E:/s2/docs/handoff/pie-perf-tools/lab.py run' }]), pieDrivers: ['lab.py'] })).toBe('keep')
  expect(keep({ probe: probe([S2_EDITOR, { name: 'python', pid: 7, gb: 0.1, parentAlive: true, cmd: 'python docs/handoff/pie-perf-tools/lab.py run' }]), pieDrivers: ['lab.py'] })).toBe('keep') // review pass 3: run from inside the checkout it names no path: unknown is PIE
  // 4 someone queued; or night with the workstation idle 30 min or locked (Fable review D5)
  expect(keep({ queued: 0 })).toBe('keep')
  const night = (idle: OrphanInput['idle']) => orphanOf(orphanIn({ queued: 0, now: at(21, 30), lock: lockWith(777, at(20, 0), at(22, 0)), files: [goneHolder({ heartbeatAt: at(20, 10), lastTurnAt: at(20, 5), holding: null })], watchedSince: at(19, 0), idle }))
  expect(night(null)).toMatchObject({ kind: 'keep', needsIdle: true }) // no idle reading yet: the step reads it, never closes without it
  expect(night({ idleMin: 10, locked: false })).toMatchObject({ kind: 'keep' }) // Hai at the machine at 21:30
  expect(night({ idleMin: 45, locked: false }).kind).toBe('close')
  expect(night({ idleMin: 2, locked: true }).kind).toBe('close')
  expect(orphanOf(orphanIn({ now: at(21, 30), lock: lockWith(777, at(20, 0), at(22, 0)), files: [goneHolder({ heartbeatAt: at(20, 10), lastTurnAt: at(20, 5), holding: null })], watchedSince: at(19, 0), idle: { idleMin: 1, locked: false } })).kind).toBe('close') // someone queued: the rules as by day
  expect([isNight(at(20, 0)), isNight(at(8, 59)), isNight(at(9, 0)), isNight(at(19, 59))]).toEqual([true, true, false, false])
  expect([parseIdle('{"idleMin":45,"upMin":5711,"locked":false}'), parseIdle('{"idleMin":-1,"upMin":5711,"locked":false}'), parseIdle('{"idleMin":65000,"upMin":5711,"locked":false}'), parseIdle('{"idleMin":45,"locked":false}'), parseIdle('oops'), parseIdle(undefined)]).toEqual([{ idleMin: 45, locked: false }, null, null, null, null, null]) // review pass 3: idle longer than the uptime is a broken reading, never idle
  expect(idleArgv().join(' ')).toContain('[A5R.LastInput]::GetTickCount()') // the same 32-bit tick as GetLastInputInfo
  expect(idleArgv().join(' ')).not.toContain('TickCount64') // absent in Windows PowerShell 5.1: it read as 0 and every night as idle
  // 5 no Focus on it
  expect(keep({ claim: { kind: 'focus', id8: 'bbbbbbbb', lane: 'lane-bbbbbbbb', end: NOW + H } })).toBe('keep')
})

test('A123 (Fable review D1): with no PID in the lock nothing is closed: the one Editor of the checkout started in the lease is only shown to the person', () => {
  const ask = orphanOf(orphanIn({ lock: lockWith(null) }))
  expect(ask).toMatchObject({ kind: 'ask', pid: 777 })
  expect(askLook(ask)[0]?.what).toContain("lane-bbbbbbbb (session bbbbbbbb) looks gone and the shared checkout's Editor PID 777 may be its own")
  expect(askLook(ask)[0]?.next).toContain('A5R closes only an Editor its holder\'s lock line names')
  expect(orphanOf(orphanIn({ lock: lockWith(null), probe: probe([{ ...S2_EDITOR, parentAlive: true }]) })).kind).toBe('ask') // a hand launch too: shown, never closed
  expect(orphanOf(orphanIn({ lock: lockWith(null), probe: probe([{ ...S2_EDITOR, startedAt: SINCE - MIN }]) })).kind).toBe('keep') // started before the lease: not even shown
  expect(orphanOf(orphanIn({ lock: lockWith(null), probe: probe([S2_EDITOR, { ...S2_EDITOR, pid: 779 }]) })).kind).toBe('keep') // two: uncertain
  expect(askLook(orphanOf(orphanIn()))).toEqual([]) // a close is no question
})

test('A123: unit: another project\'s Editor is never closed, whatever else holds; the close is a WM_CLOSE to one PID, checked again, never a kill; the HELD line names the shared Editor', () => {
  expect(orphanOf(orphanIn({ probe: probe([OTHER_EDITOR]) })).kind).toBe('keep')
  expect(orphanOf(orphanIn({ probe: probe([OTHER_EDITOR, S2_EDITOR]) }))).toMatchObject({ kind: 'close', pid: 777 })
  expect(orphanOf(orphanIn({ probe: probe([OTHER_EDITOR]), lock: lockWith(888) })).kind).toBe('keep') // even the PID the lock names
  expect([namesPath('"E:\\s2\\S2.uproject" -x', UPROJECT), namesPath('E:/s2/S2.uproject', UPROJECT), namesPath('"E:\\s2\\S2.uproject.bak"', UPROJECT), namesPath('"X:\\E:\\s2\\S2.uproject"', UPROJECT), namesPath('python E:\\s2\\x.py', 'E:/s2', true), namesPath('python E:\\s2-wt\\x.py', 'E:/s2', true)]).toEqual([true, true, false, false, true, false])
  expect([sharedEditorPid(probe([OTHER_EDITOR, S2_EDITOR]), UPROJECT), sharedEditorPid(probe([OTHER_EDITOR]), UPROJECT), sharedEditorPid(probe([{ ...S2_EDITOR, cmd: undefined }]), UPROJECT)]).toEqual([777, null, null]) // Fable review D2
  const argv = closeArgv(777, UPROJECT).join(' ')
  expect(argv).toContain("Get-CimInstance Win32_Process -Filter 'ProcessId = 777'")
  expect(argv).toContain("Contains('e:/s2/s2.uproject')")
  expect(argv).toContain('(Get-Process -Id 777).CloseMainWindow()')
  expect(argv).not.toMatch(/Stop-Process|taskkill|\.Kill\(/i)
  expect(argv).not.toMatch(/Get-Process UnrealEditor|-Name/i) // never every UnrealEditor
  expect([closeAnswer('sent\r\n'), closeAnswer('mismatch'), closeAnswer(''), closeAnswer(undefined)]).toEqual(['sent', 'mismatch', 'failed', 'failed'])
  const r: OrphanRecord = { v: 1, pid: 777, at: NOW, id8: 'bbbbbbbb', lane: 'lane-bbbbbbbb', cmd: S2_EDITOR.cmd ?? '', why: 'w', by: ME8, answer: 'sent' }
  expect(orphanLook(r, probe([S2_EDITOR]), NOW + 2 * MIN)).toEqual([]) // within 3 min
  expect(orphanLook(r, probe([S2_EDITOR]), NOW + 3 * MIN)[0]?.what).toContain('was asked to close at 14:40 and still runs (it may be showing its own save prompt)')
  expect(orphanLook(r, probe([]), NOW + 10 * MIN)).toEqual([]) // it exited
  expect(orphanLook(r, probe([{ name: 'python', pid: 777, gb: 0.1, parentAlive: true }]), NOW + 10 * MIN)).toEqual([]) // Fable review D4: the PID reused by another program
  expect(orphanLook(r, probe([{ ...S2_EDITOR, startedAt: NOW + 5 * MIN }]), NOW + 10 * MIN)).toEqual([]) // reused by a later Editor
  expect(orphanNotice(r, 'bbbbbbbb')[0]?.text).toContain('A5R asked your Editor (PID 777) to close at 14:40')
  expect(orphanNotice(r, ME8)).toEqual([])
})

test('A123: the orphan is closed by one session with one WM_CLOSE to the PID its lock names, once this A5R has watched 30 min (logged rule=orphan-close, recorded); another project\'s Editor beside it is never touched', opts(), async ($, on) => {
  const w = world(on, { ram: '40', procs: [S2_EDITOR, OTHER_EDITOR], git: { CloseMainWindow: { stdout: 'sent' } } })
  w.put(LOCK, held('bbbbbbbb', 'lane-bbbbbbbb', SINCE, NOW + 90 * MIN, 777))
  w.put(`${HF}/editor/bbbbbbbb.json`, JSON.stringify(goneHolder({ want: want(), holding: { since: SINCE, end: NOW + 90 * MIN, extended: 0 } })))
  w.put(`${HF}/editor/${ME8}.json`, meFile({ want: want({ requestedAt: NOW - 5 * MIN }) }))
  await $.session.start(START)
  await w.clock.advance(20 * MIN)
  expect(w.runs.filter(r => r.includes('CloseMainWindow')).length).toBe(0) // this session started 20 min ago: it has not watched 30 min
  await w.clock.advance(11 * MIN)
  const closes = w.runs.filter(r => r.includes('CloseMainWindow'))
  expect(closes.length).toBe(1)
  expect(closes[0]).toContain("ProcessId = 777'")
  expect(w.runs.some(r => /Stop-Process[^;]*(777|888)|ProcessId = 888/.test(r))).toBe(false)
  expect(w.read(LOG)).toContain('| rule=orphan-close |')
  expect(JSON.parse(w.read(`${HF}/orphan-close.json`))).toMatchObject({ pid: 777, id8: 'bbbbbbbb', answer: 'sent', by: ME8 })
  await w.clock.advance(3 * MIN) // still running: the person looks (its save prompt), A5R never asks again
  expect(w.runs.filter(r => r.includes('CloseMainWindow')).length).toBe(1)
  expect(text(find(await pane($, w), 'hai-look'))).toContain('the Editor (PID 777) left by lane-bbbbbbbb (session bbbbbbbb, gone) was asked to close at')
})

test('A123 (Fable review D1): with no PID in the lock A5R closes nothing and NEEDS A LOOK names the candidate', opts(), async ($, on) => {
  const w = world(on, { ram: '40', procs: [S2_EDITOR], git: { CloseMainWindow: { stdout: 'sent' } } })
  w.put(LOCK, held('bbbbbbbb', 'lane-bbbbbbbb', SINCE, NOW + 90 * MIN))
  w.put(`${HF}/editor/bbbbbbbb.json`, JSON.stringify(goneHolder({ want: want(), holding: { since: SINCE, end: NOW + 90 * MIN, extended: 0 } })))
  w.put(`${HF}/editor/${ME8}.json`, meFile({ want: want({ requestedAt: NOW - 5 * MIN }) }))
  await $.session.start(START)
  await w.clock.advance(31 * MIN)
  expect(w.runs.filter(r => r.includes('CloseMainWindow')).length).toBe(0)
  expect(text(find(await pane($, w), 'hai-look'))).toContain("the shared checkout's Editor PID 777 may be its own")
})

test('A66 (Fable review D2): the holder\'s HELD line names the shared checkout\'s Editor, not another project\'s that the probe lists first', opts(), async ($, on) => {
  const w = world(on, { ram: '40', procs: [OTHER_EDITOR, S2_EDITOR] })
  w.put(LOCK, held(ME8, 'tail-vfx', NOW - 5 * MIN, NOW + 40 * MIN))
  w.put(`${HF}/editor/${ME8}.json`, meFile({ want: want(), holding: { since: NOW - 5 * MIN, end: NOW + 40 * MIN, extended: 0 } }))
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(lockOf(w).pid).toBe(777)
})

test('A125: this session\'s own wait counts minute by minute while it is alive, from 0 at its request', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held('dddddddd', 'lane-dddddddd', NOW - 10 * MIN, NOW + 40 * MIN))
  w.put(`${HF}/editor/dddddddd.json`, peer('dddddddd', { holding: { since: NOW - 10 * MIN, end: NOW + 40 * MIN, extended: 0 } }))
  await $.session.start(START)
  await $.tool.call({ tool: 'mcp__a5r__editor', action: 'request', minutes: 20, what: 'tail VFX' } as never)
  for (let i = 0; i < 3; i += 1) await w.clock.advance(MIN)
  const waited = (JSON.parse(w.read(`${HF}/editor/${ME8}.json`)) as SessionFile).want?.waited ?? -1
  expect(waited >= 2 * MIN && waited <= 4 * MIN).toBe(true)
})

// ---------- A124: syncs planned by themselves ----------
const sync = (o: Partial<SyncFile> = {}): SyncFile => ({ ...newSync(at(9, 0), { session: SID('dddddddd'), id8: 'dddddddd', lane: 'lane-dddddddd' }, 'x', at(8, 0)), state: 'done', updatedAt: at(9, 40), ...o })
const alive = (f: SessionFile): SessionFile => ({ ...f, heartbeatAt: at(23, 0) }) // alive all day
const conductor = alive(file('eeeeeeee', { lane: 'sync-main', title: 'S2 sync main' }))
const autoIn = (o: Partial<AutoSyncInput> = {}): AutoSyncInput => ({ sync: sync(), phase: 'done', files: [alive(file('dddddddd')), conductor], lanes: [], now: at(16, 0), titleOf: () => '', queued: 0, lockEnd: null, isFocusRunning: false, ...o })

test('A124: unit: 6 h without a sync → planned in the next quiet window (45 min ahead, after the lease, in the sync hours), by the conductor; never across a Focus or with a queue of 2', () => {
  expect(autoSyncOf(autoIn())).toMatchObject({ kind: 'plan', at: at(16, 45), holder: { id8: 'eeeeeeee' } })
  expect(autoSyncOf(autoIn({ now: at(15, 30) })).kind).toBe('none') // 6 h after 09:40 is 15:40
  expect(autoSyncOf(autoIn({ lockEnd: at(17, 10) }))).toMatchObject({ kind: 'plan', at: at(17, 45) }) // no lease crosses its cutoff
  expect(autoSyncOf(autoIn({ isFocusRunning: true })).kind).toBe('none')
  expect(autoSyncOf(autoIn({ queued: 2 })).kind).toBe('none')
  expect(autoSyncOf(autoIn({ queued: 1 })).kind).toBe('plan')
  expect(autoSyncOf(autoIn({ now: at(21, 30) })).kind).toBe('none') // 22:15 is outside the sync hours
  expect(autoSyncOf(autoIn({ now: at(14, 0), sync: sync({ at: at(7, 0), updatedAt: at(7, 0) }) })).kind).toBe('none') // 14:45: outside the hours
  expect(autoSyncOf(autoIn({ sync: sync({ state: 'planned', at: at(18, 0) }), phase: 'planned' })).kind).toBe('none') // one is planned
  // Holder: the conductor, else the last sync's holder while it is alive, else none (the person is told once a day).
  expect(syncHolderOf({ files: [alive(file('dddddddd')), conductor], lanes: [], now: NOW, last: sync(), titleOf: () => '' })?.id8).toBe('eeeeeeee')
  expect(syncHolderOf({ files: [alive(file('dddddddd'))], lanes: [], now: NOW, last: sync(), titleOf: () => '' })?.id8).toBe('dddddddd')
  expect(syncHolderOf({ files: [file('ffffffff')], lanes: [], now: NOW, last: sync(), titleOf: id8 => (id8 === 'ffffffff' ? 'Sync main conductor' : '') })?.id8).toBe('ffffffff') // its app title
  const none = autoSyncOf(autoIn({ files: [{ ...file('dddddddd'), heartbeatAt: NOW - H }] }))
  expect(none).toEqual({ kind: 'no-holder', since: at(9, 40) })
  expect(holderMissingText(none, at(16, 0))).toContain('main has not been synced for 6 h and no sync holder session is live')
})

test('A124: unit: a planned sync whose holder is gone is handed to the conductor; with none it stays open to a takeover by hand until T − 10 min, then is cancelled (and the next one is planned once a holder is live)', () => {
  const s = sync({ state: 'planned', at: at(17, 0) })
  const gone = { ...file('dddddddd'), heartbeatAt: at(15, 20) }
  const x = (o: Partial<AutoSyncInput>) => autoIn({ sync: s, phase: 'planned', files: [gone, conductor], now: at(15, 55), ...o })
  expect(autoSyncOf(x({}))).toMatchObject({ kind: 'take', holder: { id8: 'eeeeeeee' } }) // gone 35 min
  expect(autoSyncOf(x({ now: at(15, 45) })).kind).toBe('none') // gone 25 min: a reload may bring it back
  expect(autoSyncOf(x({ files: [gone] })).kind).toBe('none') // no conductor: a takeover by hand is still possible
  const cancel = autoSyncOf(x({ files: [gone], now: at(16, 50), phase: 'cutoff' }))
  expect(cancel).toEqual({ kind: 'cancel', note: `${LOST_NOTE}lane-dddddddd (session dddddddd) is gone and no sync holder session is live` })
  expect(holderMissingText(cancel, at(16, 50))).toContain('the planned sync was cancelled: its lane-dddddddd (session dddddddd) is gone')
  const cancelled = endedSync(s, 'cancelled', cancel.kind === 'cancel' ? cancel.note : '', at(16, 50))
  expect(autoSyncOf(autoIn({ sync: cancelled, phase: 'cancelled', now: at(17, 0) }))).toMatchObject({ kind: 'plan', holder: { id8: 'eeeeeeee' } }) // it never ran
  expect(autoSyncOf(autoIn({ sync: endedSync(s, 'cancelled', 'not today', at(16, 50)), phase: 'cancelled', now: at(17, 0) })).kind).toBe('none') // the person's cancel waits 6 h
})

test('A124: the conductor\'s own A5R plans the sync by itself through the sync path (sync.json, its cutoff told), once; another session does not', { ...opts(), options: { ...opts().options, autoSyncBuild: false } }, async ($, on) => {
  const w = world(on, { ram: '40', now: at(10, 0) })
  w.put(LOCK, FREE)
  w.put(SYNC, JSON.stringify(sync({ at: at(1, 0), updatedAt: at(1, 30) })))
  w.put(`${HF}/editor/${ME8}.json`, meFile({ lane: 'sync-main', title: 'S2 sync main', heartbeatAt: at(10, 0) }))
  await $.session.start(START)
  await w.clock.advance(MIN)
  const s = parseSyncFile(w.read(SYNC))
  expect([s?.state, s?.holder.id8, s?.at, s?.build]).toEqual(['planned', ME8, at(10, 45), false]) // merge only: autoSyncBuild set off
  expect(w.read(LOG)).toContain('| rule=auto-sync |')
  await w.clock.advance(MIN)
  expect(parseSyncFile(w.read(SYNC))?.at).toBe(at(10, 45)) // not planned again
})

test('A124 (rev 43, Hai 2026-10-29): an auto-planned sync builds by default (autoSyncBuild unset)', opts(), async ($, on) => {
  const w = world(on, { ram: '40', now: at(10, 0) })
  w.put(LOCK, FREE)
  w.put(SYNC, JSON.stringify(sync({ at: at(1, 0), updatedAt: at(1, 30) })))
  w.put(`${HF}/editor/${ME8}.json`, meFile({ lane: 'sync-main', title: 'S2 sync main', heartbeatAt: at(10, 0) }))
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(parseSyncFile(w.read(SYNC))?.build).toBe(true)
})

test('A124: a session that is not the would-be holder never plans', opts(), async ($, on) => {
  const w = world(on, { ram: '40', now: at(10, 0) })
  w.put(LOCK, FREE)
  w.put(SYNC, JSON.stringify(sync({ at: at(1, 0), updatedAt: at(1, 30) })))
  w.put(`${HF}/editor/eeeeeeee.json`, JSON.stringify({ ...conductor, heartbeatAt: at(20, 0) }))
  w.put(`${HF}/editor/${ME8}.json`, meFile({ heartbeatAt: at(10, 0) }))
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(parseSyncFile(w.read(SYNC))?.state).toBe('done')
})

// ---------- A125: the numbers and alerts tell the truth ----------
test('A125: unit: a wait counts only while its own session runs; a new request starts at 0, asking again keeps it; the summary and the panel read the live wait', () => {
  let w = want({ requestedAt: NOW, ...waitStart(null, NOW) })
  w = liveWait(w, NOW + MIN)
  w = liveWait(w, NOW + 2 * MIN)
  w = liveWait(w, NOW + 5 * H) // its session slept 5 h: 2 min at most
  expect(w.waited).toBe(4 * MIN)
  expect(liveWaitMin(w, NOW + 5 * H + 30_000)).toBe(5) // a peer reading it half a minute after its last count
  expect(liveWaitMin(want({ requestedAt: NOW - 3 * H }), NOW)).toBe(180) // an A5R before 0.26: its time on file
  expect(liveWait(want({ requestedAt: NOW - 20 * MIN }), NOW).waited).toBe(20 * MIN) // the same, at its first count
  expect(waitStart(w, NOW)).toEqual({ waited: 4 * MIN, waitAt: NOW + 5 * H })
  const f = { ...file(ME8), want: w, holding: { since: NOW + 6 * H, end: NOW + 7 * H, extended: 0 } }
  expect(endLease(f, { at: NOW + 7 * H, reason: 'released', isEditorOpen: false }).record?.liveWaitMs).toBe(4 * MIN)
  const r = rec({ requestedAt: NOW - 10 * H, grantedAt: NOW - H, endAt: NOW - 30 * MIN })
  expect(leaseSummary([{ ...r, liveWaitMs: 6 * MIN }], NOW).medianWaitMin).toBe(6)
  expect(leaseSummary([r], NOW).medianWaitMin).toBe(540) // a record without it: as before
})

test('A125: unit: requests of sessions gone 2 h are withdrawn; PIE is seen from a PIE window or the person\'s drivers (none by default); no-editor needs 30 min with no Editor or build at any point; old alert files go; the freeze concerns only some', () => {
  const stale = { ...file('cccccccc', { want: want(), lastTurnAt: NOW - 3 * H }), heartbeatAt: NOW - 2 * H }
  expect(staleWants([stale, { ...stale, id8: 'dddddddd', heartbeatAt: NOW - 100 * MIN }, { ...stale, id8: 'eeeeeeee', holding: { since: 0, end: 0, extended: 0 } }], [], NOW).map(f => f.id8)).toEqual(['cccccccc'])
  expect(staleWants([stale], [{ sessionId: SID('cccccccc'), hasEnded: true, mtimeMs: NOW - 30 * MIN }], NOW)).toEqual([]) // its lane beat 30 min ago
  const py: Proc = { name: 'python', pid: 9, gb: 0.1, parentAlive: true, cmd: '"C:\\Python\\python.exe" E:\\s2\\docs\\handoff\\pie-perf-tools\\lab.py --pie' }
  const win = (title: string, cmd = S2_EDITOR.cmd): Proc => ({ name: 'UnrealEditor', pid: 1, gb: 1, parentAlive: true, title, cmd })
  expect([pieSeen(probe([py]), [], SHARED), pieSeen(probe([py]), ['lab.py'], SHARED), pieSeen(probe([py]), ['ab.py'], SHARED), pieSeen(probe([win('S2 Preview [NetMode: Standalone 0]')]), [], SHARED), pieSeen(probe([win('S2 - Unreal Editor')]), [], SHARED)]).toEqual([false, true, false, true, false])
  // Another checkout's PIE is not this checkout's: a PIE window of another .uproject, a driver run from another folder.
  expect([pieSeen(probe([win('FluidNinja Preview [NetMode: Standalone 0]', OTHER_EDITOR.cmd)]), [], SHARED), pieSeen(probe([{ ...py, cmd: 'python E:\\Projects\\FluidNinjaLIVE\\lab.py' }]), ['lab.py'], SHARED), pieSeen(probe([{ ...py, cmd: 'python lab.py' }]), ['lab.py'], SHARED)]).toEqual([false, false, false])
  const lock = parseLockLine(held('bbbbbbbb', 'lane-bbbbbbbb', NOW - 40 * MIN, NOW + 20 * MIN))
  const holder = (notes: object) => file('bbbbbbbb', { holding: { since: NOW - 40 * MIN, end: NOW + 20 * MIN, extended: 0, notes } })
  expect(isNoEditorLease({ lock, holder: holder({}), now: NOW, probe: probe() })).toBe(true)
  expect(isNoEditorLease({ lock, holder: holder({}), now: NOW - 11 * MIN, probe: probe() })).toBe(false) // 29 min
  expect(isNoEditorLease({ lock, holder: holder({ editorAt: NOW - 35 * MIN }), now: NOW, probe: probe() })).toBe(false) // an Editor ran in it
  expect(isNoEditorLease({ lock, holder: holder({ buildAt: NOW - 35 * MIN }), now: NOW, probe: probe() })).toBe(false) // a build ran in it
  expect(isNoEditorLease({ lock, holder: holder({}), now: NOW, probe: probe([{ name: 'UnrealEditor', pid: 1, gb: 1, parentAlive: true }]) })).toBe(false)
  expect(prunable([{ name: 'a.json', kind: 'file', mtimeMs: NOW - 8 * 24 * H }, { name: 'b.json', kind: 'file', mtimeMs: NOW - 6 * 24 * H }, { name: 'c d.json', kind: 'file', mtimeMs: 0 }, { name: 'x', kind: 'dir', mtimeMs: 0 }], NOW)).toEqual(['a.json'])
  expect(pruneArgv('E:/s2/Saved/A5R/alerts', ['a.json']).join(' ')).toContain("Remove-Item -LiteralPath 'E:/s2/Saved/A5R/alerts/a.json'")
  const c = { isHolder: false, touched: 0, sharedShellAt: null, holds: false, wants: false }
  expect([isSyncConcerned(c), isSyncConcerned({ ...c, touched: 1 }), isSyncConcerned({ ...c, sharedShellAt: NOW }), isSyncConcerned({ ...c, holds: true }), isSyncConcerned({ ...c, wants: true }), isSyncConcerned({ ...c, isHolder: true })]).toEqual([false, true, true, true, true, true])
})

test('A125: unit: the kit guard lets read-only `sed -n` print lines from the kit; sed that writes stays refused', () => {
  const KIT = 'D:/Projects/ather-mods/a5r'
  const a5r = new A5R(CONFIG, { KIT, HOME: 'C:/Users/hai.huynh', USERPROFILE: 'C:/Users/hai.huynh', TEMP: 'C:/Users/HAI~1.HUY/AppData/Local/Temp', LOCALAPPDATA: 'C:/Users/hai.huynh/AppData/Local' })
  const pre = (c: string) => a5r.preShell(c, PROJ, {})?.key ?? null
  for (const c of [`sed -n 1,20p ${KIT}/hooks/coord.ts`, `sed -n '/decide/,/^}/p' ${KIT}/hooks/coord.ts`, `sed -n -e 5p ${KIT}/README.md`, `cat ${KIT}/README.md`, `rg -n x ${KIT}/hooks`, `head -5 ${KIT}/README.md`]) expect([c, pre(c)]).toEqual([c, null])
  for (const c of [`sed -i s/a/b/ ${KIT}/x`, `sed s/a/b/w${KIT}/y ${KIT}/x`, `sed -n 1p ${KIT}/x > ${KIT}/y`, `sed -n '1w ${KIT}/y' ${KIT}/x`, `sed -n 1e ${KIT}/x`, `sed -n -i 1p ${KIT}/x`, `sed -n --in-place=.bak 1p ${KIT}/x`, `sed -n -e 1p -e 'w ${KIT}/y' ${KIT}/x`, `sed -n -f C:/tmp/s.sed ${KIT}/x`]) expect([c, pre(c)]).toEqual([c, 'kit']) // review C1: every script and every option is read
})

test('A125: a request whose session is gone 2 h is withdrawn (logged) and shown nowhere; the no-editor line waits for 30 min with no Editor at any point', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held('dddddddd', 'lane-dddddddd', NOW - 10 * MIN, NOW + 40 * MIN))
  w.put(`${HF}/editor/dddddddd.json`, peer('dddddddd', { holding: { since: NOW - 10 * MIN, end: NOW + 40 * MIN, extended: 0 } }))
  w.put(`${HF}/editor/cccccccc.json`, JSON.stringify({ ...file('cccccccc', { want: want({ requestedAt: NOW - 5 * H }), lastTurnAt: NOW - 4 * H }), heartbeatAt: NOW - 3 * H }))
  w.put(`${HF}/editor/${ME8}.json`, meFile())
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect((JSON.parse(w.read(`${HF}/editor/cccccccc.json`)) as SessionFile).want).toBeNull()
  expect(w.read(LOG)).toContain('| rule=withdrawn | lane=lane-cccccccc |')
  expect(w.read(LOG)).not.toContain('rule=no-editor') // 11 min into the lease
  await w.clock.advance(20 * MIN)
  expect(w.read(LOG).match(/rule=no-editor/g)?.length).toBe(1) // 31 min in, once per lease
  await w.clock.advance(5 * MIN)
  expect(w.read(LOG).match(/rule=no-editor/g)?.length).toBe(1)
})

test('A125: the freeze line goes to the sessions it concerns; another session hears only the lift', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, FREE)
  w.put(SYNC, JSON.stringify(newSync(at(14, 50), { session: SID('bbbbbbbb'), id8: 'bbbbbbbb', lane: 'sync-lane' }, 'x', NOW - H)))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb'))
  w.put(`${HF}/editor/${ME8}.json`, meFile())
  await $.session.start(START)
  await w.clock.advance(11 * MIN) // 14:51: frozen
  const ctx = async () => ((await $.tool.call({ tool: 'Bash', command: 'echo hi' } as never)) as { context?: string[] }).context ?? []
  expect((await ctx()).filter(c => c.includes('Sync main'))).toEqual([])
  w.put(SYNC, JSON.stringify({ ...newSync(at(14, 50), { session: SID('bbbbbbbb'), id8: 'bbbbbbbb', lane: 'sync-lane' }, 'x', NOW - H), state: 'done', endedAt: at(14, 55), note: 'merged' }))
  await w.clock.advance(5 * MIN)
  expect((await ctx()).filter(c => c.includes('Sync main — done at 14:55')).length).toBe(1)
})
