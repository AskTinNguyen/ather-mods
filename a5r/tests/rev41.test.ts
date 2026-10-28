import { expect, test } from 'claude-code/testing'
import { DEFAULT_GATES, NO_MANUAL, blankSession, claimIn, decide, heldLine, lapseOf, mayAskYield, newSync, parseLockLine, queueOf, type FocusLease, type GrantInput, type Probe, type SessionFile, type Want } from '../hooks/coord.ts'
import { editorShellAct, isUnrealBuild, launchersOf, projectsOf } from '../hooks/editor.ts'
import { applyFocus, boxAnswer, boxMinutes, focusLease, focusLook, focusNotices, focusRefusal, focusWant, parseFocus, parseFocusCommand, stateOf, type Focus, type FocusInput } from '../hooks/focus.ts'
import { expectedStarts, holderNotices, queuedLine, queueView } from '../hooks/lease.ts'
import { manualOf, writesPersonFile, type QueueOrder } from '../hooks/order.ts'
import { A5RPANE, LOCK, ME, NOW, PROJ, find, opts, refused, still, text, world, type Rec, type Tree } from './world.ts'

// Rev 41 (L-45: "Editor orchestration should serve delivery: some tasks need a long focus, 2-3 h, through many trials,
// compiles, measurements and reopens"): A118 a Focus, the person's gift of the Editor to one session for a milestone; A119
// the other sessions' turns re-planned around it; A120 the others keep working without touching the focus Editor.
const HF = 'E:/s2/Saved/A5R'
const FOCUS = `${HF}/editor-focus.json`
const LOG = `${HF}/orchestrate.log`
const ME8 = ME.slice(0, 8)
const EDITOR = 'mcp__a5r__editor'
const MIN = 60_000
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const FREE = 'FREE since=14:00 2026-10-06 by=x note=none background=none · free since 14:00\n'
const want = (o: Partial<Want> = {}): Want => ({ minutes: 30, pie: false, build: false, what: 'their slot', mode: 'unattended', pausable: true, nextSafe: 'after save', requestedAt: NOW - 30 * MIN, ...o })
const file = (id8: string, o: Partial<SessionFile> = {}): SessionFile => ({ ...blankSession(SID(id8), `lane-${id8}`, `title ${id8}`, NOW), lastTurnAt: NOW - 2 * MIN, ...o })
const peer = (id8: string, o: Partial<SessionFile> = {}): string => JSON.stringify({ ...file(id8, o), heartbeatAt: NOW + 600 * MIN, ...o }) // alive for the whole test unless o says otherwise
const held = (id8: string, lane: string, since: number, end: number) => `${heldLine({ lane, sessionName: lane, id8, since, pid: null, end, mode: 'interactive', pausable: true, nextSafe: 'after save', note: 'their slot' })}\n`
const probe = (freeGb: number): Probe => ({ freeGb, diskGb: 40, procs: [] })
const focusOf = (id8: string, o: Partial<Focus> = {}): Focus => ({ v: 1, id8, session: SID(id8), lane: `lane-${id8}`, milestone: 'the bird lands in PIE', startedAt: NOW, endsAt: NOW + 120 * MIN, setBy: 'the person (command in x)', extensions: [], ended: null, ...o })
const leaseOf = (f: Focus, now = NOW): FocusLease => focusLease(f, now) as FocusLease
const input = (me8: string, files: SessionFile[], o: Partial<GrantInput> = {}): GrantInput => ({ me8, lock: parseLockLine(FREE), files, lanes: [], now: NOW, sync: null, probe: probe(45), gates: DEFAULT_GATES, manual: NO_MANUAL, focus: null, ...o })
const out = (ran: { result?: unknown; text?: string; deny?: string }): string => String(ran.deny ?? ran.result ?? ran.text ?? '')
const ctx = (ran: unknown): string => ((ran as { context?: string[] }).context ?? []).join('\n')
const run = async ($: any, args: string, origin: Rec | undefined = { kind: 'composer' }) => String((await $.command.run({ command: 'a5r', args, ...(origin ? { origin } : {}) } as never)).text)
const focusFile = (w: ReturnType<typeof world>): Focus | null => parseFocus(w.read(FOCUS) || null)
const lockOf = (w: ReturnType<typeof world>) => parseLockLine(w.read(LOCK))
const mineFile = (w: ReturnType<typeof world>): SessionFile => JSON.parse(w.read(`${HF}/editor/${ME8}.json`)) as SessionFile
const QUEUED: [string, Partial<Want>][] = [
  ['cccccccc', { minutes: 45, pie: true, requestedAt: NOW - 77 * MIN }],
  ['dddddddd', { minutes: 75, pie: true, requestedAt: NOW - 74 * MIN }],
  ['eeeeeeee', { minutes: 45, build: true, requestedAt: NOW - 65 * MIN }],
  ['ffffffff', { minutes: 15, requestedAt: NOW - 49 * MIN }],
]
const queued = (w: ReturnType<typeof world>, o: Record<string, Partial<SessionFile>> = {}) => {
  for (const [id8, x] of QUEUED) w.put(`${HF}/editor/${id8}.json`, peer(id8, { want: want(x), ...o[id8] }))
}
const meFile = (o: Partial<SessionFile> = {}) => JSON.stringify({ ...blankSession(ME, 'tail-vfx', 'Tail', NOW), ...o })
const pane = async ($: any, w: ReturnType<typeof world>): Promise<Tree> => {
  await $.ui.render(A5RPANE as never)
  await w.clock.advance(50)
  return still(await $.ui.render(A5RPANE as never)) as Tree
}
const git = async ($: any) => ctx(await $.tool.call({ tool: 'Bash', command: 'git status' } as never))
/** What this session was told: the prompts its A5R woke it with (an actionable notice while idle), then the context of its next tool call. */
const told = async ($: any, w: ReturnType<typeof world>) => [...((w.calls['prompt.submit'] ?? []) as { text: string }[]).map(p => p.text), await git($)].join('\n')
const why = (r: { refusal: string } | object): string => ('refusal' in r ? String(r.refusal) : '')

// ---------- A118: units ----------
test('A118: unit: the person\'s command: a name, a box (30 min to 3 h, default 3 h) and a milestone; end; +N', () => {
  expect(parseFocusCommand('Hệ thống enemy 2h: chim bay tới đích')).toEqual({ kind: 'start', who: { name: 'Hệ thống enemy' }, minutes: 120, milestone: 'chim bay tới đích' })
  expect(parseFocusCommand('cccccccc: the bird lands')).toEqual({ kind: 'start', who: { name: 'cccccccc' }, minutes: 180, milestone: 'the bird lands' })
  expect(parseFocusCommand('loco 2h30: stop pose: on time')).toEqual({ kind: 'start', who: { name: 'loco' }, minutes: 150, milestone: 'stop pose: on time' })
  expect([parseFocusCommand('end'), parseFocusCommand('+30'), parseFocusCommand('+60'), parseFocusCommand('')]).toEqual([{ kind: 'end' }, { kind: 'extend', add: 30 }, { kind: 'extend', add: 60 }, { kind: 'show' }])
  expect('usage' in parseFocusCommand('2h: nobody')).toBe(true)
  expect(['3h', '2h30', '2h30m', '2.5h', '90m', '150min', 'x', '2'].map(boxMinutes)).toEqual([180, 150, 150, 150, 90, 150, null, null])
  expect([boxAnswer('3 h'), boxAnswer('2h: the bird lands'), boxAnswer('soon')]).toEqual([{ minutes: 180, milestone: '' }, { minutes: 120, milestone: 'the bird lands' }, null])
})

test('A118: unit: a start is the person\'s, one at a time, 30 min to 3 h, to a live session that knows Focus; done is the focus session\'s own', () => {
  const files = [file('cccccccc'), file('dddddddd'), { ...file('eeeeeeee'), knowsFocus: undefined }]
  const x = (o: Partial<FocusInput> = {}): FocusInput => ({ focus: null, me8: 'dddddddd', files, lanes: [], now: NOW, sync: null, phase: 'none', titleOf: () => '', ...o })
  const start = (who: string, minutes = 120) => applyFocus(x(), { kind: 'start', who: { name: who }, minutes, milestone: 'the bird lands' }, 'the person')
  const ok = start('lane-cccccccc')
  expect('focus' in ok && [ok.focus.id8, ok.focus.endsAt, ok.focus.milestone, ok.focus.setBy]).toEqual(['cccccccc', NOW + 120 * MIN, 'the bird lands', 'the person'])
  expect(why(start('lane-eeeeeeee'))).toContain('runs an A5R older than 0.25.0') // a 0.24 target would never take the lock
  expect(why(start('lane-cccccccc', 200))).toContain('give 30 min to 3 h')
  expect(why(start('lane-cccccccc', 20))).toContain('give 30 min to 3 h')
  const f = focusOf('cccccccc')
  const again = applyFocus(x({ focus: f }), { kind: 'start', who: { name: 'lane-dddddddd' }, minutes: 60, milestone: '' }, 'the person')
  expect(why(again)).toContain('one Focus at a time')
  const other = applyFocus(x({ focus: f }), { kind: 'done', note: 'x' }, 'lane-dddddddd')
  expect(why(other)).toContain('only the focus session reports its own milestone')
  const done = applyFocus(x({ focus: f, me8: 'cccccccc' }), { kind: 'done', note: 'it lands' }, 'lane-cccccccc')
  expect('focus' in done && done.focus.ended).toEqual({ at: NOW, how: 'done', by: 'lane-cccccccc' })
  // A Focus that ran out is no Focus: a new one may start.
  expect('focus' in applyFocus(x({ focus: focusOf('cccccccc', { endsAt: NOW - MIN }) }), { kind: 'start', who: { name: 'lane-dddddddd' }, minutes: 60, milestone: '' }, 'p')).toBe(true)
})

test('A118: unit: the lease a Focus gives: the box end while it runs; cut to 10 min after an early end; none once the box ran out', () => {
  const f = focusOf('cccccccc')
  expect([stateOf(f, NOW), leaseOf(f)]).toEqual(['running', { id8: 'cccccccc', lane: 'lane-cccccccc', milestone: 'the bird lands in PIE', startedAt: NOW, end: NOW + 120 * MIN, isRunning: true }])
  expect(focusLease({ ...f, ended: { at: NOW + 30 * MIN, how: 'ended', by: 'p' } }, NOW + 31 * MIN)).toEqual({ id8: 'cccccccc', lane: 'lane-cccccccc', milestone: 'the bird lands in PIE', startedAt: NOW, end: NOW + 40 * MIN, isRunning: false })
  expect([stateOf(f, NOW + 120 * MIN), focusLease(f, NOW + 120 * MIN)]).toEqual(['over', null])
})

test('A118: unit: a running Focus is never lapsed, passed on, recovered or asked to yield; one ended early lapses from its cut end', () => {
  const lock = parseLockLine(held('cccccccc', 'lane-cccccccc', NOW - 5 * MIN, NOW + 115 * MIN))
  const holderGone = { ...file('cccccccc', { lastTurnAt: NOW - 60 * MIN, holding: { since: NOW - 5 * MIN, end: NOW + 115 * MIN, extended: 0 } }), heartbeatAt: NOW - 20 * MIN }
  const holderIdle = { ...file('cccccccc', { lastTurnAt: NOW - 60 * MIN, holding: { since: NOW - 15 * MIN, end: NOW + 105 * MIN, extended: 0 } }) }
  const waiter = file('dddddddd', { want: want() })
  const f = focusOf('cccccccc', { startedAt: NOW - 20 * MIN, endsAt: NOW + 115 * MIN })
  const at = (now: number, holder: SessionFile, focus: FocusLease | null, l = lock) => lapseOf({ lock: l, files: [holder, waiter], lanes: [], now, probe: probe(40), waiting: [waiter], sync: null, focus })
  const unseenLock = parseLockLine(held('cccccccc', 'lane-cccccccc', NOW - 15 * MIN, NOW + 105 * MIN))
  expect(at(NOW, holderIdle, null, unseenLock)?.kind).toBe('unseen') // without the Focus it would pass on
  expect(at(NOW, holderIdle, leaseOf(f), unseenLock)).toBeNull()
  expect(at(NOW + 130 * MIN, holderGone, null)?.kind).toBe('lapsed')
  expect(at(NOW + 100 * MIN, holderGone, leaseOf(f, NOW + 100 * MIN))).toBeNull()
  // A gone focus session whose HELD line still says an earlier end (an extension it never wrote down) keeps it while the box runs.
  const shortLine = parseLockLine(held('cccccccc', 'lane-cccccccc', NOW - 5 * MIN, NOW + 20 * MIN))
  expect(at(NOW + 40 * MIN, holderGone, null, shortLine)?.kind).toBe('lapsed')
  expect(at(NOW + 40 * MIN, holderGone, leaseOf(f, NOW + 40 * MIN), shortLine)).toBeNull()
  // The person ended it at 14:40: the lease ends 14:50 for every reader; a gone holder lapses 10 min after that (never "unseen":
  // the person gave that lease).
  const ended = { ...f, ended: { at: NOW, how: 'ended' as const, by: 'p' } }
  expect(at(NOW + 19 * MIN, holderGone, focusLease(ended, NOW + 19 * MIN))).toBeNull()
  expect(at(NOW + 20 * MIN, holderGone, focusLease(ended, NOW + 20 * MIN))).toEqual({ kind: 'lapsed', at: NOW + 20 * MIN, by: '', since: NOW - 5 * MIN, end: NOW + 10 * MIN })
  // decide: a gone focus holder is not recovered by the head of the queue; a short request asks no yield.
  const files = [holderGone, waiter]
  expect(decide(input('dddddddd', files, { lock, focus: leaseOf(f) }))).toMatchObject({ kind: 'wait', code: 'focus', reason: 'after the Focus' })
  expect(decide(input('dddddddd', files, { lock })).kind).toBe('recover')
  const short = file('dddddddd', { want: want({ minutes: 15 }) })
  const alive = file('cccccccc', { holding: { since: NOW - 30 * MIN, end: NOW + 90 * MIN, extended: 0 } })
  expect(mayAskYield(input('dddddddd', [alive, short], { lock: parseLockLine(held('cccccccc', 'lane-cccccccc', NOW - 30 * MIN, NOW + 90 * MIN)) }))).toEqual({ holder: 'cccccccc' })
  expect(mayAskYield(input('dddddddd', [alive, short], { lock: parseLockLine(held('cccccccc', 'lane-cccccccc', NOW - 30 * MIN, NOW + 90 * MIN)), focus: leaseOf(f) }))).toBeNull()
})

test('A118: unit: the focus session goes first and takes a free lock to its box end with no launch gate; every other request waits for it', () => {
  const f = focusOf('dddddddd')
  const files = [file('cccccccc', { want: want({ requestedAt: NOW - 60 * MIN }) }), file('dddddddd', { want: want({ pie: true, requestedAt: NOW - 5 * MIN }) })]
  expect(queueOf(files, [], NOW, claimIn({ sync: null, files, lanes: [], now: NOW, focus: leaseOf(f) }), NO_MANUAL).map(s => s.id8)).toEqual(['dddddddd', 'cccccccc'])
  expect(decide(input('dddddddd', files, { probe: probe(20), focus: leaseOf(f) }))).toEqual({ kind: 'grant', end: NOW + 120 * MIN, reuse: null })
  expect(decide(input('dddddddd', files, { probe: probe(20) })).kind).toBe('wait') // without the Focus: behind cccccccc, and under the gate
  expect(decide(input('cccccccc', files, { focus: leaseOf(f) }))).toMatchObject({ kind: 'wait', code: 'focus' })
  // A merge in progress still holds every grant, a Focus's too.
  expect(decide(input('dddddddd', files, { focus: leaseOf(f), conflictHead: 'MERGE_HEAD' }))).toMatchObject({ kind: 'wait', code: 'merge' })
})

test('A118: unit: what a holder is told: a Focus lease hears no end, idle or yield notice; a sync holder keeps its idle notice', () => {
  const h = { since: NOW - 60 * MIN, end: NOW - MIN, extended: 0 }
  const base = { now: NOW, isFocusLease: false, isClaimed: false, editorUseAt: NOW - 40 * MIN, lastTurnAt: NOW - 40 * MIN, agents: 0, isPie: false, isUnattended: false, asks: [], waiting: 0 }
  expect(holderNotices(h, base).map(n => n.id.split(':')[1])).toEqual(['overrun', 'idle'])
  expect(holderNotices(h, { ...base, isFocusLease: true, isClaimed: true })).toEqual([])
  expect(holderNotices(h, { ...base, isFocusLease: true }).map(n => n.id.split(':')[1])).toEqual(['idle']) // a Focus ended early: an ordinary lease's idle notice again
})

// ---------- A118: engine ----------
test('A118: only the person starts a Focus: his own command writes editor-focus.json; a plugin\'s run, the editor tool and a model\'s edit or command cannot', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, FREE)
  queued(w, { eeeeeeee: { knowsFocus: undefined } })
  w.put(`${HF}/editor/${ME8}.json`, meFile())
  await $.session.start(START)
  expect(await run($, 'focus lane-cccccccc 2h: the bird lands', { kind: 'plugin', name: 'x' })).toContain('only the person gives, extends or ends a Focus, and this command came from plugin')
  for (const action of ['focus', 'start', 'focus done', 'focus_done']) await $.tool.call({ tool: EDITOR, action, who: 'cccccccc', minutes: 120 } as never)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'focus_done', note: 'x' } as never))).toContain('A5R · Focus — no Focus runs')
  expect(refused(await $.tool.call({ tool: 'Write', file_path: FOCUS, content: JSON.stringify(focusOf(ME8)) } as never))).toContain('editor-focus.json are the person\'s')
  expect(refused(await $.tool.call({ tool: 'Bash', command: `echo '{}' > ${FOCUS}` } as never))).toContain('Editor order')
  expect(refused(await $.tool.call({ tool: 'Bash', command: `cat ${FOCUS}` } as never))).toBeUndefined()
  expect(w.read(FOCUS)).toBe('')
  expect(await run($, 'focus lane-eeeeeeee 2h: x')).toContain('runs an A5R older than 0.25.0')
  const said = await run($, 'focus lane-cccccccc 2h: the bird lands')
  expect(said).toBe('A5R · Focus — lane-cccccccc has the Editor for a Focus until 16:40 (the bird lands), given by the person (command in tail-vfx); the queue pauses behind it and runs on after → every session reads it at its next minute; the sessions it concerns are told')
  const f = focusFile(w)
  expect([f?.id8, f?.startedAt, f?.endsAt, f?.milestone, f?.ended]).toEqual(['cccccccc', NOW, NOW + 120 * MIN, 'the bird lands', null])
  expect(w.read(LOG)).toContain('| rule=focus | lane=tail-vfx | session=ab12cd34 |') // the session the person typed in
  expect(await run($, 'focus lane-dddddddd 1h: other')).toContain('one Focus at a time')
  expect(mineFile(w).knowsFocus).toBe(true) // 0.25.0 says it knows Focus
})

test('A118: the focus session takes the free lock to its box end (no launch gate) and keeps it through close and reopen: release keeps it, no idle, yield or overrun notice, nobody else is granted', opts(), async ($, on) => {
  const w = world(on, { ram: '20' }) // under the 28 GB launch gate
  w.put(LOCK, FREE)
  queued(w, { cccccccc: { yieldAsks: [{ holder: ME8, at: NOW + 3 * MIN, via: 'file', minutes: 15, lane: 'lane-cccccccc' }] } })
  w.put(`${HF}/editor/${ME8}.json`, meFile())
  w.put(FOCUS, JSON.stringify(focusOf(ME8, { lane: 'tail-vfx', endsAt: NOW + 180 * MIN })))
  await $.session.start(START)
  const first = await told($, w)
  expect(lockOf(w)).toMatchObject({ kind: 'held', id8: ME8, end: '17:40', pausable: false })
  expect(lockOf(w).note).toContain('Focus: the bird lands in PIE (build)')
  expect(first).toContain('A5R · Editor — granted to this session until 17:40; cleanup: free RAM 20 GB against the launch gate of 28 GB (38 with PIE): free memory before you launch')
  expect(first).toContain('A5R · Focus — the person gave this session the Editor for a Focus until 17:40: the bird lands in PIE')
  expect(mineFile(w).want).toMatchObject({ build: true, pausable: false, focus: NOW })
  // A plain release keeps the lock; extend answers that the box is the person's.
  const kept = out(await $.tool.call({ tool: EDITOR, action: 'release' } as never))
  expect(kept).toContain('A5R · Focus — the Focus continues until 17:40: the lock stays this session\'s, through closes, builds and reopens → when the milestone is reached call the editor tool with action focus_done')
  expect(out(await $.tool.call({ tool: EDITOR, action: 'extend', minutes: 30 } as never))).toContain('the lease runs to the box end, which only the person moves')
  expect(lockOf(w).id8).toBe(ME8)
  // An Editor opens, closes; 50 quiet minutes pass (no turn, no Editor use): the lock stays, with no idle, yield or overrun notice.
  w.machine.procs = [{ name: 'UnrealEditor', pid: 4242, gb: 20, parentAlive: true, cmd: '"D:/UE/UnrealEditor.exe" "E:/s2/S2.uproject"' }]
  await w.clock.advance(MIN)
  expect(lockOf(w).pid).toBe(4242)
  w.machine.procs = []
  await w.clock.advance(50 * MIN)
  expect(lockOf(w)).toMatchObject({ kind: 'held', id8: ME8, end: '17:40' })
  const later = await told($, w)
  expect(later).not.toMatch(/has not used it for|Editor yield|your lease ended|your lease ends/)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 120, build: true } as never))).toContain('already holds the Editor until 17:40')
})

test('A118: the focus session\'s focus_done ends the Focus and gives the Editor back at once; the queue runs on in its order', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held(ME8, 'tail-vfx', NOW - 20 * MIN, NOW + 100 * MIN))
  queued(w)
  w.put(`${HF}/editor/${ME8}.json`, meFile({ want: want({ requestedAt: NOW - 90 * MIN }), holding: { since: NOW - 20 * MIN, end: NOW + 100 * MIN, extended: 0 } }))
  w.put(FOCUS, JSON.stringify(focusOf(ME8, { lane: 'tail-vfx', startedAt: NOW - 20 * MIN, endsAt: NOW + 100 * MIN })))
  await $.session.start(START)
  await $.tool.call({ tool: 'mcp__unreal-mcp__call_tool', name: 'McpPieToolset.StartPIE' } as never)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'focus_done', note: 'x' } as never))).toContain('stop PIE first (or call focus_done with pie_stopped: true once it has ended)')
  expect(focusFile(w)?.ended).toBeNull() // PIE is checked before the Focus ends
  const said = out(await $.tool.call({ tool: EDITOR, action: 'focus_done', note: 'the bird lands at 60 fps', pie_stopped: true } as never))
  expect(said).toContain('A5R · Focus — Focus done at 14:40: the bird lands at 60 fps → the queue runs on in its order')
  expect(said).toContain('released: FREE since=14:40')
  expect(lockOf(w).kind).toBe('free')
  expect(lockOf(w).note).toContain('Focus done: the bird lands at 60 fps')
  expect(focusFile(w)?.ended).toEqual({ at: NOW, how: 'done', by: 'tail-vfx' })
  const files = ['cccccccc', 'dddddddd', 'eeeeeeee', 'ffffffff'].map(id8 => JSON.parse(w.read(`${HF}/editor/${id8}.json`)) as SessionFile)
  expect(files.filter(s => decide(input(s.id8, files)).kind === 'grant').map(s => s.id8)).toEqual(['cccccccc'])
})

test('A118: the person ends a Focus: its session\'s lease is cut to 10 min later (its own A5R rewrites the line) and it is told to reach a checkpoint', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held(ME8, 'tail-vfx', NOW - 20 * MIN, NOW + 100 * MIN))
  w.put(`${HF}/editor/${ME8}.json`, meFile({ want: want({ requestedAt: NOW - 90 * MIN }), holding: { since: NOW - 20 * MIN, end: NOW + 100 * MIN, extended: 0 } }))
  w.put(FOCUS, JSON.stringify(focusOf(ME8, { lane: 'tail-vfx', startedAt: NOW - 20 * MIN, endsAt: NOW + 100 * MIN })))
  await $.session.start(START)
  await git($)
  expect(await run($, 'focus end', { kind: 'plugin', name: 'x' })).toContain('only the person')
  expect(await run($, 'focus end')).toContain('Focus ended at 14:40 by the person (command in tail-vfx); its lease ends by 14:50')
  await w.clock.advance(MIN)
  expect(lockOf(w)).toMatchObject({ id8: ME8, end: '14:50' })
  expect(await told($, w)).toContain('A5R · Focus — the person ended your Focus at 14:40; your lease ends by 14:50 → stop at the nearest checkpoint')
  // After the cut its lease is an ordinary one again: its end is its own to warn of.
  await w.clock.advance(10 * MIN)
  expect(lockOf(w).id8).toBe(ME8) // never FREE under a live holder
})

test('A118: the box runs out unfinished: the Focus is over for every reader (nothing written), its session is told to release, and NEEDS A LOOK says so', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held(ME8, 'tail-vfx', NOW - 20 * MIN, NOW + 30 * MIN))
  w.put(`${HF}/editor/${ME8}.json`, meFile({ want: want({ requestedAt: NOW - 90 * MIN }), holding: { since: NOW - 20 * MIN, end: NOW + 30 * MIN, extended: 0 } }))
  w.put(FOCUS, JSON.stringify(focusOf(ME8, { lane: 'tail-vfx', startedAt: NOW - 150 * MIN, endsAt: NOW + 30 * MIN })))
  await $.session.start(START)
  await git($)
  await w.clock.advance(31 * MIN)
  const said = await told($, w)
  expect(said).toContain('A5R · Focus — your Focus box ended at 15:10 and the milestone was not reported done → stop at the nearest checkpoint')
  expect(said).not.toContain('your lease ended at 15:10') // the Focus notice says it, once
  expect(focusFile(w)?.ended).toBeNull()
  expect(lockOf(w).id8).toBe(ME8)
  expect(text(find(await pane($, w), 'hai-look'))).toContain("Tail's Focus ran out at 15:10 with its milestone not reported (the bird lands in PIE)")
})

test('A118: a quiet focus session (30 min, no turn, no agent) and a gone one are each a NEEDS A LOOK note, never an end', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held('cccccccc', 'lane-cccccccc', NOW - 35 * MIN, NOW + 85 * MIN))
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { lastTurnAt: NOW - 40 * MIN, holding: { since: NOW - 35 * MIN, end: NOW + 85 * MIN, extended: 0 } }))
  w.put(FOCUS, JSON.stringify(focusOf('cccccccc', { startedAt: NOW - 35 * MIN, endsAt: NOW + 85 * MIN })))
  w.put(`${HF}/editor/${ME8}.json`, meFile({ want: want({ requestedAt: NOW - 10 * MIN }) }))
  await $.session.start(START)
  expect(text(find(await pane($, w), 'hai-look'))).toContain("14:40 lane-cccccccc's Focus (until 16:05): no turn and no agent for 35 min→ look at it: end the Focus (End, or /a5r focus end), or extend it if it is working")
  // Gone (no heartbeat): said apart; nothing ends it but the person or the box; the head is not granted over it.
  w.put(`${HF}/editor/cccccccc.json`, JSON.stringify({ ...file('cccccccc', { holding: { since: NOW - 35 * MIN, end: NOW + 85 * MIN, extended: 0 } }), heartbeatAt: NOW - 30 * MIN }))
  await w.clock.advance(40 * MIN)
  const look = text(find(await pane($, w), 'hai-look'))
  expect(look).toContain("lane-cccccccc's Focus (until 16:05): its session is gone (no heartbeat since 14:10)→ end the Focus (End, or /a5r focus end): only the box end ends it by itself")
  expect([focusFile(w)?.ended, lockOf(w).id8]).toEqual([null, 'cccccccc'])
  expect(focusLook(focusFile(w), [], [], NOW + 10 * MIN, () => '').map(r => r.what)).toEqual(["14:50 lane-cccccccc's Focus (until 16:05): no turn and no agent for 45 min"]) // unit: no file of its session: quiet since its start
})

test('A118: a Focus may not cross a planned sync\'s cutoff (the person\'s choice: move the sync or a shorter box); a sync planned in a Focus starts after it', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, FREE)
  queued(w)
  w.put(`${HF}/editor/${ME8}.json`, meFile())
  w.put(`${HF}/sync.json`, JSON.stringify(newSync(NOW + 120 * MIN, { session: SID('dddddddd'), id8: 'dddddddd', lane: 'sync-lane' }, 'x', NOW)))
  await $.session.start(START)
  expect(await run($, 'focus lane-cccccccc 2h: x')).toBe('A5R · Focus — the Focus would end at 16:40, past the cutoff 16:10 of the sync at 16:40 → your choice: move the sync to 17:10 or later (/a5r sync move HH:MM in sync-lane), or a shorter box that ends by the cutoff (/a5r focus lane-cccccccc 90m: …)')
  expect(await run($, 'focus lane-cccccccc 90m: x')).toContain('has the Editor for a Focus until 16:10')
  expect(await run($, 'focus +15')).toContain('past the cutoff 16:10')
  w.put(`${HF}/sync.json`, '')
  await w.clock.advance(MIN)
  expect(await run($, 'sync 16:00')).toBe('A5R · Sync main — lane-cccccccc has a Focus until 16:10, and the sync\'s cutoff 15:30 falls inside it → plan the sync at 16:40 or later (its cutoff after the Focus), or the person ends the Focus first')
  expect(await run($, 'sync 16:40')).toContain('planned: the sync at 16:40')
})

test('A118: a press on a row\'s Focus… asks the box in one dialog (a label, or <box>: <milestone> under Other) and starts it; while one runs the rows offer no Focus…', opts(), async ($, on) => {
  const w = world(on, { ram: '40', ask: '2h: the bird lands' })
  w.put(LOCK, FREE)
  queued(w)
  w.put(`${HF}/editor/${ME8}.json`, meFile())
  await $.session.start(START)
  await pane($, w)
  await $.ui.press({ plugin: 'a5r', key: 'hai-queue-pick-dddddddd', surface: 'terminal' })
  let tree = await pane($, w)
  expect((find(tree, 'hai-queue-dddddddd-ctl')?.children ?? []).map(c => (c as Tree).props?.label)).toEqual(['Up', 'Down', 'To top', '−15 min', '+15 min', 'Focus…'])
  await $.ui.press({ plugin: 'a5r', key: 'hai-queue-dddddddd-ctl-focus', surface: 'terminal' })
  const asked = ((w.calls.ask ?? []) as Rec[]).map(a => String(((a.questions as Rec[] | undefined) ?? [])[0]?.question ?? ''))
  expect(asked).toEqual(['Give lane-dddddddd a Focus: how long? (under Other, type <2h|3h>: <milestone> to name the milestone)'])
  expect([focusFile(w)?.id8, (focusFile(w)?.endsAt ?? 0) - (focusFile(w)?.startedAt ?? 0), focusFile(w)?.milestone, focusFile(w)?.setBy]).toEqual(['dddddddd', 120 * MIN, 'the bird lands', 'the person (panel in tail-vfx)'])
  tree = await pane($, w)
  expect((find(tree, 'hai-queue-cccccccc-ctl')?.children ?? []).map(c => (c as Tree).props?.label)).toEqual([]) // not selected
  await $.ui.press({ plugin: 'a5r', key: 'hai-queue-pick-cccccccc', surface: 'terminal' })
  tree = await pane($, w)
  expect((find(tree, 'hai-queue-cccccccc-ctl')?.children ?? []).map(c => (c as Tree).props?.label)).toEqual(['Up', 'Down', 'To top', '−15 min', '+15 min'])
  await $.ui.press({ plugin: 'a5r', key: 'hai-queue-focus-ctl-end', surface: 'terminal' })
  expect(focusFile(w)?.ended?.how).toBe('ended')
})

// ---------- A119: the others re-planned ----------
test('A119: unit: an expected start is the Focus end plus each earlier turn (the person\'s minutes honoured); the panel row says it', () => {
  const f = focusOf('cccccccc')
  const files = QUEUED.map(([id8, x]) => file(id8, { want: want(x) }))
  const sized: QueueOrder = { v: 1, placed: [], sized: [{ id8: 'eeeeeeee', requestedAt: NOW - 65 * MIN, isKept: false, at: NOW, by: 'p', minutes: 20 }], changes: [] }
  const x = input(ME8, files, { manual: manualOf(sized, files, NOW), focus: leaseOf(f) })
  const starts = expectedStarts(x, f.endsAt)
  expect([...starts.entries()]).toEqual([['dddddddd', NOW + 120 * MIN], ['eeeeeeee', NOW + 195 * MIN], ['ffffffff', NOW + 215 * MIN]])
  const view = queueView(x)
  expect(view.rows.map(queuedLine)).toEqual(['waiting 77 min · 45 min · PIE · granted next', 'waiting 74 min · 75 min · PIE · after the Focus · starts ~16:40', 'waiting 65 min · 20 min (set by hand) · build · after the Focus · starts ~17:55', 'waiting 49 min · 15 min · after the Focus · starts ~18:15'])
  // When it ends the order runs on as it was (the person's pins included): the Focus was only a rank before them.
  const pinned: QueueOrder = { v: 1, placed: [{ id8: 'ffffffff', requestedAt: NOW - 49 * MIN, isKept: false, at: NOW, by: 'p' }], sized: [], changes: [] }
  expect(queueOf(files, [], NOW, claimIn({ sync: null, files, lanes: [], now: NOW, focus: leaseOf(focusOf('eeeeeeee')) }), manualOf(pinned, files, NOW)).map(s => s.id8)).toEqual(['eeeeeeee', 'ffffffff', 'cccccccc', 'dddddddd'])
  expect(queueOf(files, [], NOW, null, manualOf(pinned, files, NOW)).map(s => s.id8)).toEqual(['ffffffff', 'cccccccc', 'dddddddd', 'eeeeeeee'])
})

test('A119: a queued session is told its expected start when a Focus starts, again only when it moves by 15 min or more (an extension, an early end); the panel shows the starts', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, FREE)
  queued(w)
  w.put(`${HF}/editor/${ME8}.json`, meFile({ want: want({ minutes: 30, requestedAt: NOW - 20 * MIN }) }))
  await $.session.start(START)
  await git($)
  await run($, 'focus lane-cccccccc 2h: the bird lands')
  await w.clock.advance(MIN)
  expect(await git($)).toContain('A5R · Editor — the person gave lane-cccccccc a Focus until 16:40 (the bird lands); the queue pauses behind it: your turn is expected about 18:55 (4th after the Focus) → batch your Editor needs into that one turn')
  const tree = await pane($, w)
  expect(text(find(tree, 'hai-queue-head'))).toBe('EDITOR· FOCUS lane-cccccccc until 16:40 · the bird lands')
  expect((find(tree, 'hai-queue-focus-ctl')?.children ?? []).map(c => [(c as Tree).props?.label, (c as Tree).props?.hotkey])).toEqual([['End focus', 'e'], ['+30 min', '3'], ['+60 min', '6']])
  expect(text(find(tree, `hai-queue-${ME8}-line`))).toBe('waiting 21 min · 30 min · after the Focus · starts ~18:55')
  await run($, 'focus +5')
  await w.clock.advance(MIN)
  expect(await git($)).not.toContain('your turn is expected') // moved 5 min: not told
  await $.ui.press({ plugin: 'a5r', key: 'hai-queue-focus-ctl-add30', surface: 'terminal' }) // the panel's +30: the person's, like his command
  await w.clock.advance(MIN)
  expect(await git($)).toContain('your turn is expected about 19:30 (4th after the Focus)')
  await run($, 'focus end')
  await w.clock.advance(MIN)
  expect(await git($)).toContain("A5R · Editor — lane-cccccccc's Focus ended at 14:43; the queue runs on in its order: your turn is expected about 17:44 (5th in the queue)")
  expect(await git($)).not.toContain('your turn is expected') // once
})

test('A119: unit: the notices of one minute: the told value is read back from the ids (a reload does not tell again)', () => {
  const f = focusOf('cccccccc')
  const files = [file('cccccccc', { want: want({ requestedAt: NOW - 60 * MIN }) }), file(ME8, { want: want({ requestedAt: NOW - 10 * MIN }) })]
  const notices = (told: string[]) => focusNotices(f, { ...input(ME8, files, { focus: leaseOf(f) }), holds: false, told, titleOf: () => '' })
  const first = notices([])
  expect(first.map(n => n.id)).toEqual([`editor:focus-plan:${NOW}:${NOW + 120 * MIN}`])
  expect(notices(first.map(n => n.id))).toEqual([])
  expect(notices([`editor:focus-plan:${NOW}:${NOW + 100 * MIN}`]).map(n => n.id)).toEqual([`editor:focus-plan:${NOW}:${NOW + 120 * MIN}`]) // 20 min apart
  expect(notices([`editor:focus-plan:${NOW}:${NOW + 110 * MIN}`])).toEqual([])
})

// ---------- the Fable adversary review of rev 41 ----------
test('Fable review D1: after the Focus ends a queued session is told its start once, not every 15 min as a start counted from now drifts', () => {
  const f = focusOf('cccccccc', { startedAt: NOW - 120 * MIN, endsAt: NOW + 60 * MIN, ended: { at: NOW - 5 * MIN, how: 'done', by: 'lane-cccccccc' } })
  const files = [file('cccccccc'), file('aaaaaaaa', { want: want({ minutes: 45, pie: true, requestedAt: NOW - 90 * MIN }) }), file('bbbbbbbb', { want: want({ requestedAt: NOW - 80 * MIN }) })]
  const told: string[] = []
  for (let m = 0; m <= 60; m += 1) {
    const now = NOW + m * MIN
    for (const n of focusNotices(f, { ...input('bbbbbbbb', files, { now, probe: probe(10), focus: focusLease(f, now) }), holds: false, told, titleOf: () => '' })) if (!told.includes(n.id)) told.push(n.id)
  }
  expect(told).toEqual([`editor:focus-plan:${NOW - 120 * MIN}:after`])
})

test('Fable review D2: a focus session that held a launch:false pass slot launches and keeps the Editor: no launch:false, no sync slot, no pass', opts(), async ($, on) => {
  const fl = leaseOf(focusOf(ME8))
  const w0 = focusWant(fl, NOW, want({ launch: false, sync: { at: NOW + 60 * MIN, role: 'holder' }, minutes: 25 }))
  expect([w0.launch, w0.sync, w0.build, w0.pausable, w0.focus]).toEqual([undefined, undefined, true, false, NOW])
  const w = world(on, { ram: '40' })
  w.put(LOCK, held(ME8, 'tail-vfx', NOW - 5 * MIN, NOW + 25 * MIN))
  w.put(`${HF}/editor/${ME8}.json`, meFile({ want: want({ launch: false, build: true, requestedAt: NOW - 10 * MIN }), holding: { since: NOW - 5 * MIN, end: NOW + 25 * MIN, extended: 0, pass: 'dddddddd' } }))
  w.put(`${HF}/editor/dddddddd.json`, peer('dddddddd', { want: want({ pie: true, requestedAt: NOW - 60 * MIN }) }))
  w.put(FOCUS, JSON.stringify(focusOf(ME8, { lane: 'tail-vfx' })))
  await $.session.start(START)
  await git($)
  const mine = mineFile(w)
  expect([mine.want?.launch, mine.holding?.pass, lockOf(w).end]).toEqual([undefined, undefined, '16:40'])
  expect(refused(await $.tool.call({ tool: 'Bash', command: '"D:/UE/UnrealEditor.exe" E:/s2/S2.uproject' } as never))).toBeUndefined() // a launch is no longer a pass slot's refusal
})

test('Fable review D3: the person\'s launcher scripts (the editorLaunchers option, none by default) are launches; MSBuild of a .sln is a build, of the shared checkout\'s refused', () => {
  const launchers = launchersOf('Launch_S2.ps1, lab.py')
  expect(launchers).toEqual(['launch_s2.ps1', 'lab.py'])
  expect(['powershell -File E:/s2/docs/handoff/pie-perf-tools/launch_s2.ps1', '& E:/s2/tools/launch_s2.ps1 -Map L_TALab', 'python E:/s2/tools/lab.py --scenario x', 'cat E:/s2/tools/launch_s2.ps1'].map(c => editorShellAct(c, launchers))).toEqual(['launch', 'launch', 'launch', null])
  expect(editorShellAct('powershell -File E:/s2/docs/handoff/pie-perf-tools/launch_s2.ps1')).toBeNull() // no option: no script is named
  expect([isUnrealBuild('msbuild E:/s2/S2.sln /t:Build'), isUnrealBuild('MSBuild.exe D:/wt/s2-bird/S2.sln')]).toEqual([true, true])
  const f = leaseOf(focusOf('cccccccc'))
  const x = { sharedRoot: 'E:/s2', freeGb: 40, gateGb: 28 }
  expect(focusRefusal(f, { kind: 'build', projects: projectsOf('msbuild E:/s2/S2.sln /t:Build', 'E:/proj') }, x)?.why).toContain("uses the shared checkout's project")
  expect(focusRefusal(f, { kind: 'build', projects: projectsOf('msbuild D:/wt/s2-bird/S2.sln', 'E:/proj') }, x)).toBeNull()
  expect(focusRefusal(f, { kind: 'build', projects: ['E:/s2/wt/bird/S2.uproject'] }, x)).toBeNull() // a worktree inside the checkout folder is its own
})

test('Fable review S3: unit: a Focus lease lapses after its box (or the person\'s end and grace) like any lease, though its holder\'s file and note still mark a build lease', () => {
  const f = focusOf('cccccccc', { startedAt: NOW - 180 * MIN, endsAt: NOW - 30 * MIN })
  const real = focusWant(leaseOf(f, NOW - 100 * MIN), NOW - 100 * MIN, null) // the focus session's own file, as A5R writes it
  const lock = parseLockLine(`${heldLine({ lane: 'lane-cccccccc', sessionName: 'lane-cccccccc', id8: 'cccccccc', since: NOW - 180 * MIN, pid: null, end: NOW - 30 * MIN, mode: real.mode, pausable: real.pausable, nextSafe: real.nextSafe, note: `${real.what} (build)` })}\n`)
  const gone = { ...file('cccccccc', { want: real, holding: { since: NOW - 180 * MIN, end: NOW - 30 * MIN, extended: 0 }, lastTurnAt: NOW - 200 * MIN }), heartbeatAt: NOW - 120 * MIN }
  const waiter = file('dddddddd', { want: want() })
  const at = (now: number, focus: FocusLease | null, procs: Probe['procs'] = []) => lapseOf({ lock, files: [gone, waiter], lanes: [], now, probe: { ...probe(40), procs }, waiting: [waiter], sync: null, focus })
  expect(at(NOW, focusLease(f, NOW))?.kind).toBe('lapsed') // 30 min past the box end, its session gone, nothing running
  expect(at(NOW, null, [{ name: 'UnrealBuildTool', pid: 9, gb: 1, parentAlive: true }])).toBeNull() // a real build still holds it
  const ended = { ...f, endsAt: NOW + 60 * MIN, ended: { at: NOW - 30 * MIN, how: 'ended' as const, by: 'p' } }
  expect(at(NOW, focusLease(ended, NOW))?.kind).toBe('lapsed') // the person's end 30 min ago: its grace and the 10 min passed
})

test('Fable review S3: a live focus session past its box keeps its lock but it is an ordinary lease again; the person frees it past its end (rule=manual, the holder told)', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held(ME8, 'tail-vfx', NOW - 150 * MIN, NOW + 5 * MIN))
  w.put(`${HF}/editor/${ME8}.json`, meFile({ want: focusWant(leaseOf(focusOf(ME8, { startedAt: NOW - 150 * MIN, endsAt: NOW + 5 * MIN })), NOW - 150 * MIN, null), holding: { since: NOW - 150 * MIN, end: NOW + 5 * MIN, extended: 0 } }))
  w.put(FOCUS, JSON.stringify(focusOf(ME8, { lane: 'tail-vfx', startedAt: NOW - 150 * MIN, endsAt: NOW + 5 * MIN })))
  await $.session.start(START)
  await git($)
  expect(await run($, 'editor release tail-vfx')).toContain('holds the Editor for a Focus until 14:45')
  await w.clock.advance(6 * MIN)
  expect([mineFile(w).want?.build, mineFile(w).want?.focus, lockOf(w).note.includes('(build)'), lockOf(w).id8]).toEqual([false, undefined, false, ME8])
  expect(await run($, 'editor release tail-vfx', { kind: 'plugin', name: 'x' })).toContain('only the person changes the Editor queue')
  expect(await run($, 'editor release tail-vfx')).toContain("Tail's lock is free (its lease ended at 14:45), released by the person (command in tail-vfx)")
  expect(lockOf(w).kind).toBe('free')
  expect(w.read(LOG)).toContain('| rule=manual |')
  await w.clock.advance(MIN)
  expect(await told($, w)).toContain('A5R · Editor lease — your lease (12:10–14:45) was past its end, so the person (command in tail-vfx) freed the lock at 14:46')
})

// ---------- A120: the others around the focus Editor ----------
test('A120: unit: what another session may not do while a Focus runs, each with its alternative; builds and headless runs of another project fit when memory allows', () => {
  const f = leaseOf(focusOf('cccccccc'))
  const x = { sharedRoot: 'E:/s2', freeGb: 40, gateGb: 28 }
  expect(focusRefusal(f, { kind: 'drive' }, x)?.why).toBe('lane-cccccccc has the Editor for a Focus until 16:40: Unreal MCP writes, PIE and stops are its alone')
  expect(focusRefusal(f, { kind: 'launch' }, x)?.why).toContain('a second Unreal Editor beside it would take the memory it needs')
  expect(focusRefusal(f, { kind: 'build', projects: ['E:/s2/S2.uproject'] }, x)?.why).toContain("uses the shared checkout's project, whose binaries the focus Editor loads")
  expect(focusRefusal(f, { kind: 'build', projects: [] }, x)?.why).toContain("names no .uproject or .sln, so it is taken for the shared checkout's project")
  expect(focusRefusal(f, { kind: 'headless', projects: ['e:\\s2\\S2.uproject'] }, x)?.next).toContain("run it in your own worktree and name that worktree's .uproject")
  expect(focusRefusal(f, { kind: 'build', projects: ['D:/wt/s2-bird/S2.uproject'] }, x)).toBeNull()
  expect(focusRefusal(f, { kind: 'headless', projects: ['D:/wt/s2-bird/S2.uproject'] }, { ...x, freeGb: 20 })?.why).toContain('free RAM is 20 GB, under the 28 GB no-PIE launch gate')
  expect(focusRefusal(f, { kind: 'build', projects: ['D:/wt/s2-bird/S2.uproject'] }, { ...x, freeGb: null })?.next).toContain('read free RAM with')
  expect([isUnrealBuild('"D:/E/Engine/Build/BatchFiles/Build.bat" S2Editor Win64 Development -project=E:/s2/S2.uproject'), isUnrealBuild('dotnet D:/E/Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.dll S2Editor'), isUnrealBuild('RunUAT.bat BuildCookRun'), isUnrealBuild('npm run build'), isUnrealBuild('cat Build.bat')]).toEqual([true, true, true, false, false])
  expect(projectsOf("Start-Process D:/E/UnrealEditor-Cmd.exe -ArgumentList '\"E:/s2/S2.uproject\" -ExecCmds=\"Automation RunTests X;Quit\"'", 'E:/proj')).toEqual(['E:/s2/S2.uproject'])
  expect(projectsOf('Build.bat S2Editor Win64 Development -Project="..\\wt\\S2.uproject"', 'D:/x/y')).toEqual(['D:/x/wt/S2.uproject'])
  expect(writesPersonFile('python -c "open(\'E:/s2/Saved/A5R/editor-focus.json\',\'w\')"')).toBe(true)
})

test('A120: while a Focus runs another session is refused Editor launches, shared-project builds and headless runs, MCP writes and PIE, and edits in the focus files; MCP reads, worktree builds and other edits run', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held('cccccccc', 'lane-cccccccc', NOW - 10 * MIN, NOW + 110 * MIN))
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc', { holding: { since: NOW - 10 * MIN, end: NOW + 110 * MIN, extended: 0 } }))
  w.put(`${HF}/touch/cccccccc.json`, JSON.stringify({ session: SID('cccccccc'), id8: 'cccccccc', lane: 'lane-cccccccc', paths: ['Source/S2/Bird/BirdWing.cpp'], updatedAt: NOW }))
  w.put('E:/s2/.git/HEAD', 'ref: refs/heads/main') // the shared checkout's own tree
  w.put('E:/s2/wt/bird/.git', 'gitdir: E:/s2/.git/worktrees/bird') // a worktree of its own, inside the checkout folder
  w.put(FOCUS, JSON.stringify(focusOf('cccccccc', { startedAt: NOW - 10 * MIN, endsAt: NOW + 110 * MIN })))
  w.put(`${HF}/editor/${ME8}.json`, meFile())
  await $.session.start(START)
  await git($)
  const deny = async (call: Rec) => refused(await $.tool.call(call as never))
  expect(await deny({ tool: 'PowerShell', command: 'Start-Process "D:/E/Engine/Binaries/Win64/UnrealEditor.exe" -ArgumentList "D:/wt/s2-bird/S2.uproject"' })).toBe('A5R · Focus — lane-cccccccc has the Editor for a Focus until 16:30: a second Unreal Editor beside it would take the memory it needs → run headless tests or builds in your own worktree (name its .uproject); meanwhile edit on disk outside its files, build and test in your own worktree, read the Editor through MCP reads; your turn comes after the Focus')
  expect(await deny({ tool: 'Bash', command: '"D:/E/Engine/Binaries/Win64/UnrealEditor-Cmd.exe" E:/s2/S2.uproject -ExecCmds="Automation RunTests S2;Quit"' })).toContain("this headless Unreal run uses the shared checkout's project")
  expect(await deny({ tool: 'Bash', command: '"D:/E/Engine/Build/BatchFiles/Build.bat" S2Editor Win64 Development -project=E:/s2/S2.uproject -WaitMutex' })).toContain('whose binaries the focus Editor loads → run it in your own worktree')
  expect(await deny({ tool: 'Bash', command: '"D:/E/Engine/Build/BatchFiles/Build.bat" S2Editor Win64 Development' })).toContain('names no .uproject')
  expect(await deny({ tool: 'mcp__unreal-mcp__call_tool', method: 'set_actor_property', arguments: {} })).toContain('A5R · Focus — lane-cccccccc has the Editor for a Focus until 16:30: Unreal MCP writes, PIE and stops are its alone')
  expect(await deny({ tool: 'mcp__unreal-mcp__call_tool', name: 'McpPieToolset.StartPIE' })).toContain('Unreal MCP writes, PIE and stops are its alone')
  expect(await deny({ tool: 'Bash', command: 'taskkill /IM UnrealEditor.exe /F' })).toContain('A5R · Focus')
  expect(await deny({ tool: 'mcp__unreal-mcp__call_tool', name: 'get_actors_in_level' })).toBeUndefined()
  expect(await deny({ tool: 'Bash', command: '"D:/E/Engine/Build/BatchFiles/Build.bat" S2Editor Win64 Development -project=D:/wt/s2-bird/S2.uproject' })).toBeUndefined()
  expect(await deny({ tool: 'Edit', file_path: 'E:/s2/Source/S2/Bird/BirdWing.cpp', old_string: 'a', new_string: 'b' })).toBe('A5R · Focus — Source/S2/Bird/BirdWing.cpp is one of the files lane-cccccccc edits in its Focus (until 16:30) → leave it until the Focus ends, or make your change in your own worktree and merge it after')
  expect(await deny({ tool: 'Edit', file_path: 'E:/s2/Source/S2/Bird/BirdTail.cpp', old_string: 'a', new_string: 'b' })).toBeUndefined()
  expect(await deny({ tool: 'Edit', file_path: 'E:/s2/wt/bird/Source/S2/Bird/BirdWing.cpp', old_string: 'a', new_string: 'b' })).toBeUndefined() // its own copy
  // Free RAM under the no-PIE gate: a worktree build waits.
  w.machine.ram = '20'
  await w.clock.advance(MIN)
  expect(await deny({ tool: 'Bash', command: '"D:/E/Engine/Build/BatchFiles/Build.bat" S2Editor Win64 Development -project=D:/wt/s2-bird/S2.uproject' })).toContain('free RAM is 20 GB, under the 28 GB no-PIE launch gate')
})

test('A120: the focus session itself, and a holder that still finishes its lease from before the start, are not refused', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held(ME8, 'tail-vfx', NOW - 30 * MIN, NOW + 15 * MIN))
  w.put(`${HF}/editor/${ME8}.json`, meFile({ want: want({ requestedAt: NOW - 40 * MIN }), holding: { since: NOW - 30 * MIN, end: NOW + 15 * MIN, extended: 0 } }))
  w.put(`${HF}/editor/cccccccc.json`, peer('cccccccc'))
  w.put(FOCUS, JSON.stringify(focusOf('cccccccc')))
  await $.session.start(START)
  expect(await told($, w)).toContain('A5R · Focus — the person gave lane-cccccccc the Editor for a Focus until 16:40 → finish to a checkpoint (PIE stopped, your own assets saved) and release with the editor tool within 10 min; your next request keeps its place')
  expect(refused(await $.tool.call({ tool: 'mcp__unreal-mcp__call_tool', method: 'save_asset', arguments: {} } as never))).toBeUndefined()
  // Its release is forced by the Focus: the record says so and its next request keeps its place (A104).
  await $.tool.call({ tool: EDITOR, action: 'release' } as never)
  const rec = JSON.parse(w.read(`${HF}/leases.jsonl`).trim().split('\n').pop() ?? '{}') as Rec
  expect(rec.endReason).toBe('focus')
  expect(mineFile(w).return?.requestedAt).toBe(NOW - 40 * MIN)
})
