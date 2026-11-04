// Rev 45 (L-49, L-50), the host side of A135-A141 on closures (no `$`: register.ts hands it this session's state once and
// the engine's calls per call). The conductor's minute: its claim, the start in flight, whose turn or what else is due, the
// count and the alarm. A lease is never written here: a started session takes the lock itself, through decide, once its own
// process runs, so its clock starts when it answers and a failed send cannot touch one. The rules are wake.ts's.
import { claimIn, hhmm, livenessOf, parseSessionFile, queueIn, type GrantInput, type OrchestrateEvent, type SessionFile, type Want } from './coord.ts'
import type { FileIo } from './hostio.ts'
import type { TranscriptEvent } from './judge.ts'
import type { LeaseRecord } from './lease.ts'
import { NUDGE_MAX } from './nudge.ts'
import { STALE_WANT_MS } from './truth.ts'
import type { Need } from './syncplan.ts'
import { CONDUCTOR_FILE, IDLE_FILE, NO_IDLE, NO_WAKE, PAUSE_MS, REFUSED_DIR, WAKE_ANSWER_MS, WAKE_FILE, WORK_AGAIN_MS, WORK_SETTLE_MS, afterMiss, alarmText, conductorOf, deskDir, hasWork, idleLine, isAlarmDue, isStopped, lastOutcome, mayConduct, nextIdle, nightLine, parseConductor, parseDeskRow, parseIdle, parseRefusal, parseWake, pausedCause, readSend, refusalMessage, retryAfter, sendInput, stoppedRefusals, turnMessage, turnToStart, withRow, wordsOf, workFits, workMessage, workPool, type DeskRow, type IdleFile, type Refusal, type WakeFile, type WakeOutcome, type WakeStatus, type WakeWhy, type Words } from './wake.ts'

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
  /** The tail of a session's own transcript. */
  events: (session: string) => Promise<TranscriptEvent[]>
  /** A91: the last nudge in a session's inbox, and one more written there. */
  nudgedAt: (id8: string) => Promise<number>
  nudge: (id8: string, window: string, now: number, freeGb: number | null) => Promise<void>
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
}

/** What one minute's step came to: a session was started (or told), the work is held back and why, or nothing waits. */
type Step = { kind: 'started' } | { kind: 'held'; cause: string } | { kind: 'nothing' }
const NOTHING: Step = { kind: 'nothing' }
const STARTED: Step = { kind: 'started' }
const held = (cause: string): Step => ({ kind: 'held', cause })

export const conductor = (h: WakeState) => {
  /** In this process: the last files read for every session's panel, the desktop's records by CLI id, and the tails read. */
  let wake: WakeFile = NO_WAKE
  let idle: IdleFile = NO_IDLE
  let isDeskKnown = false
  const desk = new Map<string, { row: DeskRow; mtime: number; name: string }>()
  const wordsAt = new Map<string, { turn: number; words: Words }>() // id8 -> what its last words said, read once per turn
  let nudgeWindow = ''
  let nudgeRead = new Set<string>()
  const wakePath = (): string => `${h.dir()}/${WAKE_FILE}`
  const idlePath = (): string => `${h.dir()}/${IDLE_FILE}`
  const myName = (): string => h.titleOf(h.me8()) || (h.me()?.lane ?? h.me8())
  const conductorPath = (): string => `${h.dir()}/${CONDUCTOR_FILE}`
  const nameOf = (f: { id8: string; lane: string }): string => h.titleOf(f.id8) || f.lane
  const event = (f: { lane: string; id8: string; lastTurnAt?: number }, rule: OrchestrateEvent['rule'], note: string, now: number, acted = true): OrchestrateEvent => ({ at: now, rule, lane: f.lane, id8: f.id8, procs: [], liveness: 'gone', lastTurnAt: f.lastTurnAt ?? null, agents: null, build: false, acted, note })
  const save = async (io: WakeIo, w: WakeFile, now: number): Promise<void> => {
    wake = { ...w, triedAt: Object.fromEntries(Object.entries(w.triedAt).filter(([, at]) => now - at < WORK_AGAIN_MS)) } // its only deleter
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
    if (listed.length > 0) for (const [cli, d] of desk) if (!listed.some(e => e.name === d.name)) desk.delete(cli) // a deleted session
    isDeskKnown = desk.has((h.me()?.session ?? '').toLowerCase()) // the folder counts only with this session's own record in it
  }
  const archived = (): ReadonlySet<string> => new Set([...desk.values()].filter(d => d.row.isArchived).map(d => d.row.cli.slice(0, 8)))

  /** Another session's request by read-compare-write: `change` of what it reads now; nothing when it asks anew or has answered
   * since `since`. A withdrawal is noted for A140: a session with its request gone is not started for work on the same words. */
  const rewrite = async (io: WakeIo, s: { id8: string; requestedAt: number }, since: number, change: (want: Want) => Want | null, now: number): Promise<{ isWritten: boolean; to: Want | null }> => {
    const path = `${h.dir()}/editor/${s.id8}.json`
    const raw = await io.read(path)
    const cur = parseSessionFile(raw)
    if (!cur?.want || cur.want.requestedAt !== s.requestedAt || cur.heartbeatAt > since) return { isWritten: false, to: null }
    const to = change(cur.want)
    if (to === cur.want) return { isWritten: false, to }
    return { isWritten: await io.writeChecked(path, raw, JSON.stringify({ ...cur, want: to, askedAt: s.requestedAt, ...(to === null ? { withdrawnAt: now } : {}) })), to }
  }

  /** A136: its request after a miss: `isReal`, nobody answered a send that went, or (from a conductor in the app) the app has no
   * such session; a real miss counts, and two withdraw it (logged). Any other miss is the route's and only moves it back. */
  const miss = async (io: WakeIo, s: { id8: string; lane: string; requestedAt: number }, since: number, isReal: boolean, why: string, now: number): Promise<void> => {
    const r = await rewrite(io, s, since, w => afterMiss(w, isReal), now)
    if (r.isWritten && r.to === null) await io.log(event(s, 'withdrawn', `its request withdrawn: started twice with no answer (${why})`, now))
  }

  /** A137 / A136 / A140: one start, sent by one A5R (the alert claim). A refused send stands until the heartbeat says (a send can
   * report undelivered and still work). No address, or the engine's loop guard: nothing went, a miss now. */
  const start = async (io: WakeIo, s: { f: SessionFile; why: WakeWhy; text: string; requestedAt: number | null }, now: number): Promise<Step> => {
    const turn = s.requestedAt === null ? null : { id8: s.f.id8, lane: s.f.lane, requestedAt: s.requestedAt }
    if (wake.pausedUntil > now) {
      if (turn) await miss(io, turn, now, false, 'loop-paused', now) // it blocks nobody while nothing can be sent
      return held(pausedCause(wake.pausedBy ?? myName()))
    }
    // A slow pass: another conductor may have taken over and started someone since this tick read the files.
    const latest = parseWake(await io.read(wakePath()))
    if (parseConductor(await io.read(conductorPath()))?.id8 !== h.me8() || latest.current) return held('another conductor went on meanwhile')
    wake = latest
    await io.write(conductorPath(), JSON.stringify({ id8: h.me8(), at: await io.now() }))
    if (!(await io.claimAlert(`wake-${s.f.id8}-${Math.floor(now / 60_000)}`))) return held(`another A5R started ${nameOf(s.f)} just now`) // two conductors in one handover
    const address = desk.get(s.f.session.toLowerCase())?.row.local
    const row = (outcome: WakeOutcome) => ({ at: now, id8: s.f.id8, lane: s.f.lane, why: s.why, outcome })
    const triedAt = { ...wake.triedAt, [s.f.id8]: now }
    if (!address) {
      await io.log(event(s.f, 'woke', `${s.why}: no desktop record for this session, so nothing can start it`, now, false))
      await save(io, { ...withRow(wake, row('no-address')), triedAt }, now)
      // From a conductor outside the app, whose sessions it cannot read, only once it has been gone 2 h (A125's old rule).
      if (turn) await miss(io, turn, now, isDeskKnown || now - s.f.heartbeatAt >= STALE_WANT_MS, 'no desktop record', now)
      return STARTED
    }
    const result = readSend(await io.call(sendInput(address, s.text)))
    if (result.kind === 'loop-paused') {
      await io.log(event(s.f, 'woke', `${s.why}: loop-paused: ${result.reason}`, now, false))
      const isFirst = wake.pausedSince === 0
      await save(io, { ...(isFirst ? withRow(wake, row('loop-paused')) : wake), triedAt, pausedUntil: now + PAUSE_MS, pausedSince: wake.pausedSince || now, pausedBy: wake.pausedBy ?? myName() }, now)
      if (turn) await miss(io, turn, now, false, 'loop-paused', now)
      if (isFirst) await alarm(io, pausedCause(myName()), now)
      return held(pausedCause(wake.pausedBy ?? myName()))
    }
    await io.log(event(s.f, 'woke', `${s.why}: ${result.kind === 'sent' ? `sent to ${address}, waiting for its heartbeat` : `the send reported "${result.reason}", waiting for its heartbeat anyway`}`, now))
    await save(io, { ...wake, current: { id8: s.f.id8, lane: s.f.lane, why: s.why, at: now, requestedAt: s.requestedAt, ...(result.kind === 'refused' ? { refused: result.reason.slice(0, 200) } : {}) }, pausedSince: 0, pausedBy: undefined, ...(result.kind === 'sent' ? { lastFailure: undefined } : {}), triedAt }, now)
    return STARTED
  }

  /** The start in flight: answered (a heartbeat newer than it), missed after 5 min, or still waited for (one at a time). A
   * session started for work holds the slot until it asks, holds or has had WORK_SETTLE_MS, so the next one starts on what it
   * does, not on its process coming up. True while it holds this minute; settling one ends the minute too: what this pass read
   * of its files is old now. */
  const settle = async (io: WakeIo, x: GrantInput, now: number): Promise<boolean> => {
    const cur = wake.current
    if (!cur) return false
    const f = x.files.find(o => o.id8 === cur.id8)
    const isAnswered = Boolean(f && f.heartbeatAt > cur.at)
    if (!isAnswered && now - cur.at < WAKE_ANSWER_MS) return true
    const outcome: WakeOutcome = isAnswered ? 'answered' : 'no-answer'
    const row = { at: now, id8: cur.id8, lane: cur.lane, why: cur.why, outcome }
    if (cur.answeredAt === undefined) await io.log(event(cur, 'woke', `${cur.why}: ${outcome} ${Math.round((now - cur.at) / 60_000)} min after the start at ${hhmm(cur.at)}`, now))
    if (isAnswered && cur.why === 'work' && !f?.want && !f?.holding && now - (cur.answeredAt ?? now) < WORK_SETTLE_MS) {
      if (cur.answeredAt === undefined) await save(io, { ...withRow(wake, row), current: { ...cur, answeredAt: now } }, now)
      return true
    }
    await save(io, { ...(cur.answeredAt === undefined ? withRow(wake, row) : wake), current: null, ...(!isAnswered && cur.refused ? { lastFailure: `the send was refused: ${cur.refused}` } : {}) }, now)
    if (!isAnswered && cur.requestedAt !== null) await miss(io, { id8: cur.id8, lane: cur.lane, requestedAt: cur.requestedAt }, cur.at, cur.refused === undefined, 'no-answer', now)
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
    const read = await Promise.all((await io.list(dir)).filter(f => f.name.endsWith('.json')).map(async f => ({ path: `${dir}/${f.name}`, raw: await io.read(`${dir}/${f.name}`) })))
    const rs = read.flatMap(o => {
      const r = parseRefusal(o.raw)
      return r ? [{ ...r, ...o }] : []
    })
    const off = archived()
    for (const r of stoppedRefusals(rs, x.files, x.lanes, now)) {
      const f = x.files.find(o => o.id8 === r.id8)
      if (!f || off.has(f.id8) || !desk.has(f.session.toLowerCase()) || !(await isFreed(io, r, x, now))) continue // no record: an app conductor can still act on it
      const step = await start(io, { f, why: r.kind, text: refusalMessage(r), requestedAt: null }, now)
      if (wake.pausedUntil <= now) await io.writeChecked(r.path, r.raw, 'null') // a loop pause spends no refusal
      return step // one at a time, whoever won its claim
    }
    return NOTHING
  }

  /** A140 / A91: the sessions with Editor work when the Editor is free and nobody is queued: a live one is told through its own
   * inbox (at most 3 in a free window), a stopped one is started, and the pass ends there (one at a time). */
  const workStep = async (io: WakeIo, x: GrantInput, now: number, again: boolean): Promise<Step> => {
    const window = h.freeWindow(now)
    if (!window) return NOTHING
    if (nudgeWindow !== window) {
      nudgeWindow = window
      nudgeRead = new Set()
    }
    let step: Step = NOTHING
    for (const f of workPool({ files: x.files, lanes: x.lanes, now, triedAt: wake.triedAt, again: true, archived: archived() })) {
      const triedAt = wake.triedAt[f.id8] ?? 0
      if (nudgeRead.has(f.id8) || (now - (await io.nudgedAt(f.id8)) < WORK_AGAIN_MS && !again)) continue
      const seen = wordsAt.get(f.id8)
      const turn = f.lastTurnAt ?? 0
      if (seen?.turn !== turn) {
        const events = await io.events(f.session)
        if (events.length === 0) continue // unread is not finished for the whole turn: read again next minute
        wordsAt.set(f.id8, { turn, words: wordsOf(events) })
      }
      const words = wordsAt.get(f.id8)?.words
      if (!words || !hasWork(f, h.leases(), words, now)) continue
      if (now - triedAt < WORK_AGAIN_MS && !again) {
        // A140 starts it no sooner; A141 still counts a start nobody answered: the work waits.
        if (lastOutcome(wake, f.id8) === 'no-answer') step = held(`${nameOf(f)} has work and did not answer at ${hhmm(triedAt)}${wake.lastFailure ? ` (${wake.lastFailure})` : ''}`)
        continue
      }
      if (!workFits(x, f)) return held(`${nameOf(f)} has work, but the Editor's gates hold it (memory ${h.freeGb() ?? '?'} GB)`)
      if (livenessOf(f.id8, x.files, x.lanes, now) !== 'alive') {
        if (!desk.has(f.session.toLowerCase())) continue // nothing can start it
        return start(io, { f, why: 'work', text: workMessage(h.freeGb()), requestedAt: null }, now) // one at a time
      }
      nudgeRead.add(f.id8)
      step = held(`${nameOf(f)} was told and has not asked yet`)
      if (!(await claimNudge(io, window, f.id8))) continue
      await io.nudge(f.id8, window, now, h.freeGb())
      await save(io, { ...wake, triedAt: { ...wake.triedAt, [f.id8]: now } }, now)
      await io.log({ ...event(f, 'A91-nudge', `the Editor is free (window ${window}), nobody queued; told through its inbox`, now), liveness: 'alive', agents: f.agents ?? null })
    }
    return step
  }
  /** A91: one nudge target per window and one of the window's 3 slots, each claimed. */
  const claimNudge = async (io: WakeIo, window: string, id8: string): Promise<boolean> => {
    if (!(await io.claimAlert(`nudge-${window}-${id8}`))) return false
    for (let k = 0; k < NUDGE_MAX; k += 1) if (await io.claimAlert(`nudge-${window}-slot-${k}`)) return true
    return false
  }

  /** A141: logged, then a native notification when the engine can, else a toast. */
  const alarm = async (io: WakeIo, cause: string, now: number): Promise<void> => {
    const text = alarmText(idle.run, cause)
    await io.log({ ...event({ lane: h.me()?.lane ?? '', id8: h.me8() }, 'idle-with-work', text, now), liveness: 'alive' })
    if (!(await io.notify(text))) io.toast(text)
  }

  /** What the conductor does in its minute: one start at a time. `again`: A141's one more try, the 2 h rule aside. */
  const act = async (io: WakeIo, x: GrantInput, now: number, again = false): Promise<Step> => {
    const inFlight = wake.current
    if (await settle(io, x, now)) return held(`${inFlight?.lane} was started at ${hhmm(inFlight?.at ?? now)} and has not asked yet`)
    const off = archived()
    const turn = turnToStart(x, f => off.has(f.id8) || (f.want !== null && now - (wake.triedAt[f.id8] ?? 0) < retryAfter(f.want))) // one tried just now leaves room for the next
    if (turn?.want) {
      const minutes = x.manual.minutes[turn.id8] ?? turn.want.minutes
      return start(io, { f: turn, why: 'turn', text: turnMessage(turn.want, minutes, now), requestedAt: turn.want.requestedAt }, now)
    }
    const refused = await refusalStep(io, x, now)
    if (refused.kind !== 'nothing') return refused
    const queued = queueIn(x)
    if (queued.length > 0) return held(wake.lastFailure ?? `${queued.length} queued, held back by the Editor's gates (memory ${h.freeGb() ?? '?'} GB)`)
    return workStep(io, x, now, again)
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
    /** A135: its request withdrawn, by the person or by age. */
    withdraw: async (io: WakeIo, id8: string, requestedAt: number, now: number): Promise<boolean> => (await rewrite(io, { id8, requestedAt }, now, () => null, now)).isWritten,
    /** A135: the sessions the app has archived. */
    archived,
    /** A140: whether this session can start another (it runs inside the desktop app). */
    canSend: (): boolean => isDeskKnown,
    /** A139 / A141: the panel's line. */
    line: (now: number): string => idleLine(idle, { now, queued: queueIn(h.grantInput(now)).length, isFree: h.freeWindow(now) !== null }),
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
