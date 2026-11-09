// Rev 45 (L-49, L-50), the host side of A135-A141 on closures (no `$`: register.ts hands it this session's state once and
// the engine's calls per call). The conductor's minute: its claim, the start in flight, whose turn or what else is due, the
// count and the alarm. A lease is never written here: a started session takes the lock itself, through decide, once its own
// process runs, so its clock starts when it answers and a failed send cannot touch one. The rules are wake.ts's.
import { syncWakeDue } from './autosync.ts'
import { claimIn, hhmm, parseSessionFile, queueIn, type GrantInput, type OrchestrateEvent, type Phase, type SessionFile, type SyncFile, type Want } from './coord.ts'
import type { FileIo } from './hostio.ts'
import type { LeaseRecord } from './lease.ts'
import { prunable, pruneArgv } from './truth.ts'
import type { Need } from './syncplan.ts'
import { CONDUCTOR_FILE, IDLE_FILE, NO_IDLE, NO_WAKE, PARK_MS, PAUSE_MS, REFUSAL_KEEP_MS, REFUSED_RETRIES, REFUSED_DIR, SEND_WINDOW_MS, WAKE_ANSWER_MS, WAKE_FILE, TRIED_KEEP_MS, TURN_KEEP_MS, afterMiss, alarmText, budgetHold, conductorOf, deskDir, idleLine, isAlarmDue, isResting, isStopped, leaseSince, mayConduct, nextIdle, nightLine, oldLine, parseConductor, parseDeskRow, parseIdle, parseRefusal, parseWake, pausedCause, readSend, refusalMessage, sendInput, stoppedRefusals, startOutcome, syncMessage, turnMessage, turnToStart, withRow, type DeskRow, type IdleFile, type MissKind, type Refusal, type Start, type SyncWake, type WakeFile, type WakeOutcome, type WakeStatus, type WakeWhy } from './wake.ts'

/** The engine's calls for one minute. */
export type WakeIo = FileIo & {
  /** The route's one call (wake.ts sendInput); never rejects, and gives up after a minute. */
  call: (input: Record<string, unknown>) => Promise<{ deny?: string; text?: string } | null>
  /** Where the desktop app keeps its session records, as the engine's environment says (absent outside the app). */
  deskPlace: () => Promise<{ appData?: string; account?: string; org?: string }>
  /** A shared file by read-compare-write (register.ts writeChecked). */
  writeChecked: (path: string, expected: string | null, text: string) => Promise<boolean>
  claimAlert: (key: string) => Promise<boolean>
  log: (e: OrchestrateEvent) => Promise<void>
  /** A native notification; false when the engine could not raise one. */
  notify: (text: string) => Promise<boolean>
  toast: (text: string) => void
  /** Whether what a refusal waited for is free now. */
  isGitFree: (now: number) => Promise<boolean>
  heldNeeds: (now: number) => Promise<ReadonlySet<Need>>
}
export type WakeState = {
  me8: () => string
  me: () => SessionFile | null
  grantInput: (now: number) => GrantInput
  leases: () => readonly LeaseRecord[]
  dir: () => string
  freeWindow: (now: number) => string | null
  freeGb: () => number | null
  titleOf: (id8: string) => string
  /** The sync on file and its phase now (A146). */
  sync: (now: number) => { sync: SyncFile | null; phase: Phase }
}

/** Whether the engine raised a native notification; an engine without one: no, and the alarm is a toast. */
export const isSentBy = async (notify: () => Promise<{ isSent: boolean }>): Promise<boolean> => {
  try {
    return (await notify()).isSent
  } catch {
    return false
  }
}

/** What one minute's step came to: a session was started, the work is held back and why, or nothing waits: A141's whole measure of work is a request or an open refusal. */
type Step = { kind: 'started' } | { kind: 'held'; cause: string } | { kind: 'nothing' }
const NOTHING: Step = { kind: 'nothing' }
const STARTED: Step = { kind: 'started' }
const held = (cause: string): Step => ({ kind: 'held', cause })

export const conductor = (h: WakeState) => {
  /** In this process: the last files read for every session's panel, and the desktop's records by CLI id. */
  let wake: WakeFile = NO_WAKE
  let idle: IdleFile = NO_IDLE
  let isDeskKnown = false
  const desk = new Map<string, { row: DeskRow; mtime: number; name: string }>()
  const wakePath = (): string => `${h.dir()}/${WAKE_FILE}`
  const idlePath = (): string => `${h.dir()}/${IDLE_FILE}`
  const myName = (): string => h.titleOf(h.me8()) || (h.me()?.lane ?? h.me8())
  const conductorPath = (): string => `${h.dir()}/${CONDUCTOR_FILE}`
  const nameOf = (f: { id8: string; lane: string }): string => h.titleOf(f.id8) || f.lane
  const event = (f: { lane: string; id8: string; lastTurnAt?: number }, rule: OrchestrateEvent['rule'], note: string, now: number, acted = true): OrchestrateEvent => ({ at: now, rule, lane: f.lane, id8: f.id8, procs: [], liveness: 'gone', lastTurnAt: f.lastTurnAt ?? null, agents: null, build: false, acted, note })
  const save = async (io: WakeIo, w: WakeFile, now: number): Promise<void> => {
    const recent = (m: Record<string, number>, keepMs: number) => Object.fromEntries(Object.entries(m).filter(([, at]) => now - at < keepMs)) // their only deleter
    wake = { ...w, triedAt: recent(w.triedAt, TRIED_KEEP_MS), turnAt: recent(w.turnAt, TURN_KEEP_MS), spent: w.spent.filter(s => now - s.at < SEND_WINDOW_MS) }
    await io.write(wakePath(), JSON.stringify(wake))
  }

  /** A138: the desktop's records, read again only when they changed. Outside the desktop app there are none. */
  const readDesk = async (io: WakeIo): Promise<void> => {
    const p = await io.deskPlace()
    const dir = deskDir(p.appData, p.account, p.org)
    const listed = dir ? (await io.list(dir)).filter(e => /^local_[\w-]+\.json$/.test(e.name)) : []
    const known = new Map([...desk.values()].map(d => [d.name, d]))
    for (const e of listed) {
      if (known.get(e.name)?.mtime === e.mtimeMs) continue
      const row = parseDeskRow(await io.read(`${dir}/${e.name}`))
      if (row) desk.set(row.cli, { row, mtime: e.mtimeMs, name: e.name })
    }
    const names = new Set(listed.map(e => e.name))
    if (names.size > 0) for (const [cli, d] of desk) if (!names.has(d.name)) desk.delete(cli) // a deleted session
    isDeskKnown = desk.has((h.me()?.session ?? '').toLowerCase()) // the folder counts only with this session's own record in it
  }
  const archived = (): ReadonlySet<string> => new Set([...desk.values()].filter(d => d.row.isArchived).map(d => d.row.cli.slice(0, 8)))

  /** Another session's request by read-compare-write: `change` of what it reads now; nothing when it asks anew or has answered
   * since `since`. */
  const rewrite = async (io: WakeIo, s: { id8: string; requestedAt: number }, since: number, change: (want: Want) => Want | null): Promise<{ isWritten: boolean; to: Want | null }> => {
    const path = `${h.dir()}/editor/${s.id8}.json`
    const raw = await io.read(path)
    const cur = parseSessionFile(raw)
    if (!cur?.want || cur.want.requestedAt !== s.requestedAt || cur.heartbeatAt > since) return { isWritten: false, to: null }
    const to = change(cur.want)
    if (to === cur.want) return { isWritten: false, to }
    return { isWritten: await io.writeChecked(path, raw, JSON.stringify({ ...cur, want: to })), to }
  }

  /** A136: its request after a miss (wake.ts afterMiss); a withdrawal and a rest are logged, with the writer. */
  const miss = async (io: WakeIo, s: { id8: string; lane: string; requestedAt: number }, since: number, kind: MissKind, why: string, now: number): Promise<void> => {
    const r = await rewrite(io, s, since, w => afterMiss(w, kind, now))
    if (!r.isWritten) return
    if (r.to === null) await io.log(event(s, 'withdrawn', `its request withdrawn by ${myName()}: started twice with no answer (${why})`, now))
    else if (r.to.parkedUntil === now + PARK_MS) await io.log(event(s, 'woke', `turn: parked until ${hhmm(r.to.parkedUntil)} tomorrow: ${REFUSED_RETRIES + 1} sends refused with no answer`, now, false))
  }

  /** A137 / A136: one start, sent by one A5R (the alert claim). A refused send stands until the heartbeat says (a send can
   * report undelivered and still work). No address, or the engine's loop guard: nothing went, a miss now. A146: with `sync`, it
   * is the sync holder's start, kept in its own slot (`syncWake`, beside the one start in flight: Fable 1) on every outcome but
   * another conductor at it this minute or one that cannot start a session (then a conductor that can tries next minute). */
  const start = async (io: WakeIo, s: { f: SessionFile; why: WakeWhy; text: string; requestedAt: number | null; sync?: SyncFile }, now: number): Promise<Step> => {
    const why = s.sync ? `sync ${s.sync.id}` : s.why
    const turn = s.requestedAt === null ? null : { id8: s.f.id8, lane: s.f.lane, requestedAt: s.requestedAt }
    const slot: Start = { id8: s.f.id8, lane: s.f.lane, why: s.why, at: now, requestedAt: s.requestedAt }
    /** wake.json with this start in its slot: `sent` the start that went, null when nothing went. */
    const keep = (w: WakeFile, sent: Start | null = null): Promise<void> =>
      save(io, { ...w, ...(s.sync ? { syncWake: { ...(sent ?? slot), id: s.sync.id, sent: sent !== null } } : sent ? { current: sent } : {}) }, now)
    /** Nothing can go: the request is moved so it blocks nobody, and it spends nothing; a sync's start is kept as not sent
     * unless `isKept` (written already) or it is a conductor's own limit. */
    const hold = async (cause: string, isKept = false): Promise<Step> => {
      if (turn) await miss(io, turn, now, 'moved', cause, now)
      if (s.sync && !isKept) await keep(wake)
      return held(cause)
    }
    // A slow pass: another conductor may have taken over and started someone since this tick read the files; read again
    // before anything is written (Fable minor). A sync's start only stops for the same sync's start.
    const latest = parseWake(await io.read(wakePath()))
    const isTaken = s.sync ? latest.syncWake?.id === s.sync.id : latest.current !== null
    if (parseConductor(await io.read(conductorPath()))?.id8 !== h.me8() || isTaken) return held('another conductor went on meanwhile')
    wake = latest
    if (wake.pausedUntil > now) return hold(pausedCause(wake.pausedBy ?? myName()))
    if (!isDeskKnown) {
      if (await io.claimAlert(`cannot-start-${s.f.id8}-${Math.floor(now / PAUSE_MS)}`)) await io.log(event(s.f, 'woke', `${why}: cannot start from here: this session is not in the desktop app's list; its request is kept`, now, false))
      return hold('this conductor cannot start a session from here', true)
    }
    const overBudget = budgetHold(wake, s.why, now)
    if (overBudget) return hold(overBudget)
    await io.write(conductorPath(), JSON.stringify({ id8: h.me8(), at: await io.now() }))
    const record = desk.get(s.f.session.toLowerCase())?.row
    if (record?.isHeldForPerson) {
      const isDue = now - (wake.triedAt[s.f.id8] ?? 0) >= PAUSE_MS
      if (isDue) {
        await io.log(event(s.f, 'woke', `${why}: the app holds this session for its person (${record.wakes} wakes since its person typed): nothing sent`, now, false))
        await keep({ ...wake, triedAt: { ...wake.triedAt, [s.f.id8]: now } })
      }
      return hold(`the app holds ${nameOf(s.f)} for its person`, isDue)
    }
    if (!(await io.claimAlert(`wake-${s.f.id8}-${Math.floor(now / 60_000)}`))) return held(`another A5R started ${nameOf(s.f)} just now`) // two conductors in one handover
    const row = (outcome: WakeOutcome) => ({ at: now, id8: s.f.id8, lane: s.f.lane, why: s.why, outcome })
    const triedAt = { ...wake.triedAt, [s.f.id8]: now }
    if (!record) {
      await io.log(event(s.f, 'woke', `${why}: no desktop record for this session, so nothing can start it`, now, false))
      await keep({ ...withRow(wake, row('no-address')), triedAt })
      if (turn) await miss(io, turn, now, 'real', 'no desktop record', now)
      return STARTED
    }
    const wakes = `${record.wakes} wakes since its person typed`
    const result = readSend(await io.call(sendInput(record.local, s.text)))
    if (result.kind === 'loop-paused') {
      await io.log(event(s.f, 'woke', `${why}: loop-paused: ${result.reason}; ${wakes}`, now, false))
      const isFirst = wake.pausedSince === 0
      await keep({ ...(isFirst ? withRow(wake, row('loop-paused')) : wake), pausedUntil: now + PAUSE_MS, pausedSince: wake.pausedSince || now, pausedBy: myName(), pausedId: h.me8() }) // nothing went: no attempt on record
      if (turn) await miss(io, turn, now, 'moved', 'loop-paused', now)
      if (isFirst) await alarm(io, pausedCause(myName()), now)
      return held(pausedCause(myName()))
    }
    await io.log(event(s.f, 'woke', `${why}: ${result.kind === 'sent' ? `sent to ${record.local}, waiting for its heartbeat` : `the send reported "${result.reason}", waiting for its heartbeat anyway`}; ${wakes}`, now))
    const spent = [...wake.spent, { at: now, ...(result.kind === 'refused' ? { refused: true as const } : {}) }]
    const sent: Start = { ...slot, ...(result.kind === 'refused' ? { refused: result.reason.slice(0, 200) } : {}) }
    await keep({ ...wake, spent, ...(result.kind === 'sent' ? { pausedSince: 0, pausedBy: undefined, pausedId: undefined, lastFailure: undefined } : {}), ...(s.why === 'turn' ? { turnAt: { ...wake.turnAt, [s.f.id8]: now } } : {}), triedAt }, sent)
    if (turn && result.kind === 'refused') await miss(io, turn, now, 'moved', 'refused', now) // it blocks nobody while the heartbeat decides; an answer undoes this
    return STARTED
  }

  /** A start that went, settled once (wake.ts startOutcome): logged as `rule=woke` (`label`), a row on record, an answer clearing
   * the refused sends (the route works); `tail`: what its own slot becomes. The outcome, or null while it is still waited for. */
  const settleStart = async (io: WakeIo, x: GrantInput, now: number, cur: Start, label: string, tail: (o: WakeOutcome) => Partial<WakeFile>): Promise<WakeOutcome | null> => {
    const outcome = startOutcome(cur, x.files, now)
    if (!outcome) return null
    await io.log(event(cur, 'woke', `${label}: ${outcome} ${Math.round((now - cur.at) / 60_000)} min after the start at ${hhmm(cur.at)}`, now))
    const answers = outcome === 'answered' ? { spent: wake.spent.map(s => ({ at: s.at })), lastFailure: undefined } : {}
    await save(io, { ...withRow(wake, { at: now, id8: cur.id8, lane: cur.lane, why: cur.why, outcome }), ...answers, ...tail(outcome) }, now)
    return outcome
  }
  /** The start in flight: answered, missed after 5 min, or still waited for (one at a time). True while it holds this minute;
   * settling one ends the minute too: what this pass read of its files is old now. */
  const settle = async (io: WakeIo, x: GrantInput, now: number): Promise<boolean> => {
    const cur = wake.current
    if (!cur) return false
    if (parseConductor(await io.read(conductorPath()))?.id8 !== h.me8()) return true // another conductor has it now: its to settle
    const outcome = await settleStart(io, x, now, cur, cur.why, o => ({ current: null, ...(o === 'no-answer' && cur.refused ? { lastFailure: `the send was refused: ${cur.refused}` } : {}) }))
    if (outcome === 'no-answer' && cur.requestedAt !== null) await miss(io, { id8: cur.id8, lane: cur.lane, requestedAt: cur.requestedAt }, cur.at, cur.refused === undefined ? 'real' : 'refused', 'no-answer', now)
    return true
  }

  const isFreed = async (io: WakeIo, r: Refusal, x: GrantInput, now: number): Promise<boolean> => {
    const needs = await io.heldNeeds(now)
    if (r.kind === 'git') return !needs.has('git') && (await io.isGitFree(now))
    return !(r.needs ?? []).some(n => needs.has(n) || (n === 'editor' && claimIn(x)?.kind === 'focus'))
  }
  /** A137: the next stopped session refused git or the freeze whose wait is over: started once per refusal, in order; a refusal
   * spent is cleared by read-compare-write, so a newer one stands. */
  const refusalStep = async (io: WakeIo, x: GrantInput, now: number): Promise<Step> => {
    const dir = `${h.dir()}/${REFUSED_DIR}`
    const read = await Promise.all((await io.list(dir)).filter(f => f.name.endsWith('.json') && now - f.mtimeMs < REFUSAL_KEEP_MS).map(async f => ({ path: `${dir}/${f.name}`, raw: await io.read(`${dir}/${f.name}`) })))
    const rs = read.flatMap(o => {
      const r = parseRefusal(o.raw)
      return r ? [{ ...r, ...o }] : []
    })
    const off = archived()
    const fileOf = (r: Refusal) => x.files.find(o => o.id8 === r.id8)
    const open = stoppedRefusals(rs, x.files, x.lanes, now).filter(r => !off.has(r.id8) && (!isDeskKnown || desk.has((fileOf(r)?.session ?? '').toLowerCase()))) // from here, one the app does not list has no way on
    for (const r of open) {
      const f = fileOf(r)
      if (!f || !desk.has(f.session.toLowerCase()) || !(await isFreed(io, r, x, now))) continue // no record: an app conductor can still act on it
      const step = await start(io, { f, why: r.kind, text: refusalMessage(r), requestedAt: null }, now)
      if (step.kind === 'started') {
        await io.writeChecked(r.path, r.raw, 'null')
        return step // one at a time
      }
      if (wake.pausedUntil > now) return step // a pause or a held target spends no refusal; a target the app holds lets the next go
    }
    return open.length > 0 ? held(`${open.length} stopped session${open.length === 1 ? ' waits' : 's wait'} for what refused them`) : NOTHING
  }

  /** A141: logged, then a native notification when the engine can, else a toast. */
  const alarm = async (io: WakeIo, cause: string, now: number): Promise<void> => {
    const text = alarmText(idle.run, cause)
    await io.log({ ...event({ lane: h.me()?.lane ?? '', id8: h.me8() }, 'idle-with-work', text, now), liveness: 'alive' })
    if (!(await io.notify(text))) io.toast(text)
  }

  /** A136: a session started for its turn whose lease then ended idle with no Editor use (a stricter permission mode can do this:
   * it answers, takes the lock, does nothing): a real miss on its next request, the second in a row withdraws it. True when it did. */
  const idleLoop = async (io: WakeIo, f: SessionFile, now: number): Promise<boolean> => {
    const at = wake.turnAt[f.id8]
    const lease = at === undefined || !f.want ? null : leaseSince(h.leases(), f.id8, at)
    if (!lease || !f.want) return false
    const { [f.id8]: _spent, ...turnAt } = wake.turnAt
    if (lease === 'used') {
      const { [f.id8]: _idle, ...idleStarts } = wake.idleStarts
      await save(io, { ...wake, turnAt, idleStarts }, now)
      return false
    }
    const count = (wake.idleStarts[f.id8] ?? 0) + 1
    await save(io, { ...wake, turnAt, idleStarts: { ...wake.idleStarts, [f.id8]: count } }, now)
    const s = { id8: f.id8, lane: f.lane, requestedAt: f.want.requestedAt }
    if (count >= 2) {
      if ((await rewrite(io, s, now, () => null)).isWritten) await io.log(event(f, 'withdrawn', `its request withdrawn by ${myName()}: two leases in a row idle with no Editor use after a start`, now))
    } else await miss(io, s, now, 'real', 'its lease went idle with no Editor use', now)
    return true
  }

  /** A146: a planned sync's holder quiet in its cutoff is started once (autosync.ts syncWakeDue), ahead of the start in flight;
   * start keeps it in its own slot (`syncWake`), so the hand-over (autosync.ts) waits for its answer only when a send went; a
   * start that went is settled beside the one in flight. */
  const syncStep = async (io: WakeIo, x: GrantInput, now: number): Promise<Step> => {
    const w = wake.syncWake
    if (w?.sent && !w.outcome) await settleStart(io, x, now, w, `sync ${w.id}`, o => ({ syncWake: { ...w, outcome: o } }))
    const s = syncWakeDue({ ...h.sync(now), files: x.files, lanes: x.lanes, now, woke: wake.syncWake ?? null })
    if (!s || !isDeskKnown) return NOTHING // from outside the desktop app nothing can go: a conductor that can send takes it
    const f = x.files.find(o => o.id8 === s.holder.id8)
    if (f) return start(io, { f, why: 'sync', text: syncMessage(s), requestedAt: null, sync: s }, now)
    await io.log(event(s.holder, 'woke', `sync ${s.id}: no A5R file for its holder, so nothing can start it`, now, false))
    await save(io, { ...wake, syncWake: { id8: s.holder.id8, lane: s.holder.lane, why: 'sync', at: now, requestedAt: null, id: s.id, sent: false } }, now)
    return held(`the sync's holder ${s.holder.lane} has no A5R file`)
  }

  /** What the conductor does in its minute: one start at a time, a sync holder's start aside (Fable 1: ahead of the one in flight,
   * which never starves it). `again`: A141's one more try, the wait before a retry aside. */
  const act = async (io: WakeIo, x: GrantInput, now: number, again = false): Promise<Step> => {
    const synced = await syncStep(io, x, now)
    if (synced.kind !== 'nothing') return synced
    const inFlight = wake.current
    if (await settle(io, x, now)) return held(`${inFlight?.lane} was started at ${hhmm(inFlight?.at ?? now)} and has not asked yet`)
    const off = archived()
    const resting = (f: SessionFile): boolean => off.has(f.id8) || (f.want !== null && isStopped(f, x.files, x.lanes, now) && isResting(f.want, wake.triedAt[f.id8] ?? 0, now, again))
    for (const f of queueIn(x)) {
      if (!isStopped(f, x.files, x.lanes, now)) break
      if (f.want && !f.want.movedBack && resting(f)) await miss(io, { id8: f.id8, lane: f.lane, requestedAt: f.want.requestedAt }, now, 'moved', 'resting', now) // it answered and stopped again: it blocks nobody while it rests
    }
    const turn = turnToStart(x, resting)
    if (turn?.want) {
      if (await idleLoop(io, turn, now)) return held(`${turn.lane} let its last lease go idle`)
      const minutes = x.manual.minutes[turn.id8] ?? turn.want.minutes
      return start(io, { f: turn, why: 'turn', text: turnMessage(turn.want, minutes, now), requestedAt: turn.want.requestedAt }, now)
    }
    const refused = await refusalStep(io, x, now)
    if (refused.kind !== 'nothing') return refused
    const queued = queueIn(x)
    if (queued.length > 0 && wake.pausedUntil > now) return held(pausedCause(wake.pausedBy ?? myName()))
    return queued.length > 0 ? held(wake.lastFailure ?? `${queued.length} queued, held back by the Editor's gates (memory ${h.freeGb() ?? '?'} GB)`) : NOTHING
  }

  const stoppedNow = (now: number): number => {
    const x = h.grantInput(now)
    return x.files.filter(f => isStopped(f, x.files, x.lanes, now)).length
  }
  /** A137: its own refusal ends once what it waited for is free: it is alive and heard that from its own A5R. */
  const clearOwn = async (io: WakeIo, now: number): Promise<void> => {
    const path = `${h.dir()}/${REFUSED_DIR}/${h.me8()}.json`
    const raw = await io.read(path)
    const r = parseRefusal(raw)
    if (r && (await isFreed(io, r, h.grantInput(now), now))) await io.writeChecked(path, raw, 'null')
  }

  return {
    /** The minute: every session reads what the panel shows and clears its own refusal; one conducts. */
    tick: async (io: WakeIo): Promise<void> => {
      const now = await io.now() // the tick's earlier steps may have been slow
      wake = parseWake(await io.read(wakePath()))
      idle = parseIdle(await io.read(idlePath()))
      await clearOwn(io, now)
      await readDesk(io) // whether it can send decides who conducts, and every session's tidy reads what is archived
      const me8 = h.me8()
      const x = h.grantInput(now)
      const path = conductorPath()
      const raw = await io.read(path)
      const claim = parseConductor(raw)
      const heir = conductorOf(x.files, now)
      const sends = (id8: string | null | undefined): boolean => x.files.find(f => f.id8 === id8)?.sends === true
      if (!mayConduct(me8, heir, claim, now, !sends(claim?.id8) && sends(heir)) || !(await io.writeChecked(path, raw, JSON.stringify({ id8: me8, at: now })))) return
      const hadStart = wake.current !== null
      const step = await act(io, x, now)
      idle = nextIdle(idle, { isFree: h.freeWindow(now) !== null, hasWork: step.kind !== 'nothing', now })
      if (isAlarmDue(idle)) {
        idle = { ...idle, alarmed: true }
        const retried = step.kind === 'started' || hadStart ? step : await act(io, x, now, true) // what this minute settled was read before it
        const cause = (s: Step): string => (s.kind === 'held' ? s.cause : '')
        await alarm(io, cause(retried) || cause(step) || 'the conductor found work and could not start it', now)
      }
      if (idle.lastAt === now) await io.write(idlePath(), JSON.stringify(idle))
    },
    /** A137: this session was refused by the git turn or the freeze: on file at once (its process may stop before its minute). */
    refused: async (io: FileIo, r: Omit<Refusal, 'v' | 'id8' | 'at'>, now: number): Promise<void> => {
      const me8 = h.me8()
      if (!me8) return
      const path = `${h.dir()}/${REFUSED_DIR}/${me8}.json`
      const had = parseRefusal(await io.read(path))
      await io.write(path, JSON.stringify({ v: 1, id8: me8, at: had?.kind === r.kind ? had.at : now, ...r })) // a retry keeps its place in the order
    },
    /** A138: this session's person typed: the engine's count starts over, so its own pause and its count of sends do. */
    typed: async (io: WakeIo): Promise<void> => {
      const now = await io.now()
      const w = parseWake(await io.read(wakePath()))
      if (parseConductor(await io.read(conductorPath()))?.id8 !== h.me8() || (w.pausedSince === 0 && w.spent.length === 0)) return
      const isMine = w.pausedId === undefined || w.pausedId === h.me8()
      await save(io, { ...w, spent: [], ...(isMine ? { pausedUntil: 0, pausedSince: 0, pausedBy: undefined, pausedId: undefined, lastFailure: undefined } : {}) }, now)
    },
    /** A137 / Fable 6: the daily prune: refusals past their keep. */
    prune: async (io: FileIo, now: number): Promise<void> => {
      const dir = `${h.dir()}/${REFUSED_DIR}`
      const old = prunable(await io.list(dir), now, REFUSAL_KEEP_MS)
      if (old.length > 0) await io.run(pruneArgv(dir, old), 60_000)
    },
    /** A135: its request withdrawn, by the person or by age. */
    withdraw: async (io: WakeIo, id8: string, requestedAt: number, now: number): Promise<boolean> => (await rewrite(io, { id8, requestedAt }, now, () => null)).isWritten,
    /** A135: the sessions the app has archived. */
    archived,
    /** A146: the last start of a sync's holder, read fresh (the hand-over and the cancel wait for its answer). */
    syncWake: async (io: FileIo): Promise<SyncWake | null> => parseWake(await io.read(wakePath())).syncWake ?? null,
    /** A140: whether this session can start another (it runs inside the desktop app). */
    canSend: (): boolean => isDeskKnown,
    /** A139 / A141: the panel's line. */
    line: (now: number): string => [idleLine(idle, { now, queued: queueIn(h.grantInput(now)).length, isFree: h.freeWindow(now) !== null }), oldLine(h.grantInput(now).files, now)].filter(Boolean).join(' · '),
    /** A139: how many requests have stopped sessions. */
    stoppedCount: stoppedNow,
    /** A139: `/a5r status`'s line on last night, with its leading space ('' when nothing ran). */
    night: (now: number): string => {
      const line = nightLine(wake, h.leases(), now)
      return line ? ` ${line}` : ''
    },
    /** A141: for status.json. */
    status: (now: number): WakeStatus => ({ stopped: stoppedNow(now), idleWithWork: { run: idle.run, days: idle.days, nights: idle.nights }, starting: wake.current ? { lane: wake.current.lane, id8: wake.current.id8, why: wake.current.why, at: wake.current.at } : null, pausedUntil: wake.pausedUntil > now ? wake.pausedUntil : null }),
  }
}
