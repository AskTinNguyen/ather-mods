import { expect, test } from 'claude-code/testing'
import { a5rCard, availabilityNow, inWindow, isStale, lanesOf, probeCard, sameCard, type HostCard, type LocalTruth } from '../hooks/hostcard.ts'
import { pastedChecks } from '../hooks/hostchecks.ts'
import { parseState } from '../hooks/hoststate.ts'
import type { AsHost } from '../hooks/hosts.ts'
import { fitsText, suggest, type SuggestHost, type SuggestLocal, type SuggestOptions, type SuggestRequest } from '../hooks/suggest.ts'

// a5r-hosts S-c (L1): the card an A5R host builds from its local truth, freshness with the measured skew, the probe card's
// roles and unknown trust (A5); suggest over every reason and why-not code, boundaries, no hosts, all stale, the pick
// order (A6). Pure functions only; the engine side is hosts-sc-engine.test.ts.
const MIN = 60_000
const NOW = Date.UTC(2026, 10, 9, 14, 0) // a Monday, 14:00 UTC
const O: SuggestOptions = { longMinutes: 120, readOnlyWaitMin: 15, staleCardMin: 10 }
const LOCAL: SuggestLocal = { now: NOW, freeGb: 30, gates: { pieGb: 38, nopieGb: 28 }, freeze: null, originId: 'hai-1a2b3c4d' }
const REQ: SuggestRequest = { minutes: 30, pie: false, build: false }
const card = (over: Partial<HostCard> = {}): HostCard => ({
  v: 1,
  at: NOW - MIN,
  source: 'a5r',
  hostId: 'rig',
  machine: { freeRamGb: 40, totalRamGb: 64, freeDiskGb: 200 },
  editor: { holder: null, queue: 0, running: false },
  availability: { state: 'yes' },
  freeze: null,
  lanes: [],
  jobs: { running: 0, queued: 0 },
  account: { shared: 'unknown' },
  skew: { ms: null },
  roles: ['ue', 'gpu'],
  acceptsFrom: ['hai-1a2b3c4d'],
  ...over,
})
const host = (over: Partial<SuggestHost> = {}, c: Partial<HostCard> = {}): SuggestHost => ({ id: 'rig', label: 'the rig', level: 1, card: card(c), ...over })
const LOW: SuggestLocal = { ...LOCAL, freeGb: 20 } // under the 28 GB launch gate: RAM triggers

test('S-c (A6): unit: each reason triggers alone, at its boundary; IDLE joins a host that fits and never suggests alone', () => {
  const rows: [string, SuggestRequest, SuggestLocal, Partial<HostCard>, string | 'none'][] = [
    ['RAM: here 20 < 28 (the gate), the host 40', REQ, LOW, {}, 'fits the rig (RAM, IDLE)'],
    ['RAM: here exactly the need is enough', REQ, { ...LOCAL, freeGb: 28 }, {}, 'none'],
    ['RAM: the host at exactly the need fits', REQ, LOW, { machine: { freeRamGb: 28, totalRamGb: 64, freeDiskGb: null } }, 'fits the rig (RAM, IDLE)'],
    ['RAM: needGb overrides the gate', { ...REQ, needGb: 35 }, LOCAL, {}, 'fits the rig (RAM, IDLE)'],
    ['RAM: PIE uses the PIE gate (38)', { ...REQ, pie: true }, LOCAL, {}, 'fits the rig (RAM, IDLE)'],
    ['RAM: free RAM here unread never triggers', REQ, { ...LOCAL, freeGb: null }, {}, 'none'],
    ['LONG at 120 min', { ...REQ, minutes: 120 }, LOCAL, {}, 'fits the rig (LONG, IDLE)'],
    ['LONG: 119 min is not long', { ...REQ, minutes: 119 }, LOCAL, {}, 'none'],
    ['READONLY_WAIT after 15 min', { ...REQ, readOnly: true, editorHeldByOther: true, waitedMin: 15 }, LOCAL, {}, 'fits the rig (READONLY_WAIT, IDLE)'],
    ['READONLY_WAIT: 14.9 min is too soon', { ...REQ, readOnly: true, editorHeldByOther: true, waitedMin: 14.9 }, LOCAL, {}, 'none'],
    ['READONLY_WAIT: the Editor not held by another', { ...REQ, readOnly: true, editorHeldByOther: false, waitedMin: 60 }, LOCAL, {}, 'none'],
    ['READONLY_WAIT: not read-only', { ...REQ, editorHeldByOther: true, waitedMin: 60 }, LOCAL, {}, 'none'],
    ['FREEZE: the window crosses the cutoff', REQ, { ...LOCAL, freeze: { from: NOW + 20 * MIN, to: NOW + 120 * MIN } }, {}, 'fits the rig (FREEZE, IDLE)'],
    ['FREEZE: a window that ends at the cutoff', REQ, { ...LOCAL, freeze: { from: NOW + 30 * MIN, to: NOW + 120 * MIN } }, {}, 'none'],
    ['FREEZE: after the hard end', REQ, { ...LOCAL, freeze: { from: NOW - 90 * MIN, to: NOW } }, {}, 'none'],
    ['IDLE alone: nothing to suggest', REQ, LOCAL, {}, 'none'],
    ['IDLE only when the host Editor is down and no queue', REQ, LOW, { editor: { holder: null, queue: 1, running: false } }, 'fits the rig (RAM)'],
    ['IDLE not with the Editor running', REQ, LOW, { editor: { holder: { lane: 'x', end: null }, queue: 0, running: true } }, 'fits the rig (RAM)'],
    ['every trigger at once', { ...REQ, minutes: 180, readOnly: true, editorHeldByOther: true, waitedMin: 20 }, { ...LOW, freeze: { from: NOW, to: NOW + MIN } }, {}, 'fits the rig (RAM, LONG, READONLY_WAIT, FREEZE, IDLE)'],
  ]
  for (const [name, r, local, c, want] of rows) {
    const s = suggest(r, local, [host({}, c)], O)
    expect([name, s.suggestion === 'none' ? 'none' : fitsText(s.suggestion), s.whyNot]).toEqual([name, want, []])
  }
})

test('S-c (A6): unit: every why-not code, alone and at its boundary; a probe card says trust unknown; NO_ADAPTER_OP is never said', () => {
  const rows: [string, Partial<SuggestHost>, Partial<HostCard>, SuggestRequest, string[], string[]?][] = [
    ['UNCHECKED: level 0', { level: 0 }, {}, REQ, ['UNCHECKED']],
    ['STALE_CARD: older than staleCardMin', {}, { at: NOW - 10 * MIN - 1 }, REQ, ['STALE_CARD']],
    ['STALE_CARD: no card at all says nothing else', { card: null }, {}, REQ, ['STALE_CARD']],
    ['UNCHECKED and no card', { level: 0, card: null }, {}, REQ, ['UNCHECKED', 'STALE_CARD']],
    ['UNAVAILABLE: availability no', {}, { availability: { state: 'no', reason: 'nights only' } }, REQ, ['UNAVAILABLE']],
    ['FROZEN: the host is in its own sync freeze', {}, { freeze: { kind: 'sync', until: NOW + 40 * MIN } }, REQ, ['FROZEN']],
    ['NO_ROLE: a wanted role is missing', {}, {}, { ...REQ, wants: ['ue', 'mocap'] }, ['NO_ROLE']],
    ['NO_ROLE: a probe card with no roles', {}, { roles: undefined, acceptsFrom: undefined, source: 'probe' }, { ...REQ, wants: ['ue'] }, ['NO_ROLE'], ['trust unknown']],
    ['NO_TRUST: this origin is not accepted', {}, { acceptsFrom: ['someone-else'] }, REQ, ['NO_TRUST']],
    ['NO_RAM: the host has less than the need', {}, { machine: { freeRamGb: 27.9, totalRamGb: 64, freeDiskGb: null } }, REQ, ['NO_RAM']],
    ['NO_RAM: unread on the host', {}, { machine: { freeRamGb: null, totalRamGb: null, freeDiskGb: null } }, REQ, ['NO_RAM'], ['RAM unknown']],
    ['several at once, in order', { level: 0 }, { at: NOW - 60 * MIN, availability: { state: 'no' }, freeze: { kind: 'sync' }, acceptsFrom: [], machine: { freeRamGb: 1, totalRamGb: 8, freeDiskGb: null } }, { ...REQ, wants: ['x'] }, ['UNCHECKED', 'STALE_CARD', 'UNAVAILABLE', 'FROZEN', 'NO_ROLE', 'NO_TRUST', 'NO_RAM']],
  ]
  for (const [name, h, c, r, codes, notes] of rows) {
    const s = suggest({ ...r, minutes: 150 }, LOW, [host(h, c)], O)
    expect([name, s.suggestion, s.whyNot]).toEqual([name, 'none', [{ host: 'rig', codes, ...(notes ? { notes } : {}) }]])
  }
  // Boundaries that pass: a card exactly staleCardMin old, trust "*", a probe card (trust unknown, noted, not refused).
  expect(suggest(REQ, LOW, [host({}, { at: NOW - 10 * MIN })], O).suggestion).toMatchObject({ host: 'rig' })
  expect(suggest(REQ, LOW, [host({}, { acceptsFrom: ['*'] })], O).suggestion).toMatchObject({ host: 'rig' })
  expect(suggest(REQ, LOW, [host({}, { source: 'probe', acceptsFrom: undefined })], O).suggestion).toEqual({ host: 'rig', label: 'the rig', reasons: ['RAM', 'IDLE'], notes: ['trust unknown'] })
  // No origin id made yet: only "*" accepts it.
  expect(suggest(REQ, { ...LOW, originId: null }, [host()], O).whyNot).toEqual([{ host: 'rig', codes: ['NO_TRUST'] }])
})

test('S-c (A6): unit: no hosts, all stale, the pick (most free RAM, ties by label), thresholds from the options; suggest is pure', () => {
  expect(suggest(REQ, LOW, [], O)).toEqual({ suggestion: 'none', whyNot: [] })
  const stale = [host({ id: 'a', label: 'A' }, { at: NOW - 30 * MIN }), host({ id: 'b', label: 'B', card: null })]
  expect(suggest(REQ, LOW, stale, O)).toEqual({ suggestion: 'none', whyNot: [{ host: 'a', codes: ['STALE_CARD'] }, { host: 'b', codes: ['STALE_CARD'] }] })
  const three = [host({ id: 'b', label: 'beta' }, { machine: { freeRamGb: 50, totalRamGb: 64, freeDiskGb: null } }), host({ id: 'a', label: 'alpha' }, { machine: { freeRamGb: 50, totalRamGb: 64, freeDiskGb: null } }), host({ id: 'c', label: 'gamma' }, { machine: { freeRamGb: 40, totalRamGb: 64, freeDiskGb: null } })]
  expect(suggest(REQ, LOW, three, O).suggestion).toMatchObject({ host: 'a', label: 'alpha' })
  expect(suggest(REQ, LOW, [three[2] as SuggestHost, host({ id: 'd', label: 'delta' }, { machine: { freeRamGb: 41, totalRamGb: 64, freeDiskGb: null } })], O).suggestion).toMatchObject({ host: 'd' })
  // The thresholds are the options' (here 60 min is LONG; 5 min of waiting is enough).
  expect(fitsText(suggest({ ...REQ, minutes: 60, readOnly: true, editorHeldByOther: true, waitedMin: 5 }, LOCAL, [host()], { ...O, longMinutes: 60, readOnlyWaitMin: 5 }).suggestion as never)).toBe('fits the rig (LONG, READONLY_WAIT, IDLE)')
  // Pure: the same inputs give the same answer and nothing passed in is changed.
  const hosts = [host()]
  const before = JSON.stringify(hosts)
  expect(suggest(REQ, LOW, hosts, O)).toEqual(suggest(REQ, LOW, hosts, O))
  expect(JSON.stringify(hosts)).toBe(before)
})

const AS: AsHost = { enabled: true, roles: ['ue'], availability: { state: 'yes' }, trust: ['hai-1a2b3c4d'], laneRoot: 'D:/lanes', account: { shared: 'yes' } }
const TRUTH: LocalTruth = { os: 'windows', freeGb: 31.5, diskGb: 120, running: true, holder: { id8: 'ab12cd34', lane: 'loco', end: NOW + 20 * MIN }, queue: 2, gates: { pieGb: 38, nopieGb: 28 }, sync: null }

test('S-c (A5, A16): unit: an A5R host card comes from local truth: the Editor holder and live queue, availability now, roles, acceptsFrom', () => {
  const lanes = [{ id: 'l1', slug: 'l1', state: 'idle' as const }]
  expect(a5rCard(NOW, AS, TRUTH, lanes)).toEqual({
    v: 1,
    at: NOW,
    source: 'a5r',
    machine: { os: 'windows', freeRamGb: 31.5, totalRamGb: null, freeDiskGb: 120 },
    editor: { holder: { lane: 'loco', end: NOW + 20 * MIN }, queue: 2, running: true },
    availability: { state: 'yes' },
    freeze: null,
    lanes,
    jobs: { running: 0, queued: 0 },
    account: { shared: 'yes' },
    skew: { ms: null },
    roles: ['ue'],
    acceptsFrom: ['hai-1a2b3c4d'],
  })
  // A sync in its cutoff or freeze is the card's freeze (until the hard end); a planned one is not yet.
  expect(a5rCard(NOW, AS, { ...TRUTH, sync: { at: NOW + 10 * MIN, hardEnd: NOW + 55 * MIN, isFrozen: true } }, []).freeze).toEqual({ kind: 'sync', until: NOW + 55 * MIN })
  expect(a5rCard(NOW, AS, { ...TRUTH, sync: { at: NOW + 60 * MIN, hardEnd: NOW + 105 * MIN, isFrozen: false } }, []).freeze).toBeNull()
  expect(a5rCard(NOW, { ...AS, account: undefined }, { ...TRUTH, running: 'unknown', holder: null, freeGb: null }, []).editor).toEqual({ holder: null, queue: 2, running: 'unknown' })
  // Same content, another minute: the same card; a changed queue: not.
  expect(sameCard(a5rCard(NOW, AS, TRUTH, []), a5rCard(NOW + MIN, AS, TRUTH, []))).toBe(true)
  expect(sameCard(a5rCard(NOW, AS, TRUTH, []), a5rCard(NOW, AS, { ...TRUTH, queue: 3 }, []))).toBe(false)
  expect(sameCard(null, a5rCard(NOW, AS, TRUTH, []))).toBe(false)
})

test('S-c (A5): unit: availability windows evaluated now (zone, days, past midnight, until); lanes from git worktree list', () => {
  const w = (days: string[], from: string, to: string, tz = 'UTC') => ({ days, from, to, tz })
  expect(inWindow(w(['Mon'], '13:00', '15:00'), NOW)).toBe(true)
  expect(inWindow(w(['Mon'], '14:00', '15:00'), NOW)).toBe(true) // from is inside
  expect(inWindow(w(['Mon'], '12:00', '14:00'), NOW)).toBe(false) // to is outside
  expect(inWindow(w(['Tue'], '13:00', '15:00'), NOW)).toBe(false)
  expect(inWindow(w(['monday'], '20:00', '07:00', 'Asia/Ho_Chi_Minh'), NOW)).toBe(true) // 21:00 Monday there
  expect(inWindow(w(['Sun'], '20:00', '07:00', 'Asia/Ho_Chi_Minh'), NOW + 10 * 60 * MIN)).toBe(false) // 07:00 Tuesday there: ended
  expect(inWindow(w(['Mon'], '20:00', '07:00', 'Asia/Ho_Chi_Minh'), NOW + 9 * 60 * MIN)).toBe(true) // 06:00 Tuesday, the Monday span
  expect(inWindow(w(['Mon'], '00:00', '23:59', 'Not/AZone'), NOW)).toBe(false)
  expect(availabilityNow({ state: 'yes', windows: [w(['Mon'], '13:00', '15:00')] }, NOW)).toEqual({ state: 'yes' })
  expect(availabilityNow({ state: 'yes', windows: [w(['Sat', 'Sun'], '00:00', '23:59')] }, NOW)).toEqual({ state: 'no', reason: 'outside its windows' })
  expect(availabilityNow({ state: 'yes', reason: 'weekends only', windows: [w(['Sat'], '00:00', '23:59')] }, NOW)).toEqual({ state: 'no', reason: 'weekends only' })
  expect(availabilityNow({ state: 'yes', until: NOW + MIN }, NOW)).toEqual({ state: 'yes', until: NOW + MIN })
  expect(availabilityNow({ state: 'yes', until: NOW }, NOW)).toEqual({ state: 'no', reason: 'past its until' })
  expect(availabilityNow({ state: 'no', reason: 'owner at work' }, NOW)).toEqual({ state: 'no', reason: 'owner at work' })
  const porcelain = ['worktree E:/s2', 'HEAD 1111', 'branch refs/heads/main', '', 'worktree D:/lanes/a5r-1', 'HEAD 2222', 'branch refs/heads/intent/loco', '', 'worktree D:\\lanes\\a5r-2', 'HEAD 3333', 'detached', '', 'worktree D:/other/x', 'HEAD 4444', 'detached', ''].join('\r\n')
  expect(lanesOf(porcelain, 'D:\\lanes\\')).toEqual([
    { id: 'a5r-1', slug: 'a5r-1', state: 'busy', branch: 'intent/loco' },
    { id: 'a5r-2', slug: 'a5r-2', state: 'idle' },
  ])
  expect(lanesOf('', 'D:/lanes')).toEqual([])
})

test('S-c (A5): unit: freshness uses the skew C4 measured for an A5R card; a probe card carries the assumed roles and no acceptsFrom', () => {
  // The host's clock 20 min behind: its card written just now reads 20 min old until corrected.
  const behind = card({ at: NOW - 20 * MIN })
  expect(isStale(behind, NOW, 10)).toBe(true)
  expect(isStale({ ...behind, skew: { ms: -20 * MIN } }, NOW, 10)).toBe(false)
  expect(isStale({ ...behind, source: 'probe', skew: { ms: -20 * MIN } }, NOW, 10)).toBe(true) // a probe card is in this clock
  expect(isStale(null, NOW, 10)).toBe(true)
  // C4 keeps the skew it measured as a number beside its text (never read back from the text).
  const pasted = pastedChecks({ os: 'windows', osText: 'Windows_NT', epochMs: NOW - 30_000, ramKb: null }, NOW, NOW)
  expect([pasted.checks.C4?.value, pasted.checks.C4?.ms]).toEqual(["skew -30.0 s (limit 120 s), against the pasted file's time", -30_000])
  expect(parseState(JSON.stringify({ v: 1, checks: { C4: { status: 'pass', value: 'skew +5.7 s (limit 120 s)', checkedAt: 1, ms: 5_713 } }, level: 1, link: { failures: 0, windowStart: 0 } })).checks.C4).toEqual({ status: 'pass', value: 'skew +5.7 s (limit 120 s)', checkedAt: 1, ms: 5_713 })
  const decl = { label: 'night rig', owner: 'team', reach: { kind: 'ssh' as const, target: 'rig' }, assumed: { roles: ['ue'], availability: { state: 'yes' as const } } }
  const p = probeCard('rig', decl, NOW, { os: 'windows', totalRamGb: 64, freeRamGb: 30, running: false })
  expect([p.source, p.roles, p.acceptsFrom, p.availability]).toEqual(['probe', ['ue'], undefined, { state: 'yes' }])
})
