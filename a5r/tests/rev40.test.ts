import { expect, test } from 'claude-code/testing'
import { DEFAULT_GATES, NO_MANUAL, blankSession, decide, heldLine, heldLineAt, isStandardHeld, newSync, parseLockLine, queueOf, writesOrder, type GrantInput, type ManualOrder, type Probe, type SessionFile, type Want } from '../hooks/coord.ts'
import { adoptLockEnd, leaseSummary, queueView, type LeaseRecord } from '../hooks/lease.ts'
import { NO_ORDER, applyOrder, isPersonOrigin, manualOf, parseEditorCommand, parseOrder, pickByName, type OrderAction, type QueueOrder } from '../hooks/order.ts'
import { editorPanel, needsLook } from '../hooks/panel.ts'
import type { VerdictRow } from '../hooks/judge.ts'
import { A5RPANE, LOCK, ME, NOW, PROJ, all, find, keys, minWidth, opts, placed, refused, still, text, world, type Rec, type Tree } from './world.ts'

// Rev 40 (L-44: "the Editor Queue and Sessions blocks look like the same thing; what Orchestrate is for is unclear"; then
// "rearrange and resize"): A116 one Editor list on the A5R panel (the holder, the queue in order, plain reasons), the other
// sessions only once, NEEDS A LOOK only when a verdict needs the person; A117 the person's own controls: rearrange the queue
// and give a turn more time, from a panel press or his own /a5r editor command, never from a tool a model can call.
const HF = 'E:/s2/Saved/A5R'
const ORDER = `${HF}/queue-order.json`
const LOG = `${HF}/orchestrate.log`
const LANES = 'E:/s2/Saved/AtherAutomata/lanes'
const ME8 = ME.slice(0, 8)
const EDITOR = 'mcp__a5r__editor'
const MIN = 60_000
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const FREE = 'FREE since=14:00 2026-10-06 by=x note=none background=none · free since 14:00\n'
const want = (o: Partial<Want> = {}): Want => ({ minutes: 30, pie: false, build: false, what: 'their slot', mode: 'unattended', pausable: true, nextSafe: 'after save', requestedAt: NOW - 30 * MIN, ...o })
const file = (id8: string, o: Partial<SessionFile> = {}): SessionFile => ({ ...blankSession(SID(id8), `lane-${id8}`, `title ${id8}`, NOW), lastTurnAt: NOW - 2 * MIN, ...o })
const peer = (id8: string, o: Partial<SessionFile> = {}): string => JSON.stringify({ ...file(id8, o), heartbeatAt: NOW + 600 * MIN }) // alive for the whole test
const held = (id8: string, lane: string, since: number, end: number) => `${heldLine({ lane, sessionName: lane, id8, since, pid: null, end, mode: 'interactive', pausable: true, nextSafe: 'after save', note: 'their slot' })}\n`
const probe = (freeGb: number): Probe => ({ freeGb, diskGb: 40, procs: [] })
const input = (me8: string, files: SessionFile[], o: Partial<GrantInput> = {}): GrantInput => ({ me8, lock: parseLockLine(FREE), files, lanes: [], now: NOW, sync: null, probe: probe(45), gates: DEFAULT_GATES, manual: NO_MANUAL, ...o })
const grants = (files: SessionFile[], o: Partial<GrantInput> = {}): string[] => files.filter(f => decide(input(f.id8, files, o)).kind === 'grant').map(f => f.id8)
const out = (ran: { result?: unknown; text?: string; deny?: string }): string => String(ran.deny ?? ran.result ?? ran.text ?? '')
const ctx = (ran: unknown): string => ((ran as { context?: string[] }).context ?? []).join('\n')
const orderOf = (w: ReturnType<typeof world>): QueueOrder => parseOrder(w.read(ORDER) || null)
const run = async ($: any, args: string, origin: Rec | undefined = { kind: 'composer' }) => String((await $.command.run({ command: 'a5r', args, ...(origin ? { origin } : {}) } as never)).text)

// ---------- the mockup's machine: a holder, four queued sessions, one other session, this one ----------
const TITLES: Record<string, string> = {
  bbbbbbbb: '♾️S2 sync main',
  cccccccc: 'Hệ thống enemy chim mới',
  dddddddd: 'AoBing fox form weapon',
  eeeeeeee: 'Limbshake trong Enemy S2',
  ffffffff: 'Enhance Form material',
  '11111111': 'Walker topic S2 deep dive',
}
const app = (id8: string) => ({ sessionId: `local_${id8}`, title: TITLES[id8], cwd: 'E:\\s2', isArchived: false, isRunning: true, lastActivityAt: new Date(NOW - 2 * MIN).toISOString() })
const CLIENTS = JSON.stringify(Object.keys(TITLES).map(app))
const QUEUED: [string, Partial<Want>][] = [
  ['cccccccc', { minutes: 45, pie: true, requestedAt: NOW - 77 * MIN }],
  ['dddddddd', { minutes: 75, pie: true, requestedAt: NOW - 74 * MIN }],
  ['eeeeeeee', { minutes: 45, build: true, requestedAt: NOW - 65 * MIN }],
  ['ffffffff', { minutes: 15, requestedAt: NOW - 49 * MIN }],
]
const machine = (w: ReturnType<typeof world>, holder = true) => {
  if (holder) {
    w.put(LOCK, held('bbbbbbbb', 'sync-main', NOW - 40 * MIN, NOW + 81 * MIN))
    w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { lane: 'sync-main', title: TITLES.bbbbbbbb, holding: { since: NOW - 40 * MIN, end: NOW + 81 * MIN, extended: 0 } }))
  } else w.put(LOCK, FREE)
  for (const [id8, o] of QUEUED) w.put(`${HF}/editor/${id8}.json`, peer(id8, { title: TITLES[id8], want: want(o) }))
  w.put(`${HF}/editor/11111111.json`, peer('11111111', { title: TITLES['11111111'] }))
  w.put(`${LANES}/${SID('11111111')}.json`, JSON.stringify({ sessionId: SID('11111111'), intent: 'walker', branch: 'x', updatedAt: NOW, lastActiveAt: NOW - 2 * MIN, hasEnded: false }))
}
const pane = async ($: any, w: ReturnType<typeof world>, surface = 'terminal', columns = 80): Promise<Tree> => {
  const P = { ...A5RPANE, surface, props: { ...A5RPANE.props, bodyColumns: columns } } as never
  await $.ui.render(P)
  await w.clock.advance(50) // the reads off the render
  return still(await $.ui.render(P)) as Tree
}
const rowIds = (tree: Tree, block: string, re: RegExp): string[] => (find(tree, block)?.children ?? []).map(c => String((c as Tree).props?.key)).filter(k => re.test(k))

// ---------- A116: the panel ----------
test('A116: one Editor list (the holder, the queue in order, plain reasons, the day\'s line), the other sessions only once, no queue codes', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { mcp__ccd_session_mgmt__list_sessions: CLIENTS } })
  machine(w)
  w.put(`${HF}/leases.jsonl`, `${JSON.stringify({ v: 1, lane: 'x', id8: 'aaaaaaaa', requestedAt: NOW - 120 * MIN, grantedAt: NOW - 82 * MIN, reusedPid: null, minutes: 30, firstEditorSeenAt: NOW - 80 * MIN, pieAt: null, extensions: 0, endAt: NOW - 72 * MIN, endReason: 'released', editorLeftOpen: false, queueAtGrant: 0, pie: false, build: false, pieAborted: false })}\n`)
  await $.session.start(START)
  const tree = await pane($, w)
  expect(text(find(tree, 'hai-queue-head'))).toBe('EDITOR· sync-main has it · 81 min left')
  expect(text(find(tree, 'hai-queue-holder'))).toBe('♾️S2 sync maingranted 14:00 · Editor not open yet')
  expect(text(find(tree, 'hai-queue-cccccccc'))).toBe('Hệ thống enemy chim mớiwaiting 77 min · 45 min · PIE · behind sync-main')
  expect(text(find(tree, 'hai-queue-dddddddd'))).toBe('AoBing fox form weaponwaiting 74 min · 75 min · PIE')
  expect(text(find(tree, 'hai-queue-eeeeeeee'))).toBe('Limbshake trong Enemy S2waiting 65 min · 45 min · build')
  expect(text(find(tree, 'hai-queue-ffffffff'))).toBe('Enhance Form materialwaiting 49 min · 15 min')
  expect(text(find(tree, 'hai-queue-summary'))).toBe('today: 1 turn · usually 38 min wait · 20% of turns spent opening the Editor')
  expect(text(find(tree, 'hai-queue'))).not.toMatch(/wait (held|queue|ram|sync|probe|merge|missing)|no Editor yet|asks \d/)
  // No session in both blocks: the Editor list's five are left out of the other sessions (this one and Walker stay).
  const inEditor = rowIds(tree, 'hai-queue', /^hai-queue-[0-9a-f]{8}$/).map(k => k.slice(-8)).concat('bbbbbbbb')
  const others = rowIds(tree, 'hai-overview', /^hai-session-[0-9a-f]{8}$/).map(k => k.slice(-8))
  expect(others).toEqual([ME8, '11111111'])
  expect(inEditor.filter(id => others.includes(id))).toEqual([])
  expect(text(find(tree, 'hai-overview-head'))).toBe('OTHER SESSIONS · 2')
  expect(find(tree, 'hai-look')).toBeUndefined() // nothing needs a look
})

test('A116: unit: the reasons in plain words: memory, granted next, a pass, a sync freeze, a planned cutoff', () => {
  const head = file('cccccccc', { want: want({ pie: true, minutes: 40, requestedAt: NOW - 50 * MIN }) })
  const build = file('dddddddd', { want: want({ build: true, launch: false, requestedAt: NOW - 20 * MIN }) })
  const later = file('eeeeeeee', { want: want({ requestedAt: NOW - 10 * MIN }) })
  const panel = (files: SessionFile[], o: Partial<GrantInput> = {}, phase: 'none' | 'planned' | 'cutoff' | 'frozen' = 'none') =>
    editorPanel({ grant: input(ME8, files, o), app: { me8: ME8, meTitle: 'me', files, clients: null, isS2Cwd: () => true, names: new Map(), now: NOW }, phase, summary: leaseSummary([], NOW) }).list
  const words = (files: SessionFile[], o: Partial<GrantInput> = {}, phase: 'none' | 'planned' | 'cutoff' | 'frozen' = 'none') => panel(files, o, phase).rows.map(r => r.line)
  expect(words([head, build, later], { probe: probe(27) })).toEqual(['waiting 50 min · 40 min · PIE · needs 38 GB, 27 free', 'waiting 20 min · 30 min · build · goes before 1 for ≤ 30 min', 'waiting 10 min · 30 min · needs 28 GB, 27 free'])
  expect(words([head])).toEqual(['waiting 50 min · 40 min · PIE · granted next'])
  const holder = { session: SID('ffffffff'), id8: 'ffffffff', lane: 'sync-lane' }
  expect(words([head], { sync: newSync(NOW - 5 * MIN, holder, 'x', NOW - 60 * MIN) }, 'frozen')).toEqual([`waiting 50 min · 40 min · PIE · sync freeze until 15:20`])
  expect(words([head], { sync: newSync(NOW + 40 * MIN, holder, 'x', NOW - 60 * MIN) }, 'planned')).toEqual(['waiting 50 min · 40 min · PIE · would cross the sync cutoff 14:50'])
  expect(words([head], { sync: newSync(NOW + 20 * MIN, holder, 'x', NOW - 60 * MIN) }, 'cutoff')).toEqual(['waiting 50 min · 40 min · PIE · sync cutoff, then freeze until 15:45']) // review N2: the cutoff in decide's own words
  // The holder of the sync's own slot reads "sync HH:MM"; no Editor yet reads in words.
  const lock = parseLockLine(held('bbbbbbbb', 'sync-main', NOW - 35 * MIN, NOW + 81 * MIN))
  const p = panel([file('bbbbbbbb', { lane: 'sync-main', want: want({ sync: { at: NOW - 35 * MIN, role: 'holder' } }), holding: { since: NOW - 35 * MIN, end: NOW + 81 * MIN, extended: 0 } })], { lock })
  expect([p.head, p.rows[0]?.line, p.today]).toEqual(['sync-main has it · 81 min left', 'sync 14:05 · Editor not open yet', ''])
})

test('A116: NEEDS A LOOK only for a current verdict that needs the person; unsure, working and done stay off the panel', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { mcp__ccd_session_mgmt__list_sessions: CLIENTS } })
  machine(w)
  const v = (o: Partial<VerdictRow>): VerdictRow => ({ at: NOW - MIN, id8: 'bbbbbbbb', lane: 'sync-main', kind: 'editor', verdict: 'unsure', evidence: 'nothing is needed yet', recommendation: 'check again in 5 min', by: 'cccccccc', source: 'judge', since: NOW - 40 * MIN, ...o })
  w.put(`${HF}/verdicts.json`, JSON.stringify({ v: 1, verdicts: [v({}), v({ verdict: 'working', at: NOW - 2 * MIN })] }))
  await $.session.start(START)
  expect(find(await pane($, w), 'hai-look')).toBeUndefined()
  w.put(`${HF}/verdicts.json`, JSON.stringify({ v: 1, verdicts: [v({ verdict: 'stuck-or-crashed', evidence: 'idle for 25 min while holding the Editor', recommendation: 'wake it, or release its turn' }), v({ at: NOW - 3 * MIN })] }))
  await w.clock.advance(MIN)
  const tree = await pane($, w)
  expect(keys(tree).slice(-2)).toEqual(['hai-look', 'hai-a5r-rules'])
  expect(text(find(tree, 'hai-look'))).toBe('NEEDS A LOOK⚠14:39 sync-main: idle for 25 min while holding the Editor, likely stuck→ wake it, or release its turn')
  expect(needsLook([v({ verdict: 'waiting-on-Hai', evidence: 'it asks which blend to keep', recommendation: 'answer it' }), v({ verdict: 'done' })], NOW)).toEqual([{ what: '14:39 sync-main: it asks which blend to keep, waiting for your answer', next: 'answer it' }])
})

for (const surface of ['terminal', 'desktop'] as const)
  for (const columns of [72, 110])
    test(`A116/A117 (${surface}, ${columns} columns): the Editor list, a selected row's controls, the other sessions and NEEDS A LOOK fit the pane; names shorten, lines and controls wrap`, opts(), async ($, on) => {
      const w = world(on, { ram: '40', out: { mcp__ccd_session_mgmt__list_sessions: CLIENTS } })
      machine(w)
      w.put(`${HF}/verdicts.json`, JSON.stringify({ v: 1, verdicts: [{ at: NOW - MIN, id8: 'bbbbbbbb', lane: 'sync-main', kind: 'editor', verdict: 'stuck-or-crashed', evidence: 'idle for 25 min while holding the Editor, its last message a question nobody answered', recommendation: 'wake it, or release its turn', by: 'cccccccc', source: 'judge', since: NOW - 40 * MIN }] }))
      await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
      await pane($, w, surface, columns)
      await $.ui.press({ plugin: 'a5r', key: 'hai-queue-pick-dddddddd', surface })
      await $.ui.press({ plugin: 'a5r', key: 'hai-queue-pick-bbbbbbbb', surface }) // the selection moves to the holder
      await $.ui.press({ plugin: 'a5r', key: 'hai-queue-pick-dddddddd', surface }) // and back
      const tree = await pane($, w, surface, columns)
      const at = placed(tree, columns)
      for (const key of ['hai-queue', 'hai-overview', 'hai-look']) expect([key, at.get(key)?.x, (at.get(key)?.x ?? 0) + (at.get(key)?.w ?? 0)]).toEqual([key, 2, columns - 2])
      const inner = columns - 4
      for (const key of ['hai-queue-holder', 'hai-queue-cccccccc', 'hai-queue-dddddddd', 'hai-queue-ffffffff', 'hai-queue-summary', 'hai-look-0', `hai-session-${ME8}`]) expect([key, minWidth(find(tree, key)) <= inner]).toEqual([key, true])
      // The selected row (one only) shows its five controls, a row that wraps; the names shorten, the lines wrap.
      expect(all(tree).filter(n => /^hai-queue-.*-ctl$/.test(String(n.props?.key ?? ''))).map(n => n.props?.key)).toEqual(['hai-queue-dddddddd-ctl'])
      const ctl = find(tree, 'hai-queue-dddddddd-ctl')
      expect([ctl?.props?.flexWrap, (ctl?.children ?? []).map(c => [(c as Tree).props?.label, (c as Tree).props?.hotkey])]).toEqual(['wrap', [['Up', 'u'], ['Down', 'd'], ['To top', 't'], ['−15 min', 'm'], ['+15 min', 'p']]])
      expect(find(tree, 'hai-queue-dddddddd-lane')?.children?.[0]).toMatchObject({ type: 'Text', props: { wrap: 'truncate-end' } })
      expect(find(tree, 'hai-queue-dddddddd-line')?.children?.[0]).toMatchObject({ type: 'Text', props: { wrap: 'wrap' } })
      expect(find(tree, 'hai-queue-pick-dddddddd')?.props).toMatchObject({ label: '2', plain: true })
    })

// ---------- A117: the order every session computes ----------
const A = file('aaaaaaaa', { want: want({ requestedAt: NOW - 50 * MIN }) })
const B = file('b2b2b2b2', { want: want({ requestedAt: NOW - 40 * MIN }) })
const C = file('c3c3c3c3', { want: want({ requestedAt: NOW - 30 * MIN }) })
const placedFor = (f: SessionFile, at = NOW - MIN) => ({ id8: f.id8, requestedAt: f.want?.requestedAt ?? 0, isKept: f.want?.isKept === true, at, by: 'the person (panel in x)' })
const orderWith = (pins: SessionFile[], sized: [SessionFile, number][] = []): QueueOrder => ({ v: 1, placed: pins.map(f => placedFor(f)), sized: sized.map(([f, minutes]) => ({ ...placedFor(f), minutes })), changes: [] })

test('A117: unit: a manual order is the order every session computes: the placed sessions first, in his order, the rest first asked first served', () => {
  const files = [A, B, C]
  const m = manualOf(orderWith([C]), files, NOW)
  expect(queueOf(files, [], NOW, null, m).map(f => f.id8)).toEqual([C.id8, A.id8, B.id8])
  expect(queueOf(files, [], NOW, null, manualOf(orderWith([C, B]), files, NOW)).map(f => f.id8)).toEqual([C.id8, B.id8, A.id8])
  expect(queueOf(files, [], NOW, null, NO_MANUAL).map(f => f.id8)).toEqual([A.id8, B.id8, C.id8])
  // Every session reaches the same decision from the same files: only the placed head is granted.
  expect(grants(files, { manual: m })).toEqual([C.id8])
  expect(grants(files)).toEqual([A.id8])
})

test('A117: unit: an entry lasts for that request only: withdrawn, its lease ended (a new request), a kept place after a forced release, or 12 h → first asked first served again', () => {
  const o = orderWith([C])
  const pins = (files: SessionFile[], now = NOW) => manualOf(o, files, now).pins
  expect(pins([A, B, C])).toEqual([C.id8])
  expect(pins([A, B, { ...C, holding: { since: NOW, end: NOW + 30 * MIN, extended: 0 } }])).toEqual([C.id8]) // its turn: granted, not ended
  expect(pins([A, B, { ...C, want: null }])).toEqual([]) // released (or withdrawn): the request is gone
  expect(pins([A, B, { ...C, want: want({ requestedAt: NOW + 5 * MIN }) }])).toEqual([]) // asked again after its turn: a new request
  expect(pins([A, B, { ...C, want: want({ requestedAt: C.want?.requestedAt, isKept: true }) }])).toEqual([]) // A104's kept place is another turn
  expect(pins([A, B, C], NOW + 12 * 60 * MIN)).toEqual([])
  expect(manualOf(o, [A, B], NOW)).toEqual({ pins: [], minutes: {} }) // its session gone: nothing names it
})

test('A117: unit: the sync holder stays first in a cutoff or freeze; A113: a placed head is never passed; minutes set by hand are the grant\'s (a pass stays ≤ 30 min)', () => {
  const holder = file('dddddddd', { want: want({ requestedAt: NOW - 5 * MIN, sync: { at: NOW - 5 * MIN, role: 'holder' } }) })
  const frozen = newSync(NOW - 5 * MIN, { session: SID('dddddddd'), id8: 'dddddddd', lane: 'sync-lane' }, 'x', NOW - 60 * MIN)
  const files = [A, B, holder]
  expect(queueOf(files, [], NOW, frozen, manualOf(orderWith([B]), files, NOW)).map(f => f.id8)).toEqual(['dddddddd', B.id8, A.id8])
  // A memory-held head (gate 28, 27 free) is passed by a later launch:false request, unless the person placed that head.
  const head = file('e5e5e5e5', { want: want({ requestedAt: NOW - 40 * MIN }) })
  const build = file('f6f6f6f6', { want: want({ build: true, launch: false, minutes: 60, requestedAt: NOW - 10 * MIN }) })
  const at27 = { probe: probe(27) }
  expect(grants([head, build], at27)).toEqual([build.id8])
  expect(grants([head, build], { ...at27, manual: manualOf(orderWith([head]), [head, build], NOW) })).toEqual([])
  expect(decide(input(build.id8, [head, build], { ...at27, manual: manualOf(orderWith([head]), [head, build], NOW) }))).toMatchObject({ kind: 'wait', code: 'queue', why: `the Editor is free but ${head.lane} was placed first by the person` })
  expect(decide(input(head.id8, [head, build], { manual: manualOf(orderWith([], [[head, 75]]), [head, build], NOW) }))).toEqual({ kind: 'grant', end: NOW + 75 * MIN, reuse: null })
  expect(decide(input(build.id8, [head, build], { ...at27, manual: manualOf(orderWith([], [[build, 90]]), [head, build], NOW) }))).toEqual({ kind: 'grant', end: NOW + 30 * MIN, reuse: null, pass: head.id8 })
})

// ---------- A117: what a press or a command does (order.ts) ----------
const NAMES: Record<string, string> = { aaaaaaaa: 'Alpha task', b2b2b2b2: 'Beta task', c3c3c3c3: 'Gamma', d4d4d4d4: 'Alpha other' }
const PRESSER = { by: 'the person (panel in tail)', titleOf: (id8: string) => NAMES[id8] ?? '' }
/** The holder of the unit tests: d4d4d4d4, granted 13:40 until 14:50, its lease in its file and its standard HELD line. */
const HOLDER = file('d4d4d4d4', { holding: { since: NOW - 60 * MIN, end: NOW + 10 * MIN, extended: 1 } })
const HOLDER_LOCK = parseLockLine(held('d4d4d4d4', 'lane-d4d4d4d4', NOW - 60 * MIN, NOW + 10 * MIN))
const apply = (files: SessionFile[], a: OrderAction, o: Partial<GrantInput> & { order?: QueueOrder } = {}) => {
  const { order = NO_ORDER, ...g } = o
  return applyOrder(input(ME8, files, g), order, a, PRESSER)
}
const order = (r: ReturnType<typeof applyOrder>) => {
  if (!('kind' in r) || r.kind !== 'order') throw new Error(JSON.stringify(r))
  return r
}
const resized = (r: ReturnType<typeof applyOrder>) => {
  if (!('kind' in r) || r.kind !== 'resize') throw new Error(JSON.stringify(r))
  return r
}

test('A117: unit: Up, Down, To top pin the new order\'s prefix; the rows below stay first asked first served; each change names who it moved', () => {
  const files = [A, B, C]
  const top = order(apply(files, { kind: 'move', how: 'top', who: { name: 'Gamma' } }))
  expect([top.order.placed.map(p => p.id8), top.moved, top.order.changes.map(c => c.moved), top.text]).toEqual([[C.id8, A.id8, B.id8], [C.id8, A.id8, B.id8], [[C.id8, A.id8, B.id8]], 'Gamma moved to the top of the Editor queue: now 1 of 3 (by the person (panel in tail))'])
  const up = order(apply(files, { kind: 'move', how: 'up', who: { id8: B.id8 } }))
  expect([up.order.placed.map(p => p.id8), up.moved, up.text]).toEqual([[B.id8, A.id8], [B.id8, A.id8], 'Beta task moved up in the Editor queue: now 1 of 3 (by the person (panel in tail))'])
  const down = order(apply(files, { kind: 'move', how: 'down', who: { name: 'alpha t' } }))
  expect([down.order.placed.map(p => p.id8), down.moved]).toEqual([[B.id8, A.id8], [B.id8, A.id8]])
  // A later move keeps every row placed before it; an earlier entry keeps its own time.
  const again = order(apply(files, { kind: 'move', how: 'up', who: { name: B.id8 } }, { order: { ...top.order, placed: top.order.placed.map(p => ({ ...p, at: NOW - MIN })) } }))
  expect(again.order.placed.map(p => [p.id8, p.at])).toEqual([[C.id8, NOW - MIN], [B.id8, NOW], [A.id8, NOW - MIN]])
  expect(apply(files, { kind: 'move', how: 'up', who: { id8: A.id8 } })).toEqual({ refusal: 'A5R · Editor order — Alpha task is already first in the queue → nothing to move' })
  expect(apply(files, { kind: 'move', how: 'down', who: { id8: C.id8 } })).toEqual({ refusal: 'A5R · Editor order — Gamma is already last in the queue → nothing to move' })
  const reset = order(apply(files, { kind: 'reset' }, { order: top.order }))
  expect([reset.order.placed, reset.moved]).toEqual([[], [A.id8, B.id8, C.id8]])
  expect('refusal' in apply(files, { kind: 'reset' })).toBe(true)
  // In a freeze the sync's holder stays first: "To top" places the session right after it, and says so.
  const holder = file('e5e5e5e5', { lane: 'sync-lane', want: want({ requestedAt: NOW - 5 * MIN, sync: { at: NOW - 5 * MIN, role: 'holder' } }) })
  const frozen = newSync(NOW - 5 * MIN, { session: SID('e5e5e5e5'), id8: 'e5e5e5e5', lane: 'sync-lane' }, 'x', NOW - 60 * MIN)
  expect(order(apply([A, B, C, holder], { kind: 'move', how: 'top', who: { name: 'Gamma' } }, { sync: frozen })).text).toBe('Gamma moved to the top of the Editor queue: now 2 of 4; sync-lane stays first while its sync is in its cutoff or freeze (by the person (panel in tail))')
})

test('A117: unit: a queued request\'s minutes are kept in the order file (never that session\'s own file), clamped to 5-180; the holder\'s HELD line gets a new end beyond the tool\'s caps', () => {
  const files = [A, B, C]
  const more = order(apply(files, { kind: 'time', who: { name: 'Beta' }, change: { add: 15 } }))
  expect([more.order.sized.map(s => [s.id8, s.minutes]), more.moved, more.text]).toEqual([[[B.id8, 45]], [B.id8], 'Beta task gets 45 min when it is granted (it asked 30) (by the person (panel in tail))'])
  expect(order(apply(files, { kind: 'time', who: { name: 'Beta' }, change: { add: -15 } }, { order: more.order })).order.sized.map(s => s.minutes)).toEqual([30])
  expect(order(apply(files, { kind: 'time', who: { name: 'Beta' }, change: { set: 500 } })).order.sized.map(s => s.minutes)).toEqual([180])
  expect('refusal' in apply(files, { kind: 'time', who: { name: 'Beta' }, change: { set: 30 } })).toBe(true)
  // The holder, extended once already while three wait (a model's extend is refused then): the person's +60 is a new end.
  const r = resized(apply([...files, HOLDER], { kind: 'time', who: { name: 'Alpha other' }, change: { add: 60 } }, { lock: HOLDER_LOCK }))
  expect([parseLockLine(r.line).end, parseLockLine(r.line).id8, r.text]).toEqual(['15:50', 'd4d4d4d4', 'Alpha other\'s lease now ends at 15:50 (it ended at 14:50) (by the person (panel in tail))'])
  expect(parseLockLine(resized(apply([...files, HOLDER], { kind: 'time', who: { id8: 'd4d4d4d4' }, change: { set: 20 } }, { lock: HOLDER_LOCK })).line).end).toBe('15:00') // minutes left
  expect(apply([...files, HOLDER], { kind: 'move', how: 'top', who: { id8: 'd4d4d4d4' } }, { lock: HOLDER_LOCK })).toMatchObject({ refusal: expect.stringContaining('holds the Editor, so it has no place in the queue') })
})

test('A117: unit: a resize is refused for a hand-written line, the sync\'s own slot, another session\'s sync freeze, past a planned cutoff, under 5 min or past 12 h', () => {
  const why = (o: Partial<GrantInput>, change: { add: number } | { set: number } = { add: 15 }, holder = HOLDER) => {
    const r = apply([A, holder], { kind: 'time', who: { id8: 'd4d4d4d4' }, change }, { lock: HOLDER_LOCK, ...o })
    return 'refusal' in r ? r.refusal : 'accepted'
  }
  const other = { session: SID('cccccccc'), id8: 'cccccccc', lane: 'sync-lane' }
  expect(why({ lock: parseLockLine('held by d4d4d4d4 (lane-d4d4d4d4) since 13:40 until 14:50 2026-10-06') })).toContain('is not a standard HELD line naming one session')
  // A press on the row of a hand-written holder naming no session (its id8 is '') reaches the same refusal, not a name miss.
  const hand = apply([A], { kind: 'time', who: { id8: '' }, change: { add: 15 } }, { lock: parseLockLine('1006-walkerext-s9 (artifact-legs) since 14:30, expected end 15:10') })
  expect(hand).toMatchObject({ refusal: expect.stringContaining('is not a standard HELD line naming one session') })
  expect(why({}, { add: 15 }, { ...HOLDER, want: want({ sync: { at: NOW - 5 * MIN, role: 'holder' } }) })).toContain('holds the Editor for the sync, and that slot ends with the sync')
  expect(why({ sync: newSync(NOW - 5 * MIN, other, 'x', NOW - 60 * MIN) })).toContain('is in its freeze → the Editor is the sync\'s')
  expect(why({ sync: newSync(NOW + 25 * MIN, other, 'x', NOW - 60 * MIN) })).toContain('is in its cutoff')
  expect(why({ sync: newSync(NOW + 60 * MIN, other, 'x', NOW - 60 * MIN) }, { add: 30 })).toContain('Alpha other: the lease would end at 15:20, past the sync cutoff 15:10')
  expect(why({ sync: newSync(NOW + 60 * MIN, other, 'x', NOW - 60 * MIN) }, { add: 5 })).toBe('accepted') // ends 14:55, before the cutoff
  expect(why({}, { set: 3 })).toContain('under 5 min from now')
  expect(why({}, { add: 12 * 60 })).toContain('past 12 h from its grant')
})

test('A117: unit: names: an exact name first, else a unique start; two matches and no match are refused; commands and person-only origins', () => {
  const rows = [{ id8: 'aaaaaaaa', names: ['Alpha task', 'lane-a', 'aaaaaaaa'] }, { id8: 'dddddddd', names: ['Alpha other', 'lane-d', 'dddddddd'] }, { id8: 'cccccccc', names: ['Alpha', 'lane-c', 'cccccccc'] }]
  expect(pickByName('alpha', rows)).toEqual({ id8: 'cccccccc' }) // exact beats prefix
  expect(pickByName('alpha t', rows)).toEqual({ id8: 'aaaaaaaa' })
  expect(pickByName('dddd', rows)).toEqual({ id8: 'dddddddd' })
  expect(pickByName('Alpha ', rows)).toEqual({ id8: 'cccccccc' })
  expect(pickByName('lane-', rows)).toMatchObject({ refusal: expect.stringContaining('"lane-" names 3 rows') })
  expect(pickByName('zeta', rows)).toMatchObject({ refusal: expect.stringContaining('no row of the Editor list is named "zeta"') })
  expect(parseEditorCommand('top Limbshake trong')).toEqual({ kind: 'move', how: 'top', who: { name: 'Limbshake trong' } })
  expect(parseEditorCommand('time Enhance Form +15')).toEqual({ kind: 'time', who: { name: 'Enhance Form' }, change: { add: 15 } })
  expect(parseEditorCommand('time Enhance −15')).toEqual({ kind: 'time', who: { name: 'Enhance' }, change: { add: -15 } })
  expect(parseEditorCommand('time sync-main 40')).toEqual({ kind: 'time', who: { name: 'sync-main' }, change: { set: 40 } })
  expect(parseEditorCommand('order reset')).toEqual({ kind: 'reset' })
  expect(parseEditorCommand('')).toEqual({ kind: 'show' })
  expect(parseEditorCommand('time Enhance')).toMatchObject({ usage: expect.stringContaining('is not a command') })
  expect([isPersonOrigin({ kind: 'composer' }), isPersonOrigin({ kind: 'bridge' }), isPersonOrigin(undefined), isPersonOrigin({ kind: 'plugin' }), isPersonOrigin({ kind: 'peer' }), isPersonOrigin({ kind: 'coordinator' }), isPersonOrigin({ kind: 'scheduled-trigger' })]).toEqual([true, true, false, false, false, false, false])
})

test('A117: unit: the HELD line takes a new end (end= and until only); the holder adopts its line\'s end when another session rewrote it; every queue view shows it', () => {
  const line = heldLineAt(HOLDER_LOCK, NOW + 40 * MIN)
  expect(line).toBe(HOLDER_LOCK.raw.replace('end=14:50', 'end=15:20').replace('until 14:50', 'until 15:20'))
  expect([isStandardHeld(HOLDER_LOCK), isStandardHeld(parseLockLine('held by 9b53d3 (avian) since 10:36 until 13:06'))]).toEqual([true, false])
  const h = { since: NOW - 60 * MIN, end: NOW + 10 * MIN, extended: 1 }
  expect(adoptLockEnd(h, parseLockLine(line), NOW)).toEqual({ ...h, end: NOW + 40 * MIN })
  expect(adoptLockEnd({ ...h, end: NOW + 40 * MIN + 30_000 }, parseLockLine(line), NOW).end).toBe(NOW + 40 * MIN + 30_000) // its own write: the same minute
  expect(adoptLockEnd({ ...h, since: NOW - 30 * MIN }, parseLockLine(line), NOW)).toEqual({ ...h, since: NOW - 30 * MIN }) // another lease
  expect(queueView(input(ME8, [A, HOLDER], { lock: parseLockLine(line) })).holder).toMatchObject({ id8: 'd4d4d4d4', end: NOW + 40 * MIN, leftMin: 40, extensions: 1, isSyncSlot: false })
  // Review pass 5: a granted end carries seconds (14:50:40); +1 min is the next whole minute in the line, and it is adopted.
  const odd = { ...HOLDER, holding: { since: NOW - 60 * MIN, end: NOW + 10 * MIN + 40_000, extended: 0 } }
  const one = resized(apply([A, odd], { kind: 'time', who: { id8: 'd4d4d4d4' }, change: { add: 1 } }, { lock: HOLDER_LOCK }))
  expect(parseLockLine(one.line).end).toBe('14:51')
  expect(adoptLockEnd(odd.holding, parseLockLine(one.line), NOW).end).toBe(NOW + 11 * MIN)
  expect(adoptLockEnd(odd.holding, HOLDER_LOCK, NOW).end).toBe(NOW + 10 * MIN + 40_000) // its own line (14:50): the same minute
})

// ---------- A117: engine: the panel, the commands, the tool ----------
test('A117: a press selects a row and To top places it: queue-order.json is written, every session reads the order, the change is logged and told', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { mcp__ccd_session_mgmt__list_sessions: CLIENTS } })
  machine(w)
  w.put(`${HF}/editor/${ME8}.json`, JSON.stringify({ ...blankSession(ME, 'tail-vfx', 'Tail', NOW), want: want({ requestedAt: NOW - 20 * MIN }) }))
  await $.session.start(START)
  let tree = await pane($, w)
  expect(rowIds(tree, 'hai-queue', /-ctl$/)).toEqual([])
  await $.ui.press({ plugin: 'a5r', key: 'hai-queue-pick-eeeeeeee', surface: 'terminal' })
  tree = await pane($, w)
  expect(find(tree, 'hai-queue-eeeeeeee-ctl')).toBeDefined()
  await $.ui.press({ plugin: 'a5r', key: 'hai-queue-eeeeeeee-ctl-top', surface: 'terminal' })
  const o = orderOf(w)
  expect(o.placed.map(p => [p.id8, p.requestedAt, p.by])).toEqual([['eeeeeeee', NOW - 65 * MIN, 'the person (panel in tail-vfx)'], ['cccccccc', NOW - 77 * MIN, 'the person (panel in tail-vfx)'], ['dddddddd', NOW - 74 * MIN, 'the person (panel in tail-vfx)']])
  expect(o.changes.map(c => c.moved)).toEqual([['eeeeeeee', 'cccccccc', 'dddddddd']])
  tree = await pane($, w)
  expect(rowIds(tree, 'hai-queue', /^hai-queue-[0-9a-f]{8}$/)).toEqual(['hai-queue-eeeeeeee', 'hai-queue-cccccccc', 'hai-queue-dddddddd', 'hai-queue-ffffffff', `hai-queue-${ME8}`])
  expect(text(find(tree, 'hai-queue-eeeeeeee-line'))).toBe('waiting 65 min · 45 min · build · placed by hand · behind sync-main')
  expect(w.read(LOG)).toContain('| rule=manual | lane=tail-vfx |')
  expect(w.read(LOG)).toContain('note=Limbshake trong Enemy S2 moved to the top of the Editor queue: now 1 of 5 (by the person (panel in tail-vfx)); moved eeeeeeee,cccccccc,dddddddd')
  expect(((w.calls['ui.toast'] ?? []) as Rec[]).map(t => String(t.text ?? t.message ?? '')).some(t => t.includes('Limbshake trong Enemy S2 moved to the top'))).toBe(true)
  // Every session computes the same queue from the files: once the holder releases, only the placed head is granted.
  const files = ['bbbbbbbb', 'cccccccc', 'dddddddd', 'eeeeeeee', 'ffffffff', ME8].map(id8 => JSON.parse(w.read(`${HF}/editor/${id8}.json`)) as SessionFile)
  const m: ManualOrder = manualOf(o, files, NOW)
  expect(files.filter(f => decide({ ...input(f.id8, files.filter(x => x.id8 !== 'bbbbbbbb'), { manual: m }), me8: f.id8 }).kind === 'grant').map(f => f.id8)).toEqual(['eeeeeeee'])
  // Its turn ends (the lease released: the request cleared) → the order is first asked first served again.
  const after = files.map(f => (f.id8 === 'eeeeeeee' ? { ...f, want: null } : f))
  expect(queueOf(after, [], NOW, null, manualOf(o, after, NOW)).map(f => f.id8)).toEqual(['cccccccc', 'dddddddd', 'ffffffff', ME8])
})

test('A117: a session the person moved is told once, on its next tool result', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { mcp__ccd_session_mgmt__list_sessions: CLIENTS } })
  machine(w)
  w.put(`${HF}/editor/${ME8}.json`, JSON.stringify({ ...blankSession(ME, 'tail-vfx', 'Tail', NOW), want: want({ requestedAt: NOW - 20 * MIN }) }))
  await $.session.start(START)
  await pane($, w)
  await $.ui.press({ plugin: 'a5r', key: `hai-queue-pick-${ME8}`, surface: 'terminal' })
  await pane($, w)
  await $.ui.press({ plugin: 'a5r', key: `hai-queue-${ME8}-ctl-up`, surface: 'terminal' })
  const first = ctx(await $.tool.call({ tool: 'Bash', command: 'git status' } as never))
  expect(first).toContain('A5R · Editor order — ')
  expect(first).toContain('moved up in the Editor queue: now 4 of 5, set by the person (panel in tail-vfx) at 14:40 → nothing to do')
  expect(ctx(await $.tool.call({ tool: 'Bash', command: 'git status' } as never))).not.toContain('Editor order')
})

test('A117: the holder\'s +30 from the panel is accepted past the caps a model\'s extend keeps; the holder adopts the new end at its next minute', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { mcp__ccd_session_mgmt__list_sessions: CLIENTS } })
  machine(w, false)
  // This session holds a lease extended once, while four sessions wait.
  w.put(LOCK, held(ME8, 'tail-vfx', NOW - 40 * MIN, NOW + 5 * MIN))
  w.put(`${HF}/editor/${ME8}.json`, JSON.stringify({ ...blankSession(ME, 'tail-vfx', 'Tail', NOW), want: want({ requestedAt: NOW - 50 * MIN }), holding: { since: NOW - 40 * MIN, end: NOW + 5 * MIN, extended: 1 } }))
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'extend', minutes: 15 } as never))).toContain('wait and this lease was extended once already')
  expect(parseLockLine(w.read(LOCK)).end).toBe('14:45')
  await pane($, w)
  await $.ui.press({ plugin: 'a5r', key: `hai-queue-pick-${ME8}`, surface: 'terminal' })
  const tree = await pane($, w)
  expect((find(tree, `hai-queue-holder-ctl`)?.children ?? []).map(c => (c as Tree).props?.label)).toEqual(['+15 min', '+30 min', '+60 min'])
  await $.ui.press({ plugin: 'a5r', key: 'hai-queue-holder-ctl-add30', surface: 'terminal' })
  expect(parseLockLine(w.read(LOCK)).end).toBe('15:15')
  await w.clock.advance(MIN)
  const mine = JSON.parse(w.read(`${HF}/editor/${ME8}.json`)) as SessionFile
  expect([mine.holding?.end, mine.holding?.extended]).toEqual([NOW + 35 * MIN, 1]) // adopted; no extension counted
  expect(parseLockLine(w.read(LOCK)).end).toBe('15:15') // its own writes keep the new end
  expect(w.read(LOG)).toContain('\'s lease now ends at 15:15 (it ended at 14:45)')
  expect(w.read(ORDER)).toBe('') // a resize writes the lock line only
  expect(ctx(await $.tool.call({ tool: 'Bash', command: 'git status' } as never))).toContain('A5R · Editor lease — the person gave your lease another end: it now ends at 15:15 (it ended at 14:45) → nothing to do')
})

test('A117 (review N1): a resize written by another session\'s A5R is this holder\'s lease at once: an extend in the same minute builds on the new end', opts(), async ($, on) => {
  const w = world(on, { ram: '40' })
  w.put(LOCK, held(ME8, 'tail-vfx', NOW - 20 * MIN, NOW + 10 * MIN))
  w.put(`${HF}/editor/${ME8}.json`, JSON.stringify({ ...blankSession(ME, 'tail-vfx', 'Tail', NOW), want: want({ requestedAt: NOW - 30 * MIN }), holding: { since: NOW - 20 * MIN, end: NOW + 10 * MIN, extended: 0 } }))
  await $.session.start(START)
  // The person pressed +30 in another session: its A5R rewrote this holder's HELD line (14:50 → 15:20); no minute has run here.
  w.put(LOCK, `${heldLineAt(parseLockLine(w.read(LOCK)), NOW + 40 * MIN)}\n`)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'extend', minutes: 15 } as never))).toContain('extended until 15:35')
  expect(parseLockLine(w.read(LOCK)).end).toBe('15:35')
  expect((JSON.parse(w.read(`${HF}/editor/${ME8}.json`)) as SessionFile).holding?.end).toBe(NOW + 55 * MIN)
})

test('A117: a press in a session that does not hold the Editor rewrites the holder\'s HELD line (its file is the holder\'s to write); refused in another session\'s sync freeze', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { mcp__ccd_session_mgmt__list_sessions: CLIENTS } })
  machine(w)
  await $.session.start(START)
  await pane($, w)
  await $.ui.press({ plugin: 'a5r', key: 'hai-queue-pick-bbbbbbbb', surface: 'terminal' })
  await pane($, w)
  const before = w.read(`${HF}/editor/bbbbbbbb.json`)
  await $.ui.press({ plugin: 'a5r', key: 'hai-queue-holder-ctl-add15', surface: 'terminal' })
  expect(parseLockLine(w.read(LOCK))).toMatchObject({ id8: 'bbbbbbbb', end: '16:16' })
  expect(w.read(`${HF}/editor/bbbbbbbb.json`)).toBe(before)
  expect(w.read(ORDER)).toBe('') // the holder's own A5R adopts the end and tells itself (lease.ts adoptLockEnd)
  expect(w.read(LOG)).toContain('| rule=manual |')
  // A sync of another session in its freeze: the Editor is the sync's.
  w.put(`${HF}/sync.json`, JSON.stringify(newSync(NOW - 5 * MIN, { session: SID('11111111'), id8: '11111111', lane: 'sync-lane' }, 'x', NOW - 60 * MIN)))
  expect(await run($, 'editor time sync-main +15')).toContain('is in its freeze → the Editor is the sync\'s')
  expect(parseLockLine(w.read(LOCK)).end).toBe('16:16')
})

test('A117: /a5r editor: the person\'s own command moves, sets minutes, resets; a plugin\'s or a peer\'s run is refused; names are matched or refused', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { mcp__ccd_session_mgmt__list_sessions: CLIENTS } })
  machine(w)
  await $.session.start(START)
  await pane($, w)
  expect(await run($, 'editor')).toContain('A5R · Editor · sync-main has it · 81 min left')
  expect(await run($, 'editor top Limbshake', { kind: 'plugin', name: 'other' })).toBe('A5R · Editor order — only the person changes the Editor queue, and this command came from plugin → request the Editor with the editor tool (action request) and wait for your turn')
  expect(await run($, 'editor top Limbshake', { kind: 'peer' })).toContain('this command came from peer')
  expect(w.read(ORDER)).toBe('')
  expect(await run($, 'editor top e')).toContain('"e" names') // eeeeeeee and Enhance Form, by their names
  expect(await run($, 'editor top nobody')).toContain('no row of the Editor list is named "nobody"')
  expect(await run($, 'editor top Limbshake')).toContain('Limbshake trong Enemy S2 moved to the top of the Editor queue: now 1 of 4 (by the person (command in')
  expect(await run($, 'editor time Enhance +15')).toContain('Enhance Form material gets 30 min when it is granted (it asked 15)')
  expect(orderOf(w).sized.map(s => [s.id8, s.minutes])).toEqual([['ffffffff', 30]])
  expect(text(find(await pane($, w), 'hai-queue-ffffffff-line'))).toBe('waiting 49 min · 30 min (set by hand)')
  // A model reads the same queue in the editor tool's status (it cannot change it).
  const status = JSON.parse(out(await $.tool.call({ tool: EDITOR, action: 'status' } as never)).split('\n').filter(l => !l.startsWith('A5R ·')).join('\n')) as { queue: string[] }
  expect(status.queue).toEqual([
    '1. lane-eeeeeeee (session eeeeeeee): waiting 65 min · 45 min · build · placed by hand · behind sync-main · wait held: their slot',
    '2. lane-cccccccc (session cccccccc): waiting 77 min · 45 min · PIE · placed by hand · wait held: their slot',
    '3. lane-dddddddd (session dddddddd): waiting 74 min · 75 min · PIE · placed by hand · wait held: their slot',
    '4. lane-ffffffff (session ffffffff): waiting 49 min · 30 min (set by hand) · wait held: their slot',
  ])
  expect(await run($, 'editor order reset')).toContain('first asked, first served again')
  expect([orderOf(w).placed, orderOf(w).sized]).toEqual([[], []])
})

test('A117: person-only: the editor tool has no order or resize action, an unknown action changes nothing, and a model\'s edit or command writing queue-order.json is refused', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { mcp__ccd_session_mgmt__list_sessions: CLIENTS } })
  machine(w)
  await $.session.start(START)
  const tools = (w.calls['tool.register'] ?? []) as { name: string; inputSchema: { properties: Record<string, { enum?: string[] }> } }[]
  expect(tools.map(t => t.name)).toEqual(['editor', 'sync'])
  const editor = tools[0]?.inputSchema.properties ?? {}
  expect(editor.action?.enum).toEqual(['request', 'release', 'extend', 'status'])
  expect(Object.keys(editor).sort()).toEqual(['action', 'build', 'dont_save', 'freeGb', 'lane', 'launch', 'minutes', 'mode', 'next_safe', 'note', 'pausable', 'pie', 'pie_stopped', 'what'])
  for (const t of tools) expect(JSON.stringify(t.inputSchema)).not.toMatch(/queue-order|"(up|down|top|reset|order|resize|who)"/)
  for (const action of ['top', 'up', 'order', 'time', 'resize']) await $.tool.call({ tool: EDITOR, action, who: 'cccccccc', minutes: 60 } as never)
  expect(w.read(ORDER)).toBe('')
  expect(parseLockLine(w.read(LOCK)).end).toBe('16:01')
  const deny = refused(await $.tool.call({ tool: 'Write', file_path: ORDER, content: '{"v":1,"placed":[]}' } as never))
  expect(deny).toBe('A5R · Editor order — Saved/A5R/queue-order.json is the person\'s: only his press on the A5R panel or his own /a5r editor command changes it → request the Editor with the editor tool (action request) and wait for your turn')
  expect(refused(await $.tool.call({ tool: 'Bash', command: `echo '{}' > ${ORDER}` } as never))).toContain('Editor order')
  expect(refused(await $.tool.call({ tool: 'PowerShell', command: `Set-Content -Path ${ORDER} -Value '{}'` } as never))).toContain('Editor order')
  expect(refused(await $.tool.call({ tool: 'Bash', command: `cat ${ORDER}` } as never))).toBeUndefined()
  expect([writesOrder(`cat ${ORDER}`), writesOrder(`sed -i s/a/b/ ${ORDER}`), writesOrder(`cp x.json ${ORDER}`)]).toEqual([false, true, true])
  expect(NO_MANUAL).toEqual({ pins: [], minutes: {} })
})

test('A117: an order naming a session that is gone or whose request ended is ignored by every reader and dropped at the next write', opts(), async ($, on) => {
  const w = world(on, { ram: '40', out: { mcp__ccd_session_mgmt__list_sessions: CLIENTS } })
  machine(w)
  const gone = { id8: '99999999', requestedAt: NOW - 90 * MIN, isKept: false, at: NOW - 30 * MIN, by: 'the person (panel in x)' }
  const ended = { id8: 'dddddddd', requestedAt: NOW - 200 * MIN, isKept: false, at: NOW - 30 * MIN, by: 'the person (panel in x)' }
  w.put(ORDER, JSON.stringify({ v: 1, placed: [gone, ended], sized: [{ ...gone, minutes: 90 }], changes: [] }))
  await $.session.start(START)
  const tree = await pane($, w)
  expect(rowIds(tree, 'hai-queue', /^hai-queue-[0-9a-f]{8}$/)).toEqual(['hai-queue-cccccccc', 'hai-queue-dddddddd', 'hai-queue-eeeeeeee', 'hai-queue-ffffffff'])
  expect(text(find(tree, 'hai-queue'))).not.toContain('by hand')
  await run($, 'editor top Enhance')
  expect(orderOf(w).placed.map(p => p.id8)).toEqual(['ffffffff', 'cccccccc', 'dddddddd', 'eeeeeeee'])
  expect(orderOf(w).sized).toEqual([])
})

test('A117: unit: the order file is read field by field; a broken one reads as no order', () => {
  expect(parseOrder('not json')).toEqual(NO_ORDER)
  expect(parseOrder(JSON.stringify({ v: 1, placed: [{ id8: 'AAAAAAAA', requestedAt: 1, at: 2 }, { id8: 3 }], sized: [{ id8: 'b', requestedAt: 1, at: 2 }], changes: [{ at: 1, what: 'x', moved: ['a'] }] }))).toEqual({ v: 1, placed: [{ id8: 'aaaaaaaa', requestedAt: 1, isKept: false, at: 2, by: '' }], sized: [], changes: [{ at: 1, by: '', what: 'x', moved: ['a'] }] })
  const rec: LeaseRecord[] = []
  expect(leaseSummary(rec, NOW).leases).toBe(0)
})
