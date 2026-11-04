import { expect, test } from 'claude-code/testing'
import { DEFAULT_GATES, NO_MANUAL, blankSession, decide, heldLine, mayAskYield, newSync, parseLockLine, queueOf, type GrantInput, type SessionFile, type Want } from '../hooks/coord.ts'
import { applyOrder, parseEditorCommand, NO_ORDER } from '../hooks/order.ts'
import { editorPanel } from '../hooks/panel.ts'
import { staleWants } from '../hooks/truth.ts'
import { conductor, type WakeIo } from '../hooks/wakehost.ts'
import { WAKE_ANSWER_MS, afterMiss, answered, conductorOf, deskDir, idleLine, isFinished, mayConduct, nextIdle, NO_IDLE, NO_WAKE, nightLine, nightOf, parseDeskRow, pausedCause, readSend, sendInput, turnToStart, workFits, workPool } from '../hooks/wake.ts'
import { parseTail } from '../hooks/judge.ts'
import { A5RPANE, ENV, LOCK, ME, NOW, PANE, PROJ, atherTree, find, opts, refused, text, world } from './world.ts'

// Rev 45 (L-49, L-50): A135 a stopped session keeps its place, A136 started when its turn comes, A137 what else it waits on,
// A138 how a session is reached, A139 Hai can see it, A140 the conductor, A141 the alarm. MEASURED 2026-11-03: the Editor free
// from 23:34 to 09:30, the queue empty because A125 withdrew requests whose last words were "I'm queued".
const HF = 'E:/s2/Saved/A5R'
const RECORDS = 'C:/Users/hai.huynh/.claude/projects/E--s2'
const ME8 = ME.slice(0, 8)
const MIN = 60_000
const H = 60 * MIN
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const DESK = `${ENV.APPDATA}/Claude/claude-code-sessions/${ENV.CLAUDE_CODE_ACCOUNT_UUID}/${ENV.CLAUDE_CODE_ORGANIZATION_UUID}`
const FREE = 'FREE since=14:30 2026-10-06 by=lane-bbbbbbbb note=done background=none · free since 14:30\n'
const held = (id8: string, since: number, end: number) => `${heldLine({ lane: `lane-${id8}`, sessionName: `title-${id8}`, id8, since, pid: null, end, mode: 'interactive', pausable: true, nextSafe: 'after save', note: 'their slot' })}\n`
const want = (o: Partial<Want> = {}): Want => ({ minutes: 30, pie: false, build: false, what: 'mc jump test', mode: 'unattended', pausable: true, nextSafe: 'after save', requestedAt: NOW - 3 * H, ...o })
const file = (id8: string, o: Partial<SessionFile> = {}): SessionFile => ({ ...blankSession(SID(id8), `lane-${id8}`, `title ${id8}`, NOW), ...o })
/** A session whose process is gone: its last heartbeat long ago. */
const stoppedFile = (id8: string, o: Partial<SessionFile> = {}): SessionFile => file(id8, { heartbeatAt: NOW - 3 * H, lastTurnAt: NOW - 3 * H, canPass: undefined, conducts: undefined, ...o })
const put = (w: ReturnType<typeof world>, f: SessionFile) => w.put(`${HF}/editor/${f.id8}.json`, JSON.stringify(f))
const desk = (w: ReturnType<typeof world>, id8: string, local = `local_${id8}`, o: Record<string, unknown> = {}) => w.put(`${DESK}/${local}.json`, JSON.stringify({ sessionId: local, cliSessionId: SID(id8), title: `title ${id8}`, isArchived: false, ...o }))
const stopped = (w: ReturnType<typeof world>, id8: string, o: Partial<SessionFile> = {}) => {
  put(w, stoppedFile(id8, { want: want(), ...o }))
  desk(w, id8)
}
const fileOf = (w: ReturnType<typeof world>, id8: string) => JSON.parse(w.read(`${HF}/editor/${id8}.json`)) as SessionFile
const sends = (w: ReturnType<typeof world>) => w.seen.filter(e => e.tool === 'SendMessage') as { to: string; message: string }[]
const LOG = `${HF}/orchestrate.log`
const SENT = JSON.stringify({ success: true, message: 'Forwarded to Claude Desktop\'s session messaging' })
const REFUSED = JSON.stringify({ success: false, message: 'Not delivered to Claude Desktop session' })
const PAUSED = JSON.stringify({ success: false, message: 'Not delivered: this session has already messaged Claude Desktop sessions 8 times since your user last typed here, which looks like sessions messaging each other automatically. Paused until your user\'s next message in this session.' })
const said = (text: string) => JSON.stringify({ type: 'assistant', timestamp: new Date(NOW - 60 * MIN).toISOString(), message: { role: 'assistant', content: [{ type: 'text', text }] } })
const QUEUED_WORDS = 'I am queued at #2 for the Editor: the next step is the jump test in PIE.'
const grant = (files: SessionFile[], o: Partial<GrantInput> = {}): GrantInput => ({ me8: ME8, lock: parseLockLine(FREE), files, lanes: [], now: NOW, sync: null, probe: { freeGb: 40, diskGb: 100, procs: [] }, gates: DEFAULT_GATES, manual: NO_MANUAL, focus: null, ...o })
const NONE: ReadonlySet<string> = new Set()
const KEEP = (): boolean => false
/** The engine beneath the host itself, for what the test engine cannot show. */
const fakeIo = (disk: Map<string, string>, o: Record<string, unknown> = {}): WakeIo => ({ now: async () => NOW, read: async (p: string) => disk.get(p) ?? null, write: async (p: string, t: string) => void disk.set(p, t), stat: async () => null, list: async () => [], run: async () => null, call: async () => null, deskPlace: async () => ({}), writeChecked: async (p: string, _e: string | null, t: string) => (disk.set(p, t), true), claimAlert: async () => true, log: async () => undefined, notify: async () => false, toast: () => undefined, events: async () => [], nudgedAt: async () => 0, nudge: async () => undefined, isGitFree: async () => true, heldNeeds: async () => new Set(), ...o }) as never
const beat = (w: ReturnType<typeof world>, id8: string) => put(w, { ...fileOf(w, id8), heartbeatAt: w.clock.now() + 1 })

// ---------- A135 ----------
test('A135: unit: a stopped request stays in the queue past 2 h, in its place; 48 h, an archived session or a sync slot leave', () => {
  const a = stoppedFile('aaaaaaaa', { want: want({ requestedAt: NOW - 5 * H }) })
  const b = file('bbbbbbbb', { want: want({ requestedAt: NOW - 9 * MIN }) })
  expect(queueOf([b, a], [], NOW, null, NO_MANUAL).map(f => f.id8)).toEqual(['aaaaaaaa', 'bbbbbbbb'])
  const old = stoppedFile('cccccccc', { want: want({ requestedAt: NOW - 48 * H }) })
  expect(queueOf([b, old], [], NOW, null, NO_MANUAL).map(f => f.id8)).toEqual(['bbbbbbbb'])
  expect(staleWants([a], [], NOW, new Set())).toEqual([])
  expect(staleWants([old], [], NOW, new Set()).map(s => [s.f.id8, s.why])).toEqual([['cccccccc', 'asked 48 h ago or more']])
  expect(staleWants([a], [], NOW, new Set(['aaaaaaaa'])).map(s => s.why)).toEqual(['its session is archived'])
  const slot = stoppedFile('dddddddd', { want: want({ sync: { at: NOW, role: 'worker' } }) })
  expect(staleWants([slot], [], NOW, new Set()).map(s => s.f.id8)).toEqual(['dddddddd'])
  expect(staleWants([{ ...slot, heartbeatAt: NOW - 90 * MIN, lastTurnAt: NOW - 90 * MIN }], [], NOW, new Set())).toEqual([])
  expect(staleWants([file('eeeeeeee', { want: want({ requestedAt: NOW - 49 * H }) })], [], NOW, new Set())).toEqual([]) // alive: never
})

test('A135: a stopped request stays through 2 h with the Editor held; the 48 h limit drops it, logged', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held('dddddddd', NOW, NOW + 100 * H))
  put(w, file('dddddddd', { heartbeatAt: NOW + 100 * H, holding: { since: NOW, end: NOW + 100 * H, extended: 0 } }))
  stopped(w, 'cccccccc', { want: want({ requestedAt: NOW - 45.5 * H }) })
  await $.session.start(START)
  await w.clock.advance(2 * H)
  expect(fileOf(w, 'cccccccc').want).not.toBeNull() // past A125's old 2 h
  expect(w.read(LOG)).not.toContain('rule=withdrawn')
  await w.clock.advance(H)
  expect(fileOf(w, 'cccccccc').want).toBeNull()
  expect(fileOf(w, 'cccccccc').askedAt).toBe(NOW - 45.5 * H)
  expect(w.read(LOG)).toContain('| rule=withdrawn | lane=lane-cccccccc |')
  expect(w.read(LOG)).toContain('asked 48 h ago or more')
  expect(sends(w)).toEqual([]) // the Editor never came free: no send
})

test('A135: an archived session\'s request is dropped, logged', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held('dddddddd', NOW, NOW + 10 * H))
  put(w, file('dddddddd', { heartbeatAt: NOW + 10 * H, holding: { since: NOW, end: NOW + 10 * H, extended: 0 } }))
  stopped(w, 'cccccccc')
  desk(w, 'cccccccc', 'local_cccccccc', { isArchived: true })
  await $.session.start(START)
  await w.clock.advance(3 * MIN)
  expect(fileOf(w, 'cccccccc').want).toBeNull()
  expect(w.read(LOG)).toContain('its session is archived')
})

test('A135: the person removes a stopped session\'s request; a live session\'s is its own', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held('dddddddd', NOW, NOW + 10 * H))
  put(w, file('dddddddd', { heartbeatAt: NOW + 10 * H, holding: { since: NOW, end: NOW + 10 * H, extended: 0 } }))
  stopped(w, 'cccccccc')
  put(w, file('eeeeeeee', { heartbeatAt: NOW + 10 * H, want: want({ requestedAt: NOW - H }) }))
  await $.session.start(START)
  await w.clock.advance(MIN)
  const run = async (args: string) => String((await $.command.run({ command: 'a5r', args, origin: { kind: 'composer' } } as never)).text)
  expect(await run('editor remove lane-eeeeeeee')).toContain('is running, so its request is its own')
  expect(await run('editor remove lane-cccccccc')).toContain('request is removed')
  expect(fileOf(w, 'cccccccc').want).toBeNull()
  expect(parseEditorCommand('remove x')).toEqual({ kind: 'remove', who: { name: 'x' } })
  expect('refusal' in applyOrder(grant([file('ffffffff')]), NO_ORDER, { kind: 'remove', who: { id8: 'ffffffff' } }, { by: 'p', titleOf: () => '' })).toBe(true)
})

// ---------- A136 ----------
test('A136: the Editor free and a stopped head: one message with the slot and its end; the lock stays free until it answers; it is not sent twice', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: SENT } })
  w.put(LOCK, FREE)
  stopped(w, 'cccccccc')
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(sends(w).map(s => s.to)).toEqual(['local_cccccccc'])
  expect(sends(w)[0]?.message).toContain('your turn has come: mc jump test (30 min)')
  expect(sends(w)[0]?.message).toContain('Your lease starts when this session answers and ends about 15:1')
  expect(sends(w)[0]?.message).toContain('request again if you no longer need it')
  expect(w.read(LOCK)).toBe(FREE) // A stopped session's lease does not count down before it answers: there is none
  expect(fileOf(w, 'cccccccc').holding).toBeNull()
  await w.clock.advance(3 * MIN)
  expect(sends(w).length).toBe(1)
  expect(w.read(LOG)).toContain('| rule=woke | lane=lane-cccccccc |')
  beat(w, 'cccccccc')
  await w.clock.advance(MIN)
  expect(w.read(LOG)).toMatch(/rule=woke \| lane=lane-cccccccc .*turn: answered/)
})

test('A136: a stopped session that comes back takes the lock itself: its lease starts at its own first minute', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, FREE)
  put(w, { ...file(ME8, { session: ME, want: want({ requestedAt: NOW - 5 * H }) }), heartbeatAt: NOW - 5 * H })
  await $.session.start(START)
  await w.clock.advance(MIN)
  const lock = parseLockLine(w.read(LOCK))
  expect(lock.id8).toBe(ME8)
  expect(fileOf(w, ME8).holding?.since).toBeGreaterThan(NOW - 1)
})

test('A136: no answer in 5 min moves it behind the next, once; a second miss withdraws it, logged', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: SENT } })
  w.put(LOCK, FREE)
  stopped(w, 'cccccccc', { want: want({ requestedAt: NOW - 4 * H }) })
  stopped(w, 'dddddddd', { want: want({ requestedAt: NOW - 3 * H }) })
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(sends(w).map(s => s.to)).toEqual(['local_cccccccc'])
  await w.clock.advance(WAKE_ANSWER_MS)
  expect(fileOf(w, 'cccccccc').want?.misses).toBe(1)
  expect(fileOf(w, 'cccccccc').want?.requestedAt).toBe(NOW - 4 * H) // its clock and the person's entries stand
  expect(w.read(LOG)).toMatch(/lane=lane-cccccccc .*turn: no-answer/)
  await w.clock.advance(MIN)
  expect(sends(w).map(s => s.to)).toEqual(['local_cccccccc', 'local_dddddddd']) // one at a time, the next one now
  put(w, { ...fileOf(w, 'dddddddd'), want: null }) // it took its turn
  await w.clock.advance(WAKE_ANSWER_MS + MIN)
  expect(sends(w).map(s => s.to)).toEqual(['local_cccccccc', 'local_dddddddd', 'local_cccccccc'])
  await w.clock.advance(WAKE_ANSWER_MS + MIN)
  expect(fileOf(w, 'cccccccc').want).toBeNull()
  expect(w.read(LOG)).toMatch(/rule=withdrawn \| lane=lane-cccccccc .*started twice with no answer/)
})

test('A136: unit: a miss goes back behind the next once; a second withdraws; a loop pause never withdraws', () => {
  const w = want({ requestedAt: 5 })
  expect(afterMiss(w, true)).toEqual({ ...w, misses: 1, movedBack: true })
  expect(afterMiss({ ...w, misses: 1 }, true)).toBeNull()
  expect(afterMiss(w, false)).toEqual({ ...w, movedBack: true })
  const once = { ...w, movedBack: true as const }
  expect(afterMiss(once, false)).toBe(once)
})

test('A136: two stopped requests start one at a time, in queue order', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: SENT } })
  w.put(LOCK, FREE)
  stopped(w, 'cccccccc', { want: want({ requestedAt: NOW - 4 * H }) })
  stopped(w, 'dddddddd', { want: want({ requestedAt: NOW - 3 * H }) })
  await $.session.start(START)
  await w.clock.advance(4 * MIN)
  expect(sends(w).map(s => s.to)).toEqual(['local_cccccccc'])
})

test('A136: a request waiting only for memory is not started; a Focus and a freeze hold it too', () => {
  const head = stoppedFile('cccccccc', { want: want() })
  expect(turnToStart(grant([head]), KEEP)?.id8).toBe('cccccccc')
  expect(turnToStart(grant([head], { probe: { freeGb: 5, diskGb: 100, procs: [] } }), KEEP)).toBeNull()
  expect(turnToStart(grant([head], { focus: { id8: 'dddddddd', lane: 'd', end: NOW + H, isRunning: true } as never }), KEEP)).toBeNull()
  expect(turnToStart(grant([head], { sync: newSync(NOW + 5 * MIN, { session: 'x', id8: 'eeeeeeee', lane: 'e' }, 'e', NOW - H) }), KEEP)).toBeNull()
  expect(turnToStart(grant([head], { lock: parseLockLine(held('dddddddd', NOW, NOW + H)) }), KEEP)).toBeNull()
  const live = file('bbbbbbbb', { want: want({ requestedAt: NOW - 9 * H }) })
  expect(turnToStart(grant([head, live]), KEEP)).toBeNull() // a live head takes it itself
})

test('A136: a live session behind a stopped head waits for its start; a stopped head memory holds back lets the next fit go first', () => {
  const head = stoppedFile('cccccccc', { want: want() })
  const me = file(ME8, { want: want({ requestedAt: NOW - H }) })
  expect(decide(grant([head, me]))).toMatchObject({ kind: 'wait', code: 'queue' })
  const passer = stoppedFile('dddddddd', { want: want({ requestedAt: NOW - 2 * H, pie: false, launch: false }) })
  const pie = stoppedFile('cccccccc', { want: want({ pie: true }) })
  expect(turnToStart(grant([pie, passer], { probe: { freeGb: 30, diskGb: 100, procs: [] } }), KEEP)?.id8).toBe('dddddddd') // its slot fits
  expect(decide(grant([pie, passer, me], { probe: { freeGb: 30, diskGb: 100, procs: [] } }))).toMatchObject({ kind: 'wait', code: 'queue' }) // and the live one behind it waits for that start
})

test('A136: a refused send never touches the lease: it is logged, and the heartbeat decides', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: REFUSED } })
  w.put(LOCK, FREE)
  stopped(w, 'cccccccc')
  const before = fileOf(w, 'cccccccc')
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(w.read(LOG)).toContain('the send reported "Not delivered to Claude Desktop session", waiting for its heartbeat anyway')
  expect(w.read(LOCK)).toBe(FREE)
  expect(fileOf(w, 'cccccccc')).toEqual(before)
  beat(w, 'cccccccc') // MEASURED: a send that reported no start did start the session
  await w.clock.advance(MIN)
  expect(w.read(LOG)).toMatch(/turn: answered/)
  expect(fileOf(w, 'cccccccc').want?.misses).toBeUndefined()
})

test('A136: a send that throws is caught: the tick goes on and the lease is untouched', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  on('tool.call', { tool: 'SendMessage' } as never, async () => {
    throw new Error('boom')
  })
  w.put(LOCK, FREE)
  stopped(w, 'cccccccc')
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(w.read(LOCK)).toBe(FREE)
  expect(w.read(LOG)).toContain('the send reported')
})

test('A136: the engine\'s loop guard: logged as loop-paused, a miss, no retry until the next window, the alarm says what lifts it; never withdrawn', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: PAUSED } })
  w.put(LOCK, FREE)
  stopped(w, 'cccccccc')
  put(w, { ...fileOf(w, 'cccccccc') })
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(sends(w).length).toBe(1)
  expect(w.read(LOG)).toMatch(/rule=woke \| lane=lane-cccccccc .*loop-paused/)
  expect(fileOf(w, 'cccccccc').want?.movedBack).toBe(true)
  const toasts = () => ((w.calls['ui.toast'] ?? []) as { text?: string }[]).map(t => String(t.text ?? t))
  const alarms = () => w.read(LOG).split('\n').filter(l => l.includes('rule=idle-with-work'))
  expect(alarms().length).toBe(1)
  expect(alarms()[0]).toContain('paused till you type in') // orchestrate.log's own wording rule turns until into till
  expect(toasts().some(t => t.includes(pausedCause('3️⃣ Loco fix')))).toBe(true) // the person reads the exact words
  await w.clock.advance(3 * MIN)
  expect(sends(w).length).toBe(1) // inside the window: no retry
  await w.clock.advance(17 * MIN)
  expect(sends(w).length).toBeGreaterThan(1) // tried again at the next window, once
  expect(sends(w).length).toBeLessThan(5)
  expect(fileOf(w, 'cccccccc').want).not.toBeNull()
  expect(alarms().length).toBe(1)
})

// ---------- A137 ----------
test('A137: a stopped session refused git is started once when the turn frees, in order; one with no refusal is not', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: SENT } })
  w.put(LOCK, held('zzzzzzzz', NOW, NOW + 10 * H))
  put(w, file('zzzzzzzz', { heartbeatAt: NOW + 10 * H, holding: { since: NOW, end: NOW + 10 * H, extended: 0 } }))
  const r = (id8: string, at: number) => w.put(`${HF}/refused/${id8}.json`, JSON.stringify({ v: 1, id8, kind: 'git', at, what: 'the git turn' }))
  for (const id8 of ['cccccccc', 'dddddddd', 'eeeeeeee']) {
    put(w, stoppedFile(id8))
    desk(w, id8)
  }
  r('dddddddd', NOW - 2 * H)
  r('cccccccc', NOW - H)
  w.put(`${HF}/git-turn/yyyyyyyy.json`, JSON.stringify({ v: 1, session: SID('yyyyyyyy'), id8: 'yyyyyyyy', lane: 'lane-y', command: 'git commit', startedAt: NOW }))
  put(w, file('yyyyyyyy', { heartbeatAt: NOW + 10 * H }))
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(sends(w)).toEqual([]) // the turn is held
  w.put(`${HF}/git-turn/yyyyyyyy.json`, 'null')
  await w.clock.advance(MIN)
  expect(sends(w).map(s => s.to)).toEqual(['local_dddddddd'])
  expect(sends(w)[0]?.message).toContain('what refused you is free now')
  beat(w, 'dddddddd')
  await w.clock.advance(2 * MIN)
  expect(sends(w).map(s => s.to)).toEqual(['local_dddddddd', 'local_cccccccc'])
  beat(w, 'cccccccc')
  await w.clock.advance(10 * MIN)
  expect(sends(w).length).toBe(2) // once per refusal; eeeeeeee, with none, never
})

test('A137: a stopped session refused by the freeze is started when the step frees what it needed; never before', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: SENT } })
  w.put(LOCK, held('zzzzzzzz', NOW, NOW + 10 * H))
  put(w, file('zzzzzzzz', { heartbeatAt: NOW + 10 * H, holding: { since: NOW, end: NOW + 10 * H, extended: 0 } }))
  w.put(`${HF}/sync.json`, JSON.stringify(newSync(NOW - 5 * MIN, { session: SID('zzzzzzzz'), id8: 'zzzzzzzz', lane: 'lane-z' }, 'lane-z', NOW - H)))
  put(w, stoppedFile('cccccccc'))
  desk(w, 'cccccccc')
  w.put(`${HF}/refused/cccccccc.json`, JSON.stringify({ v: 1, id8: 'cccccccc', kind: 'freeze', at: NOW - MIN, what: 'build', needs: ['build'] }))
  await $.session.start(START)
  await w.clock.advance(2 * MIN)
  expect(sends(w)).toEqual([])
  w.put(`${HF}/sync.json`, 'null')
  await w.clock.advance(2 * MIN)
  expect(sends(w).map(s => s.to)).toEqual(['local_cccccccc'])
})

test('A137: this session\'s own refusal goes on file at once, and is cleared when it is free and it is alive', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  const S2 = 'E:/s2'
  w.put(`${S2}/.git/HEAD`, 'ref: refs/heads/x')
  w.put(LOCK, FREE)
  put(w, file('cccccccc', { heartbeatAt: NOW + 10 * H }))
  w.put(`${HF}/git-turn/cccccccc.json`, JSON.stringify({ v: 1, session: SID('cccccccc'), id8: 'cccccccc', lane: 'lane-c', command: 'git commit', startedAt: NOW }))
  await $.session.start(START)
  await w.clock.advance(MIN)
  w.put(`${HF}/git-turn/cccccccc.json`, JSON.stringify({ v: 1, session: SID('cccccccc'), id8: 'cccccccc', lane: 'lane-c', command: 'git commit', startedAt: NOW }), w.clock.now())
  expect(refused(await $.tool.call({ tool: 'Bash', command: `git -C ${S2} add -- tools/x.py` } as never))).toContain('git busy')
  expect(w.read(`${HF}/refused/${ME8}.json`)).toContain('"kind":"git"')
  w.put(`${HF}/git-turn/cccccccc.json`, 'null')
  await w.clock.advance(MIN)
  expect(w.read(`${HF}/refused/${ME8}.json`)).toBe('null')
})

// ---------- A138 ----------
test('A138: unit: the route: SendMessage with the desktop id; its three answers; the records and the folder', () => {
  expect(sendInput('local_x', 'hi')).toMatchObject({ tool: 'SendMessage', to: 'local_x', message: 'hi' })
  expect(readSend({ text: SENT })).toEqual({ kind: 'sent' })
  expect(readSend({ text: REFUSED }).kind).toBe('refused')
  expect(readSend({ text: PAUSED }).kind).toBe('loop-paused')
  expect(readSend({ deny: 'no' })).toEqual({ kind: 'refused', reason: 'no' })
  expect(readSend(null).kind).toBe('refused')
  expect(readSend({ text: 'not json' })).toEqual({ kind: 'refused', reason: 'not json' })
  expect(parseDeskRow(JSON.stringify({ sessionId: 'local_0784d41e', cliSessionId: 'C22562CA-x', title: 't' }))).toEqual({ local: 'local_0784d41e', cli: 'c22562ca-x', isArchived: false })
  expect(parseDeskRow('{}')).toBeNull()
  expect(deskDir('C:\\Users\\x\\AppData\\Roaming', 'a', 'o')).toBe('C:/Users/x/AppData/Roaming/Claude/claude-code-sessions/a/o')
  expect(deskDir(undefined, 'a', 'o')).toBeNull()
  expect(deskDir('C:/x', undefined, 'o')).toBeNull()
})

test('A138: the id comes from the desktop\'s records, which may differ from the CLI id', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: SENT } })
  w.put(LOCK, FREE)
  put(w, stoppedFile('c22562ca', { want: want() }))
  desk(w, 'c22562ca', 'local_0784d41e')
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(sends(w).map(s => s.to)).toEqual(['local_0784d41e'])
})

test('A138: with no desktop record (outside the desktop app) nothing is sent: logged, and it takes the miss path', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: SENT } })
  w.put(LOCK, FREE)
  put(w, stoppedFile('cccccccc', { want: want() }))
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(sends(w)).toEqual([])
  expect(w.read(LOG)).toContain('no desktop record for this session')
  await w.clock.advance(2 * MIN)
  expect(fileOf(w, 'cccccccc').want).toBeNull() // moved back once, then withdrawn: logged
  expect(w.read(LOG)).toContain('| rule=withdrawn | lane=lane-cccccccc |')
})

// ---------- A139 ----------
test('A139: the panel row and status.json mark a stopped request; the compact line counts them', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: SENT } })
  w.put(LOCK, held('dddddddd', NOW, NOW + 10 * H))
  put(w, file('dddddddd', { heartbeatAt: NOW + 10 * H, holding: { since: NOW, end: NOW + 10 * H, extended: 0 } }))
  stopped(w, 'cccccccc')
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start(START)
  await w.clock.advance(2 * MIN)
  const status = JSON.parse(w.read(`${HF}/status.json`))
  expect(status.editor.queue[0]).toMatchObject({ id8: 'cccccccc', stopped: true, waitsFor: 'stopped: will be started when its turn comes' })
  expect(status.wake.stopped).toBe(1)
  const pane = text(await $.ui.render(A5RPANE as never))
  expect(pane).toContain('stopped: will be started when its turn comes')
  await $.ui.render(PANE as never)
  expect(text(find(await $.ui.render(PANE as never), 'hai-a5r-line-editor'))).toContain('1 stopped')
})

test('A139: unit: the panel says when the Editor stood free 30 min with nobody queued; the night line names what ran and what was started', () => {
  const at = new Date(2026, 9, 7, 9, 30).getTime()
  const idle = { ...NO_IDLE, freeSince: at - 34 * MIN }
  expect(idleLine(idle, { now: at, queued: 0, isFree: true })).toBe('free 34 min, nobody queued')
  expect(idleLine(idle, { now: at, queued: 1, isFree: true })).toBe('')
  expect(idleLine({ ...idle, freeSince: at - 29 * MIN }, { now: at, queued: 0, isFree: true })).toBe('')
  expect(idleLine({ ...NO_IDLE, days: { '2026-10-07': 3 }, nights: { '2026-10-06': 12 } }, { now: at, queued: 0, isFree: false })).toBe('idle with work: 3 min today, 12 min last night')
  const night = new Date(2026, 9, 7, 1, 0).getTime()
  const lease = { lane: 'lane-a', id8: 'aaaaaaaa', grantedAt: night } as never
  const w = { ...NO_WAKE, recent: [{ at: night, id8: 'b', lane: 'lane-b', why: 'turn' as const, outcome: 'answered' as const }] }
  expect(nightLine(w, [lease], at)).toBe('Last night: ran lane-a; started lane-b (its turn, answered).')
  expect(nightLine(NO_WAKE, [], at)).toBe('')
  expect(nightLine(w, [lease], new Date(2026, 9, 8, 9, 0).getTime())).toBe('') // the night before that one
})

test('A139: unit: the panel\'s list carries the stopped mark and the wake line', () => {
  const app = { me8: ME8, meTitle: '', files: [], clients: [], isS2Cwd: () => false, names: new Map(), now: NOW } as never
  const summary = { leases: 0, inEditorMin: 0, waits: [], overruns: 0 } as never
  const p = editorPanel({ grant: grant([stoppedFile('cccccccc', { want: want() })]), app, phase: 'none' as never, summary, waits: new Map(), wakeLine: 'free 34 min, nobody queued' })
  expect(p.list.rows[0]?.isStopped).toBe(true)
  expect(p.list.today).toContain('free 34 min, nobody queued')
})

// ---------- A140 ----------
const worker = (w: ReturnType<typeof world>, id8: string, words: string, o: Partial<SessionFile> = {}) => {
  put(w, stoppedFile(id8, { askedAt: NOW - 5 * H, ...o }))
  desk(w, id8)
  w.put(`${RECORDS}/${SID(id8)}.jsonl`, said(words))
}

test('A140: a free Editor and a stopped session with work: it is started; it is not started again within 2 h', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: SENT } })
  w.put(LOCK, FREE)
  worker(w, 'cccccccc', QUEUED_WORDS)
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(sends(w).map(s => s.to)).toEqual(['local_cccccccc'])
  expect(sends(w)[0]?.message).toContain('the Editor is free')
  await w.clock.advance(H)
  expect(sends(w).length).toBe(1)
})

test('A140: "needs the person", "done" and "nothing pending" start nobody; nor no Editor sign in 24 h', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: SENT } })
  w.put(LOCK, FREE)
  worker(w, 'c1c1c1c1', 'This needs the person: Hai has to pick the clip.')
  worker(w, 'c2c2c2c2', 'All done, the PR is open.')
  worker(w, 'c3c3c3c3', 'There is nothing pending here.')
  worker(w, 'c4c4c4c4', 'Next is a PIE run of the jump.', { askedAt: NOW - 30 * H })
  await $.session.start(START)
  await w.clock.advance(5 * MIN)
  expect(sends(w)).toEqual([])
})

test('A140: two A5Rs start it once: a fresh conductor claim keeps this one out, and a spent claim file too', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: SENT } })
  w.put(LOCK, FREE)
  worker(w, 'cccccccc', QUEUED_WORDS)
  w.put(`${HF}/alerts/wake-work-cccccccc-${NOW - 3 * H}-0.json`, '{"by":"other"}')
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(sends(w)).toEqual([]) // the other A5R's claim stands
  expect(mayConduct(ME8, ME8, { id8: 'bbbbbbbb', at: NOW }, NOW + MIN)).toBe(false)
  expect(mayConduct(ME8, ME8, { id8: 'bbbbbbbb', at: NOW }, NOW + 3 * MIN)).toBe(true)
  expect(mayConduct(ME8, ME8, null, NOW)).toBe(true)
  expect(mayConduct(ME8, 'aaaaaaaa', null, NOW)).toBe(false)
  // The first live A5R that conducts, by id; one before 0.28.0, or a stopped one, is passed over.
  const f = (id8: string, o: Partial<SessionFile> = {}) => file(id8, o)
  expect(conductorOf([f('cccccccc'), f('bbbbbbbb'), f('aaaaaaaa', { conducts: undefined }), f('a0a0a0a0', { heartbeatAt: NOW - H })], NOW)).toBe('bbbbbbbb')
})

test('A140: this session, not first in the order, does not conduct', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: SENT } })
  w.put(LOCK, FREE)
  put(w, file('aaaaaaaa', { heartbeatAt: NOW + 10 * H, sends: true }))
  stopped(w, 'cccccccc')
  await $.session.start(START)
  await w.clock.advance(2 * MIN)
  expect(sends(w)).toEqual([])
})

test('A140: RAM, a Focus and a freeze hold the start of work', () => {
  const f = stoppedFile('cccccccc')
  expect(workFits(grant([f]), f)).toBe(true)
  expect(workFits(grant([f], { probe: { freeGb: 5, diskGb: 100, procs: [] } }), f)).toBe(false)
  expect(workFits(grant([f], { focus: { id8: 'dddddddd', lane: 'd', end: NOW + H, isRunning: true } as never }), f)).toBe(false)
  expect(workFits(grant([f], { sync: newSync(NOW + 5 * MIN, { session: 'x', id8: 'eeeeeeee', lane: 'e' }, 'e', NOW - H) }), f)).toBe(false)
})

test('A140: with memory short nothing is started, in the engine', opts(), async ($, on) => {
  const w = world(on, { ram: '5', out: { SendMessage: SENT } })
  w.put(LOCK, FREE)
  worker(w, 'cccccccc', QUEUED_WORDS)
  await $.session.start(START)
  await w.clock.advance(3 * MIN)
  expect(sends(w)).toEqual([])
})

test('A140: unit: the pool: asking, holding, running agents, active over a day ago or started within 2 h leave; last words read by the judge', () => {
  const base = { lastTurnAt: NOW - H, agents: 0 }
  const pool = (o: Partial<SessionFile>, workAt = {}, again = false) => workPool({ files: [file('cccccccc', { ...base, ...o })], lanes: [], now: NOW, workAt, again, archived: NONE }).length
  expect(pool({})).toBe(1)
  expect(pool({ want: want() })).toBe(0)
  expect(pool({ holding: { since: 0, end: 0, extended: 0 } })).toBe(0)
  expect(pool({ agents: 1 })).toBe(0)
  expect(pool({ lastTurnAt: NOW - 25 * H })).toBe(0)
  expect(pool({ lastTurnAt: NOW - MIN })).toBe(0) // not idle
  expect(pool({}, { cccccccc: NOW - H })).toBe(0)
  expect(pool({}, { cccccccc: NOW - H }, true)).toBe(1)
  expect(pool({}, { cccccccc: NOW - 2 * H })).toBe(1)
  const words = (t: string) => isFinished(parseTail(said(t)))
  expect(words(QUEUED_WORDS)).toBe(false)
  expect(words('Should I go on with the jump clip?')).toBe(true)
  expect(words('Needs the person now.')).toBe(true)
  expect(isFinished([])).toBe(true)
})

// ---------- A141 ----------
test('A141: unit: minutes count per day and per night, once each; a run needs minutes in a row', () => {
  const at = new Date(2026, 9, 6, 23, 0).getTime()
  let i = nextIdle(NO_IDLE, { isFree: true, hasWork: true, now: at }).idle
  expect([i.run, i.days['2026-10-06'], i.nights['2026-10-06']]).toEqual([1, 1, 1])
  expect(nextIdle(i, { isFree: true, hasWork: true, now: at + 1000 }).isCounted).toBe(false)
  i = nextIdle(i, { isFree: true, hasWork: true, now: at + MIN }).idle
  expect(i.run).toBe(2)
  expect(nextIdle(i, { isFree: true, hasWork: true, now: at + 5 * MIN }).idle.run).toBe(1) // no conductor for 4 min
  expect(nextIdle(i, { isFree: true, hasWork: false, now: at + 2 * MIN }).idle.run).toBe(0)
  expect(nextIdle(i, { isFree: false, hasWork: true, now: at + 2 * MIN }).idle.freeSince).toBe(0)
  expect(nightOf(new Date(2026, 9, 7, 7, 59).getTime())).toBe('2026-10-06')
  expect(nightOf(new Date(2026, 9, 7, 8, 0).getTime())).toBeNull()
})

test('A141: at 30 min in a row it tries once more, logs rule=idle-with-work and notifies when the engine can', opts(), async ($, on) => {
  const w = world(on, { ram: '5', out: { SendMessage: SENT } }) // memory holds the start: the Editor stands free with work
  const notes = () => ((w.calls['ui.toast'] ?? []) as unknown[]).map(t => JSON.stringify(t)).filter(t => t.includes('stood free')) // this test engine has no ui.notify: the toast
  w.put(LOCK, FREE)
  worker(w, 'cccccccc', QUEUED_WORDS)
  await $.session.start(START)
  await w.clock.advance(28 * MIN)
  expect(w.read(LOG)).not.toContain('rule=idle-with-work')
  await w.clock.advance(2 * MIN)
  expect(w.read(LOG).match(/rule=idle-with-work/g)?.length).toBe(1)
  expect(notes().length).toBe(1)
  expect(notes()[0]).toContain('the Editor has stood free 30 min with work waiting: lane-cccccccc has work')
  expect(JSON.parse(w.read(`${HF}/idle-with-work.json`)).run).toBeGreaterThan(29)
  await w.clock.advance(10 * MIN)
  expect(notes().length).toBe(1) // once per run
  w.machine.ram = '40'
  await w.clock.advance(MIN)
  expect(sends(w).length).toBeGreaterThan(0)
})

test('A141: unit: the alarm is a native notification when the engine can raise one, else a toast', async () => {
  for (const isSent of [true, false]) {
    const toasts: string[] = []
    const notes: string[] = []
    const disk = new Map<string, string>()
    const me = file(ME8, { heartbeatAt: NOW })
    const c = conductor({ me8: () => ME8, me: () => me, grantInput: now => grant([me, stoppedFile('cccccccc', { want: want() })], { now, probe: { freeGb: 5, diskGb: 100, procs: [] } }), leases: () => [], dir: () => 'd', freeWindow: () => 'w', freeGb: () => 5, titleOf: () => '' })
    disk.set('d/idle-with-work.json', JSON.stringify({ ...NO_IDLE, run: 29, lastAt: NOW - MIN }))
    await c.tick(fakeIo(disk, { notify: async (t: string) => (notes.push(t), isSent), toast: (t: string) => void toasts.push(t) }), NOW)
    expect(notes.length).toBe(1)
    expect(toasts.length).toBe(isSent ? 0 : 1)
  }
})

test('A141: the night of 2026-11-03: four queued sessions, processes gone, 2 h pass, the Editor free: each gets its lease', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: SENT } })
  const names = ['walkerun', 'thrustai', 'fluidblo', 'mclockon'].map((n, i) => ['a1', 'b2', 'c3', 'd4'][i] + n.slice(0, 6))
  w.put(LOCK, held('ffffffff', NOW, NOW + 2 * H))
  names.forEach((id8, i) => stopped(w, id8, { want: want({ requestedAt: NOW - (10 - i) * MIN, what: `work of ${id8}`, minutes: 20 }) }))
  put(w, file('ffffffff', { heartbeatAt: NOW + 100 * H, lastTurnAt: NOW, holding: { since: NOW, end: NOW + 2 * H, extended: 0 } })) // the holder runs on, and a live A5R runs the ticks
  await $.session.start(START)
  await w.clock.advance(2 * H) // A125 withdrew all four here
  expect(names.map(id8 => fileOf(w, id8).want !== null)).toEqual([true, true, true, true])
  put(w, file('ffffffff', { heartbeatAt: NOW + 100 * H, lastTurnAt: w.clock.now() }))
  w.put(LOCK, FREE)
  const got: string[] = []
  for (let n = 0; n < 200 && got.length < 4; n += 1) {
    const nextUp = sends(w).map(s => s.to.replace('local_', '')).find(id8 => !got.includes(id8))
    if (nextUp && parseLockLine(w.read(LOCK)).kind === 'free') {
      // Its process answers: its own A5R takes the lock at its first minute (A136 test above), works, releases.
      const now = w.clock.now()
      const f = fileOf(w, nextUp)
      expect(f.want).not.toBeNull()
      w.put(LOCK, held(nextUp, now, now + 20 * MIN))
      put(w, { ...f, heartbeatAt: now + 1, holding: { since: now, end: now + 20 * MIN, extended: 0 }, want: null })
      got.push(nextUp)
      await w.clock.advance(5 * MIN)
      put(w, { ...fileOf(w, nextUp), holding: null, want: null, heartbeatAt: w.clock.now() + 100 * H })
      w.put(LOCK, FREE)
    }
    await w.clock.advance(MIN)
  }
  expect(got).toEqual(names)
  expect(w.read(LOG)).not.toContain('rule=withdrawn')
})

// ---------- the review's findings (S147): each fails without its fix ----------
test('Review 1: a session that answered and stopped again with no lease is started again at the next window; a claim spent with nothing sent too', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: SENT } })
  w.put(LOCK, FREE)
  stopped(w, 'cccccccc')
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(sends(w).length).toBe(1)
  beat(w, 'cccccccc') // it answered, and its process stops again before it took the lock
  await w.clock.advance(11 * MIN)
  expect(sends(w).length).toBe(2)
  expect(fileOf(w, 'cccccccc').want).not.toBeNull()
})

test('Review 2: a removed, archived or twice-missed session is not started by the work step; an archived head gets no message', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: SENT } })
  w.put(LOCK, FREE)
  worker(w, 'c1c1c1c1', QUEUED_WORDS, { withdrawnAt: NOW - 2 * H }) // asked, then withdrawn after its last turn
  worker(w, 'c2c2c2c2', QUEUED_WORDS)
  desk(w, 'c2c2c2c2', 'local_c2c2c2c2', { isArchived: true })
  stopped(w, 'c3c3c3c3')
  desk(w, 'c3c3c3c3', 'local_c3c3c3c3', { isArchived: true })
  await $.session.start(START)
  await w.clock.advance(4 * MIN)
  expect(sends(w)).toEqual([])
  expect(turnToStart(grant([stoppedFile('cccccccc', { want: want() })]), f => f.id8 === 'cccccccc')).toBeNull()
})

test('Review 3: a refused send that nobody answers moves the request back and never withdraws it; a pause then a real miss does not either', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: REFUSED } })
  w.put(LOCK, FREE)
  stopped(w, 'cccccccc')
  await $.session.start(START)
  await w.clock.advance(25 * MIN)
  expect(sends(w).length).toBeGreaterThan(1)
  const f = fileOf(w, 'cccccccc')
  expect(f.want?.movedBack).toBe(true)
  expect(f.want?.misses).toBeUndefined()
  expect(w.read(LOG)).not.toContain('rule=withdrawn')
  const paused = afterMiss(want(), false)
  const real = paused && afterMiss(paused, true)
  expect(real?.misses).toBe(1)
  expect(real && afterMiss(real, true)).toBeNull()
  expect(readSend({ deny: 'Not delivered: this session has already messaged Claude Desktop sessions 8 times' }).kind).toBe('loop-paused')
})

test('Review 3: a conductor outside the app never withdraws a stopped request gone under 2 h; one in the app goes first', async () => {
  const me = file(ME8, { heartbeatAt: NOW })
  const c1 = stoppedFile('cccccccc', { want: want(), heartbeatAt: NOW - 30 * MIN, misses: 1 } as never)
  const disk = new Map<string, string>([['d/editor/cccccccc.json', JSON.stringify({ ...c1, want: want({ misses: 1, movedBack: true }) })]])
  const c = conductor({ me8: () => ME8, me: () => me, grantInput: now => grant([me, { ...c1, want: want({ misses: 1, movedBack: true }) }], { now }), leases: () => [], dir: () => 'd', freeWindow: () => 'w', freeGb: () => 40, titleOf: () => '' })
  await c.tick(fakeIo(disk), NOW)
  expect((JSON.parse(disk.get('d/editor/cccccccc.json') ?? '') as SessionFile).want).not.toBeNull()
  expect(c.canSend()).toBe(false)
  const f = (id8: string, o: Partial<SessionFile> = {}) => file(id8, o)
  expect(conductorOf([f('aaaaaaaa'), f('bbbbbbbb', { sends: true })], NOW)).toBe('bbbbbbbb')
})

test('Review 4: the claim is sticky: a session waking with a lower id does not take over while the holder lives', () => {
  expect(mayConduct(ME8, 'aaaaaaaa', { id8: ME8, at: NOW - MIN }, NOW)).toBe(true)
  expect(mayConduct('aaaaaaaa', 'aaaaaaaa', { id8: ME8, at: NOW - MIN }, NOW)).toBe(false)
  expect(mayConduct('aaaaaaaa', 'aaaaaaaa', { id8: ME8, at: NOW - 3 * MIN }, NOW)).toBe(true)
  expect(mayConduct('aaaaaaaa', 'aaaaaaaa', { id8: ME8, at: NOW - MIN }, NOW, true)).toBe(true) // the holder cannot start a session, the next one can
})

test('Review 5: a stopped head that its own slot holds back (memory, a cutoff) blocks no live session, however old; a live one takes the whole slot', () => {
  const head = stoppedFile('cccccccc', { want: want({ pie: true, requestedAt: NOW - 9 * H }) })
  const me = file(ME8, { want: want({ requestedAt: NOW - H, minutes: 60 }) })
  const d = decide(grant([head, me], { probe: { freeGb: 30, diskGb: 100, procs: [] } }))
  expect(d).toMatchObject({ kind: 'grant', end: NOW + 60 * MIN })
  const long = stoppedFile('cccccccc', { want: want({ minutes: 170 }) })
  const sync = newSync(NOW + 2 * H, { session: 'x', id8: 'eeeeeeee', lane: 'e' }, 'e', NOW - H)
  expect(decide(grant([long, file(ME8, { want: want({ minutes: 20, requestedAt: NOW - H }) })], { sync })).kind).toBe('grant')
  expect(turnToStart(grant([long], { sync }), KEEP)).toBeNull()
})

test('Review 2.1: a request that missed its start is behind every other request, and its place comes back if nobody else waits', () => {
  const a = stoppedFile('aaaaaaaa', { want: want({ requestedAt: NOW - 9 * H, movedBack: true }) })
  const b = stoppedFile('bbbbbbbb', { want: want({ requestedAt: NOW - 8 * H }) })
  const c = file('cccccccc', { want: want({ requestedAt: NOW - 7 * H }) })
  expect(queueOf([a, b, c], [], NOW, null, NO_MANUAL).map(f => f.id8)).toEqual(['bbbbbbbb', 'cccccccc', 'aaaaaaaa'])
  expect(queueOf([a], [], NOW, null, NO_MANUAL).map(f => f.id8)).toEqual(['aaaaaaaa'])
  expect(queueOf([{ ...a, heartbeatAt: NOW }, c], [], NOW, null, NO_MANUAL).map(f => f.id8)).toEqual(['aaaaaaaa', 'cccccccc']) // it came back: its place too
  expect(turnToStart(grant([a, c]), KEEP)).toBeNull() // a live request ahead of it
})

test('A137: a retried refusal keeps its time; a stopped session\'s miss of the route is tried again only after an hour', async () => {
  const disk = new Map<string, string>()
  const me = file(ME8, { heartbeatAt: NOW })
  const c = conductor({ me8: () => ME8, me: () => me, grantInput: now => grant([me], { now }), leases: () => [], dir: () => 'd', freeWindow: () => 'w', freeGb: () => 40, titleOf: () => '' })
  await c.refused(fakeIo(disk), { kind: 'git', what: 'x' }, NOW)
  await c.refused(fakeIo(disk), { kind: 'git', what: 'x' }, NOW + MIN)
  expect((JSON.parse(disk.get(`d/refused/${ME8}.json`) ?? '') as { at: number }).at).toBe(NOW)
})

test('Review 4: this session counts as in the app only with its own record there; a listing without a session drops its address', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: SENT } })
  w.put(LOCK, FREE)
  stopped(w, 'cccccccc')
  desk(w, ME8, `local_${ME8}`, { cliSessionId: ME })
  w.files.delete(`${DESK}/local_cccccccc.json`.toLowerCase())
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(sends(w)).toEqual([])
  expect(w.read(LOG)).toContain('no desktop record')
  expect(fileOf(w, ME8).sends).toBe(true)
})

test('Review 6: last words that wait for the Editor are not finished, whatever came before', () => {
  const tail = [JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'I released the Editor.' }] } }), said(QUEUED_WORDS)].join('\n')
  expect(isFinished(parseTail(tail))).toBe(false)
})

test('A140: one at a time: the next session with work waits until the first asks, or has had its time', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: SENT } })
  w.put(LOCK, FREE)
  worker(w, 'c1c1c1c1', QUEUED_WORDS, { lastTurnAt: NOW - 2 * H })
  worker(w, 'c2c2c2c2', QUEUED_WORDS, { lastTurnAt: NOW - 3 * H })
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(sends(w).map(s => s.to)).toEqual(['local_c1c1c1c1'])
  put(w, { ...fileOf(w, 'c1c1c1c1'), heartbeatAt: w.clock.now() + 60 * H }) // it came up and stays up
  await w.clock.advance(5 * MIN)
  expect(sends(w).length).toBe(1)
  await w.clock.advance(7 * MIN)
  expect(sends(w).map(s => s.to)).toEqual(['local_c1c1c1c1', 'local_c2c2c2c2'])
})

test('Review 3.1: a live session may ask a holder to yield with a stopped request at the head', () => {
  const stoppedHead = stoppedFile('cccccccc', { want: want() })
  const holder = file('dddddddd', { holding: { since: NOW - 100 * MIN, end: NOW + 100 * MIN, extended: 0 } })
  const me = file(ME8, { want: want({ minutes: 15, requestedAt: NOW - MIN }) })
  expect(mayAskYield(grant([stoppedHead, holder, me], { lock: parseLockLine(held('dddddddd', NOW - 100 * MIN, NOW + 100 * MIN)) }))).toEqual({ holder: 'dddddddd' })
})

test('Review 3.2: a session that answered drops its misses at its own save: a later miss does not withdraw it', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held('dddddddd', NOW, NOW + 10 * H))
  put(w, file('dddddddd', { heartbeatAt: NOW + 10 * H, holding: { since: NOW, end: NOW + 10 * H, extended: 0 } }))
  put(w, { ...file(ME8, { session: ME, want: want({ misses: 1, movedBack: true }) }), heartbeatAt: NOW - H })
  await $.session.start(START)
  await w.clock.advance(MIN)
  const f = fileOf(w, ME8)
  expect([f.want?.misses, f.want?.movedBack]).toEqual([undefined, undefined])
  expect(f.want).not.toBeNull()
  expect(answered(null)).toBeNull()
})

test('Review 3.3: while the guard holds, each stopped head moves back at once, so a live session behind them is not held', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: PAUSED } })
  w.put(LOCK, FREE)
  stopped(w, 'c1c1c1c1', { want: want({ requestedAt: NOW - 6 * H }) })
  stopped(w, 'c2c2c2c2', { want: want({ requestedAt: NOW - 5 * H }) })
  stopped(w, 'c3c3c3c3', { want: want({ requestedAt: NOW - 4 * H }) })
  await $.session.start(START)
  await w.clock.advance(5 * MIN)
  expect(['c1c1c1c1', 'c2c2c2c2', 'c3c3c3c3'].map(id8 => fileOf(w, id8).want?.movedBack)).toEqual([true, true, true])
  expect(sends(w).length).toBe(1)
})

test('Review 3.4: one whose start was tried this window leaves room for the next', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: REFUSED } })
  w.put(LOCK, FREE)
  stopped(w, 'c1c1c1c1', { want: want({ requestedAt: NOW - 6 * H }) })
  stopped(w, 'c2c2c2c2', { want: want({ requestedAt: NOW - 5 * H }) })
  await $.session.start(START)
  await w.clock.advance(14 * MIN)
  expect(sends(w).map(s => s.to).slice(0, 2)).toEqual(['local_c1c1c1c1', 'local_c2c2c2c2'])
})
