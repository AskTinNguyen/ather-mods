import { expect, test } from 'claude-code/testing'
import { autoSyncOf, syncWakeDue, type AutoSyncInput } from '../hooks/autosync.ts'
import { newSync, parseSyncFile, type SyncFile } from '../hooks/coord.ts'
import { NO_WAKE, WAKE_ANSWER_MS, budgetHold, parseWake, syncMessage, whyLabel, type SyncWake } from '../hooks/wake.ts'
import { conductor } from '../hooks/wakehost.ts'
import { LOCK, ME, NOW, opts, world } from './world.ts'

import { HF, ME8, MIN, START, SID, FREE, app, fakeIo, file, grant, stoppedFile, put, desk, sends, LOG, SENT, PAUSED, beat } from './rev45.fixture.ts'

// Rev 47 (L-52): A146 the sync holder is woken, not dropped. MEASURED 2026-11-09: the 07:00 sync was cancelled at 06:50
// because its holder (the sync-main desktop session) had lost its claude.exe process while idle. Now a holder quiet in the
// cutoff is started once by the conductor (the A138 route); the hand-over and the cancel at T − 10 wait for its answer.
// (A145, the merge script's half of rev 47, is proven by node a5r/tests/merge-script-smoke.mjs.)
const SYNC = `${HF}/sync.json`
const T = NOW + 25 * MIN // the sync: 15:05; its cutoff 14:35, so it is in its cutoff from the start
const C = { session: SID('cccccccc'), id8: 'cccccccc', lane: 'lane-cccccccc' }
const planned = (): SyncFile => newSync(T, C, 'lane-cccccccc (session cccccccc)', NOW - 60 * MIN)
type W = ReturnType<typeof world>
/** The holder: a desktop session whose process stopped hours ago (no request: only its sync). */
const holderStopped = (w: W) => {
  put(w, stoppedFile('cccccccc', { want: null }))
  desk(w, 'cccccccc')
  w.put(SYNC, JSON.stringify(planned()))
}
const stateOf = (w: W) => parseSyncFile(w.read(SYNC))?.state
const woke = (w: W) => w.read(LOG).split('\n').filter(l => l.includes('rule=woke'))
/** Runs the clock to `at` a minute at a time, the holder answering each minute when `answers`. */
const until = async (w: W, at: number, answers = false) => {
  while (w.clock.now() < at) {
    await w.clock.advance(MIN)
    if (answers) beat(w, 'cccccccc')
  }
}

test('A146: unit: a quiet holder in its cutoff is due one start; the hand-over and the cancel wait for its answer, 5 min at most', () => {
  const s = planned()
  const gone = { ...file('cccccccc'), heartbeatAt: NOW - 3 * 60 * MIN }
  const x = (o: Partial<AutoSyncInput>): AutoSyncInput => ({ sync: s, phase: 'cutoff', files: [gone], lanes: [], now: T - 10 * MIN, titleOf: () => '', queued: 0, lockEnd: null, isFocusRunning: false, woke: null, ...o })
  const woke = (at: number, sent = true): SyncWake => ({ id: s.id, at, sent, id8: 'cccccccc', lane: 'lane-cccccccc' })
  expect(syncWakeDue(x({}))?.id).toBe(s.id)
  expect(syncWakeDue(x({ phase: 'planned', now: T - 40 * MIN }))).toBeNull() // before the cutoff: the 30-min rule only
  expect(syncWakeDue(x({ files: [{ ...gone, heartbeatAt: T - 10 * MIN }] }))).toBeNull() // live
  expect(syncWakeDue(x({ woke: woke(T - 25 * MIN) }))).toBeNull() // one start per sync
  expect(syncWakeDue(x({ woke: { ...woke(T - 25 * 60 * MIN), id: 'an older sync' } }))?.id).toBe(s.id)
  // Fable 2: T − 10 decides, whatever the start's state: due and untried, sent a minute ago, or one that could not go.
  expect(autoSyncOf(x({}))).toMatchObject({ kind: 'cancel' })
  expect(autoSyncOf(x({ woke: woke(T - 11 * MIN) }))).toMatchObject({ kind: 'cancel' })
  expect(autoSyncOf(x({ woke: woke(T - 11 * MIN, false) }))).toMatchObject({ kind: 'cancel' })
  // Before T − 10 the hand-over to a live conductor waits: while a start is due and untried, or sent under 5 min ago.
  const conductor = { ...file('eeeeeeee', { lane: 'sync-main', title: 'S2 sync main' }), heartbeatAt: T }
  const y = (o: Partial<AutoSyncInput>) => x({ files: [gone, conductor], now: T - 25 * MIN, ...o })
  expect(autoSyncOf(y({})).kind).toBe('none')
  expect(autoSyncOf(y({ woke: woke(T - 27 * MIN) })).kind).toBe('none')
  expect(autoSyncOf(y({ woke: woke(T - 25 * MIN - WAKE_ANSWER_MS) }))).toMatchObject({ kind: 'take', holder: { id8: 'eeeeeeee' } })
  expect(autoSyncOf(y({ woke: woke(T - 27 * MIN, false) }))).toMatchObject({ kind: 'take', holder: { id8: 'eeeeeeee' } })
  expect(autoSyncOf(y({ now: T - 10 * MIN }))).toMatchObject({ kind: 'take', holder: { id8: 'eeeeeeee' } })
  // The message, the log label, the budget (a sync's start is not held back for Editor turns), wake.json keeps it.
  expect(syncMessage(s)).toContain(`you hold the sync of main at 15:05 (${s.id}) and your session had stopped`)
  expect(whyLabel({ why: 'sync', syncId: s.id })).toBe(`sync ${s.id}`)
  expect(budgetHold({ ...NO_WAKE, spent: Array.from({ length: 7 }, () => ({ at: NOW })) }, 'sync', NOW)).toBeNull()
  expect(parseWake(JSON.stringify({ ...NO_WAKE, syncWake: woke(NOW) })).syncWake).toEqual(woke(NOW))
})

test('A146: a quiet holder at the cutoff gets one start and no cancel; with no answer the sync is cancelled at T − 10 as before', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: SENT } })
  w.put(LOCK, FREE)
  holderStopped(w)
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(sends(w).map(s => s.to)).toEqual(['local_cccccccc'])
  expect(sends(w)[0]?.message).toContain('you hold the sync of main at 15:05')
  expect(woke(w).some(l => l.includes(`sync ${planned().id}: sent to local_cccccccc`))).toBe(true)
  expect(parseWake(w.read(`${HF}/wake.json`)).syncWake).toMatchObject({ id: planned().id, sent: true })
  await until(w, T - 10 * MIN - MIN)
  expect(stateOf(w)).toBe('planned')
  expect(woke(w).some(l => l.includes(`sync ${planned().id}: no-answer`))).toBe(true)
  await until(w, T - 10 * MIN + MIN)
  expect(stateOf(w)).toBe('cancelled')
  expect(sends(w).length).toBe(1) // one start per sync
})

test('A146: the holder answers: the sync stays through T − 10', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: SENT } })
  w.put(LOCK, FREE)
  holderStopped(w)
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(sends(w).length).toBe(1)
  await until(w, T - 5 * MIN, true)
  expect(woke(w).some(l => l.includes(`sync ${planned().id}: answered`))).toBe(true)
  expect(stateOf(w)).toBe('planned')
  expect(sends(w).length).toBe(1)
})

test('A146: a start another A5R sent for this sync is not sent again', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: SENT } })
  w.put(LOCK, FREE)
  holderStopped(w)
  w.put(`${HF}/wake.json`, JSON.stringify({ ...NO_WAKE, syncWake: { id: planned().id, at: NOW - MIN, sent: true, id8: 'cccccccc', lane: 'lane-cccccccc' } }))
  await $.session.start(START)
  await until(w, NOW + 4 * MIN)
  expect(sends(w)).toEqual([])
})

test('A146: a loop-paused start is not retried, and the old rule cancels at T − 10', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { SendMessage: PAUSED } })
  w.put(LOCK, FREE)
  holderStopped(w)
  await $.session.start(START)
  await w.clock.advance(MIN)
  expect(sends(w).length).toBe(1)
  expect(woke(w).some(l => l.includes(`sync ${planned().id}: loop-paused`))).toBe(true)
  expect(parseWake(w.read(`${HF}/wake.json`)).syncWake).toMatchObject({ id: planned().id, sent: false })
  await until(w, T - 10 * MIN + MIN)
  expect(sends(w).length).toBe(1)
  expect(stateOf(w)).toBe('cancelled')
})

test('A146 (Fable 1): an Editor-turn start in flight does not hold back the sync holder\'s start; the turn start is still settled after it', async () => {
  const me = file(ME8, { heartbeatAt: NOW, session: ME })
  const holder = stoppedFile('cccccccc', { want: null })
  const a = app([{ name: 'local_me.json', row: { sessionId: 'local_me', cliSessionId: ME } }, { name: 'local_c.json', row: { sessionId: 'local_c', cliSessionId: SID('cccccccc') } }])
  const turn = { id8: 'dddddddd', lane: 'lane-dddddddd', why: 'turn', at: NOW - MIN, requestedAt: NOW - 60 * MIN }
  a.disk.set('d/wake.json', JSON.stringify({ ...NO_WAKE, current: turn }))
  a.disk.set('d/conductor.json', JSON.stringify({ id8: ME8, at: NOW - MIN }))
  const sent: string[] = []
  const c = conductor({ me8: () => ME8, me: () => me, grantInput: now => grant([me, holder], { now }), leases: () => [], dir: () => 'd', freeWindow: () => 'w', freeGb: () => 40, titleOf: () => '', sync: () => ({ sync: planned(), phase: 'cutoff' }) })
  await c.tick(fakeIo(a.disk, { ...a.o, call: async (input: Record<string, unknown>) => (sent.push(String(input.to)), { text: SENT }) }))
  expect(sent).toEqual(['local_c'])
  const after = parseWake(a.disk.get('d/wake.json') ?? null)
  expect(after.current).toEqual(turn) // the turn start stays in its slot, to be settled as before
  expect(after.syncWake).toMatchObject({ id: planned().id, sent: true, id8: 'cccccccc' })
})

test('A146: another conductor at it this minute: nothing sent and no start recorded for the sync (it is tried again next minute)', async () => {
  const me = file(ME8, { heartbeatAt: NOW, session: ME })
  const holder = stoppedFile('cccccccc', { want: null })
  const a = app([{ name: 'local_me.json', row: { sessionId: 'local_me', cliSessionId: ME } }, { name: 'local_c.json', row: { sessionId: 'local_c', cliSessionId: SID('cccccccc') } }])
  const before = JSON.stringify(NO_WAKE)
  a.disk.set('d/wake.json', before)
  const other = JSON.stringify({ ...NO_WAKE, syncWake: { id: planned().id, at: NOW, sent: true, id8: 'cccccccc', lane: 'lane-cccccccc' } })
  let reads = 0
  let calls = 0
  const c = conductor({ me8: () => ME8, me: () => me, grantInput: now => grant([me, holder], { now }), leases: () => [], dir: () => 'd', freeWindow: () => 'w', freeGb: () => 40, titleOf: () => '', sync: () => ({ sync: planned(), phase: 'cutoff' }) })
  await c.tick(fakeIo(a.disk, { ...a.o, read: async (p: string) => (p === 'd/wake.json' && (reads += 1) > 1 ? other : (a.disk.get(p) ?? null)), call: async () => ((calls += 1), { text: SENT }) }))
  expect(calls).toBe(0)
  expect(a.disk.get('d/wake.json')).toBe(before)
})

test('A146: a conductor paused by the loop guard sends nothing and records the start as not sent (the old rule applies)', async () => {
  const me = file(ME8, { heartbeatAt: NOW, session: ME })
  const holder = stoppedFile('cccccccc', { want: null })
  const a = app([{ name: 'local_me.json', row: { sessionId: 'local_me', cliSessionId: ME } }, { name: 'local_c.json', row: { sessionId: 'local_c', cliSessionId: SID('cccccccc') } }])
  a.disk.set('d/wake.json', JSON.stringify({ ...NO_WAKE, pausedUntil: NOW + 30 * MIN, pausedSince: NOW - 30 * MIN }))
  let calls = 0
  const c = conductor({ me8: () => ME8, me: () => me, grantInput: now => grant([me, holder], { now }), leases: () => [], dir: () => 'd', freeWindow: () => 'w', freeGb: () => 40, titleOf: () => '', sync: () => ({ sync: planned(), phase: 'cutoff' }) })
  await c.tick(fakeIo(a.disk, { ...a.o, call: async () => ((calls += 1), { text: SENT }) }))
  expect(calls).toBe(0)
  expect(parseWake(a.disk.get('d/wake.json') ?? null).syncWake).toEqual({ id: planned().id, at: NOW, sent: false, id8: 'cccccccc', lane: 'lane-cccccccc' })
})
