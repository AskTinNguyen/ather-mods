// Rev 45 (L-49, L-50), the host side of A135-A141 on closures (no `$`: register.ts hands it this session's state once and
// the engine's calls per call). The conductor's minute: its claim, the start in flight, whose turn or what else is due, the
// count and the alarm. A lease is never written here: a started session takes the lock itself, through decide, once its own
// process runs, so its clock starts when it answers and a failed send cannot touch one. The rules are wake.ts's.
import { claimIn, hhmm, livenessOf, queueIn, parseSessionFile, type GrantInput, type LaneBeat, type OrchestrateEvent, type SessionFile, type Want } from './coord.ts'
import type { FileIo } from './hostio.ts'
import type { TranscriptEvent } from './judge.ts'
import type { LeaseRecord } from './lease.ts'
import { NUDGE_MAX } from './nudge.ts'
import type { Need } from './syncplan.ts'
import { CONDUCTOR_FILE, IDLE_FILE, NO_IDLE, NO_WAKE, REFUSED_DIR, WAKE_ANSWER_MS, WAKE_FILE, WORK_AGAIN_MS, afterMiss, alarmText, conductorOf, deskDir, hasWork, idleLine, isAlarmDue, isStopped, mayConduct, nextAskedAt, nextIdle, nightLine, parseConductor, parseDeskRow, parseIdle, parseRefusal, parseWake, pausedCause, readSend, refusalMessage, sendInput, stoppedRefusals, turnMessage, turnToStart, withRow, workFits, workMessage, workPool, type DeskRow, type IdleFile, type Refusal, type SendResult, type Start, type WakeFile, type WakeOutcome, type WakeWhy } from './wake.ts'

/** The engine's calls for one minute. */
export type WakeIo = FileIo & {
  /** The route's one call (wake.ts sendInput); never rejects. */
  call: (input: Record<string, unknown>) => Promise<{ deny?: string; text?: string } | null>
  /** Where the desktop app keeps its session records, as the engine's environment says (absent outside the app). */
  deskPlace: () => Promise<{ appData?: string; account?: string; org?: string }>
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
  files: () => SessionFile[]
  lanes: () => readonly LaneBeat[]
  grantInput: (now: number) => GrantInput
  leases: () => readonly LeaseRecord[]
  dir: () => string
  freeWindow: (now: number) => string | null
  freeGb: () => number | null
  titleOf: (id8: string) => string
}

export const conductor = (h: WakeState) => {
  /** In this process: the last files read for every session's panel, the desktop's records by CLI id, and the tails read. */
  let wake: WakeFile = NO_WAKE
  let idle: IdleFile = NO_IDLE
  const desk = new Map<string, { row: DeskRow; mtime: number; name: string }>()
  const finishedAt = new Map<string, number | undefined>() // id8 -> the last turn whose words were read and found finished
  let nudgeWindow = ''
  let nudgeRead = new Set<string>()
  const wakePath = (): string => `${h.dir()}/${WAKE_FILE}`
  const idlePath = (): string => `${h.dir()}/${IDLE_FILE}`
  const nameOf = (f: { id8: string; lane: string }): string => h.titleOf(f.id8) || f.lane
  const myName = (): string => nameOf({ id8: h.me8(), lane: h.me()?.lane ?? h.me8() })
  const event = (f: SessionFile | Start, rule: OrchestrateEvent['rule'], note: string, now: number, acted = true): OrchestrateEvent => ({ at: now, rule, lane: f.lane, id8: f.id8, procs: [], liveness: 'gone', lastTurnAt: 'lastTurnAt' in f ? (f.lastTurnAt ?? null) : null, agents: null, build: false, acted, note })
  const save = async (io: WakeIo, w: WakeFile): Promise<void> => {
    wake = w
    await io.write(wakePath(), JSON.stringify(w))
  }

  /** A138: the desktop's records, read again only when they changed. Outside the desktop app there are none. */
  const readDesk = async (io: WakeIo): Promise<void> => {
    const p = await io.deskPlace()
    const dir = deskDir(p.appData, p.account, p.org)
    if (!dir) return
    const known = new Map([...desk.values()].map(d => [d.name, d]))
    for (const e of await io.list(dir)) {
      if (!/^local_[\w-]+\.json$/.test(e.name) || known.get(e.name)?.mtime === e.mtimeMs) continue
      const row = parseDeskRow(await io.read(`${dir}/${e.name}`))
      if (row) desk.set(row.cli, { row, mtime: e.mtimeMs, name: e.name })
    }
  }

  /** A second session's file, written by read-compare-write: `change` of what it reads now, or nothing when it changed or answered. */
  const rewrite = async (io: FileIo, id8: string, requestedAt: number, change: (want: Want) => Want | null, askedAt: number): Promise<{ isWritten: boolean; to: Want | null }> => {
    const path = `${h.dir()}/editor/${id8}.json`
    const raw = await io.read(path)
    const cur = parseSessionFile(raw)
    if (!cur?.want || cur.want.requestedAt !== requestedAt) return { isWritten: false, to: null }
    const to = change(cur.want)
    if (to === cur.want) return { isWritten: false, to }
    if ((await io.read(path)) !== raw) return { isWritten: false, to: null }
    const text = JSON.stringify({ ...cur, want: to, askedAt })
    await io.write(path, text)
    return { isWritten: (await io.read(path)) === text, to }
  }

  /** A136: its request after a miss: moved back once; a second real miss withdraws it (logged). A loop pause never withdraws:
   * nobody was asked. */
  const miss = async (io: WakeIo, s: { id8: string; lane: string; requestedAt: number | null }, x: GrantInput, outcome: WakeOutcome, now: number): Promise<void> => {
    if (s.requestedAt === null) return
    const r = await rewrite(io, s.id8, s.requestedAt, w => afterMiss(w, nextAskedAt(x, s.id8), outcome !== 'loop-paused'), s.requestedAt)
    if (r.isWritten && r.to === null) await io.log(event({ ...s, why: 'turn', at: now, by: h.me8() }, 'withdrawn', `its request withdrawn: started twice with no answer (${outcome})`, now))
  }

  /** A137 / A136 / A140: one start: one writer by claim, the address, the send; a refused send stands until the heartbeat says
   * (a send can report undelivered and still work); no address or the loop guard is a miss now. */
  const start = async (io: WakeIo, s: { f: SessionFile; why: WakeWhy; key: string; text: string; requestedAt: number | null }, x: GrantInput, now: number): Promise<boolean> => {
    if (wake.pausedUntil > now || !(await io.claimAlert(`wake-${s.why}-${s.f.id8}-${s.key}-${wake.pausedUntil}`))) return false
    await readDesk(io)
    const address = desk.get(s.f.session.toLowerCase())?.row.local
    const result: SendResult | null = address ? readSend(await io.call(sendInput(address, s.text))) : null
    const row = (outcome: WakeOutcome) => ({ at: now, id8: s.f.id8, lane: s.f.lane, why: s.why, outcome })
    const logged = (text: string) => io.log(event(s.f, 'woke', `${s.why}: ${text}`, now, result?.kind !== 'loop-paused' && result !== null))
    if (!result) {
      await logged('no desktop record for this session, so nothing can start it')
      await save(io, withRow(wake, row('no-address')))
      if (s.why === 'turn') await miss(io, { ...s.f, requestedAt: s.requestedAt }, x, 'no-address', now)
      return true
    }
    if (result.kind === 'loop-paused') {
      await logged(`loop-paused: ${result.reason}`)
      const isFirst = wake.pausedSince === 0
      await save(io, { ...withRow(wake, row('loop-paused')), pausedUntil: now + WAKE_ANSWER_MS, pausedSince: wake.pausedSince || now })
      if (s.why === 'turn') await miss(io, { ...s.f, requestedAt: s.requestedAt }, x, 'loop-paused', now)
      if (isFirst) await alarm(io, pausedCause(myName()), now)
      return true
    }
    await logged(result.kind === 'sent' ? `sent to ${address}, waiting for its heartbeat` : `the send reported "${result.reason}", waiting for its heartbeat anyway`)
    await save(io, { ...wake, current: { id8: s.f.id8, lane: s.f.lane, why: s.why, at: now, by: h.me8(), requestedAt: s.requestedAt }, pausedSince: 0, ...(s.why === 'work' ? { workAt: { ...wake.workAt, [s.f.id8]: now } } : {}) })
    return true
  }

  /** The start in flight: answered (a heartbeat newer than it), missed after 5 min, or still waited for (one at a time). */
  const settle = async (io: WakeIo, x: GrantInput, now: number): Promise<boolean> => {
    const cur = wake.current
    if (!cur) return true
    const f = x.files.find(o => o.id8 === cur.id8)
    const isAnswered = Boolean(f && f.heartbeatAt > cur.at)
    if (!isAnswered && now - cur.at < WAKE_ANSWER_MS) return false
    const outcome: WakeOutcome = isAnswered ? 'answered' : 'no-answer'
    await io.log(event(cur, 'woke', `${cur.why}: ${outcome} ${Math.round((now - cur.at) / 60_000)} min after the start at ${hhmm(cur.at)}`, now))
    await save(io, { ...withRow(wake, { at: now, id8: cur.id8, lane: cur.lane, why: cur.why, outcome }), current: null })
    if (!isAnswered && cur.why === 'turn') await miss(io, cur, x, 'no-answer', now)
    return true
  }

  /** A137: the refusals on file, whichever session reads them. */
  const refusals = async (io: FileIo): Promise<Refusal[]> => {
    const dir = `${h.dir()}/${REFUSED_DIR}`
    return (await Promise.all((await io.list(dir)).filter(f => f.name.endsWith('.json')).map(async f => parseRefusal(await io.read(`${dir}/${f.name}`))))).flatMap(r => r ?? [])
  }
  const isFreed = async (io: WakeIo, r: Refusal, x: GrantInput, now: number): Promise<boolean> => {
    const held = await io.heldNeeds(now)
    if (r.kind === 'git') return !held.has('git') && (await io.isGitFree(now))
    return !(r.needs ?? []).some(n => held.has(n) || (n === 'editor' && claimIn(x)?.kind === 'focus'))
  }
  /** A137: the next stopped session refused git or the freeze whose wait is over: started once per refusal, in order; a refusal
   * spent or lifted is cleared by its reader. */
  const refusalStep = async (io: WakeIo, x: GrantInput, now: number): Promise<boolean> => {
    for (const r of stoppedRefusals(await refusals(io), x.files, x.lanes, now)) {
      if (!(await isFreed(io, r, x, now))) continue
      const f = x.files.find(o => o.id8 === r.id8)
      const did = f ? await start(io, { f, why: r.kind, key: String(r.at), text: refusalMessage(r), requestedAt: null }, x, now) : false
      if (did && wake.pausedUntil <= now) await io.write(`${h.dir()}/${REFUSED_DIR}/${r.id8}.json`, 'null') // a loop pause spends no refusal
      return did
    }
    return false
  }

  /** A140 / A91: the sessions with Editor work when the Editor is free and nobody is queued: a live one is told through its own
   * inbox (at most 3 in a free window), a stopped one is started, and the pass ends there (one at a time). */
  const workStep = async (io: WakeIo, x: GrantInput, now: number, again = false): Promise<{ hasWork: boolean; cause: string }> => {
    const window = h.freeWindow(now)
    if (!window || wake.current) return { hasWork: false, cause: '' }
    if (nudgeWindow !== window) {
      nudgeWindow = window
      nudgeRead = new Set()
    }
    let found = false
    let cause = ''
    for (const f of workPool({ files: x.files, lanes: x.lanes, now, workAt: wake.workAt, again })) {
      if (nudgeRead.has(f.id8) || (finishedAt.has(f.id8) && finishedAt.get(f.id8) === f.lastTurnAt) || (now - (await io.nudgedAt(f.id8)) < WORK_AGAIN_MS && !again)) continue
      if (!hasWork(f, h.leases(), await io.events(f.session), now)) {
        finishedAt.set(f.id8, f.lastTurnAt)
        continue
      }
      found = true
      if (!workFits(x, f)) {
        cause = `${nameOf(f)} has work, but the Editor's gates hold it (memory ${h.freeGb() ?? '?'} GB)`
        break
      }
      if (livenessOf(f.id8, x.files, x.lanes, now) !== 'alive') {
        if (await start(io, { f, why: 'work', key: `${f.lastTurnAt ?? 0}${again ? '-again' : ''}`, text: workMessage(h.freeGb()), requestedAt: null }, x, now)) break
        continue
      }
      if (!(await claimNudge(io, window, f.id8))) continue
      nudgeRead.add(f.id8)
      await io.nudge(f.id8, window, now, h.freeGb())
      await save(io, { ...wake, workAt: { ...wake.workAt, [f.id8]: now } })
      await io.log({ ...event(f, 'A91-nudge', `the Editor is free (window ${window}), nobody queued; told through its inbox`, now), liveness: 'alive', agents: f.agents ?? null })
    }
    return { hasWork: found, cause: wake.pausedUntil > now ? pausedCause(myName()) : cause }
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
    await io.log({ at: now, rule: 'idle-with-work', lane: h.me()?.lane ?? '', id8: h.me8(), procs: [], liveness: 'alive', lastTurnAt: null, agents: null, build: false, acted: true, note: text })
    if (!(await io.notify(text))) io.toast(text)
  }

  /** A137: its own refusal ends once what it waited for is free: it is alive and heard that from its own A5R. */
  const clearOwn = async (io: WakeIo, now: number): Promise<void> => {
    const path = `${h.dir()}/${REFUSED_DIR}/${h.me8()}.json`
    const r = parseRefusal(await io.read(path))
    if (r && (await isFreed(io, r, h.grantInput(now), now))) await io.write(path, 'null')
  }

  /** What the conductor does in its minute: one claim, one start at a time, then the count and the alarm. */
  const act = async (io: WakeIo, x: GrantInput, now: number, again = false): Promise<{ hasWork: boolean; cause: string; isStarted: boolean }> => {
    if (!(await settle(io, x, now))) return { hasWork: true, cause: `${wake.current?.lane} was started at ${hhmm(wake.current?.at ?? now)} and has not answered yet`, isStarted: true }
    const turn = turnToStart(x)
    if (turn?.want) {
      const minutes = x.manual.minutes[turn.id8] ?? turn.want.minutes
      const did = await start(io, { f: turn, why: 'turn', key: `${turn.want.requestedAt}-${turn.want.misses ?? 0}`, text: turnMessage(turn.want, minutes, now), requestedAt: turn.want.requestedAt }, x, now)
      return { hasWork: true, cause: wake.pausedUntil > now ? pausedCause(myName()) : `${turn.lane} is first and could not be started`, isStarted: did }
    }
    if (await refusalStep(io, x, now)) return { hasWork: true, cause: 'a stopped session was started', isStarted: true }
    const queued = queueIn(x)
    if (queued.length > 0) return { hasWork: true, cause: `${queued.length} queued, held back by the Editor's gates (memory ${h.freeGb() ?? '?'} GB)`, isStarted: false }
    return { ...(await workStep(io, x, now, again)), isStarted: false }
  }

  const stoppedNow = (now: number): number => {
    const x = h.grantInput(now)
    return x.files.filter(f => isStopped(f, x.files, x.lanes, now)).length
  }

  return {
    /** The minute, in the Editor's own pass (before this session's own decision): true when another session's file changed. */
    tick: async (io: WakeIo, now: number): Promise<boolean> => {
      wake = parseWake(await io.read(wakePath()))
      idle = parseIdle(await io.read(idlePath()))
      await clearOwn(io, now)
      const me8 = h.me8()
      const x = h.grantInput(now)
      if (!mayConduct(me8, conductorOf(x.files, x.lanes, now), parseConductor(await io.read(`${h.dir()}/${CONDUCTOR_FILE}`)), now)) return false
      await io.write(`${h.dir()}/${CONDUCTOR_FILE}`, JSON.stringify({ id8: me8, at: now }))
      if (parseConductor(await io.read(`${h.dir()}/${CONDUCTOR_FILE}`))?.id8 !== me8) return false
      if (x.files.some(f => isStopped(f, x.files, x.lanes, now))) await readDesk(io)
      const before = wake
      const done = await act(io, x, now)
      const isFree = h.freeWindow(now) !== null
      const next = nextIdle(idle, { isFree, hasWork: done.hasWork, now })
      idle = next.idle
      if (isAlarmDue(idle)) {
        idle = { ...idle, alarmed: true }
        const again = done.isStarted ? done : await act(io, x, now, true) // A141: it tries once more, the 2 h rule aside
        await alarm(io, again.cause || done.cause || 'the conductor found work and could not start it', now)
      }
      if (next.idle.lastAt === now) await io.write(idlePath(), JSON.stringify(idle))
      return wake !== before
    },
    /** A137: this session was refused by the git turn or the freeze: on file at once (its process may stop before its minute). */
    refused: async (io: FileIo, r: Omit<Refusal, 'v' | 'id8' | 'at'>, now: number): Promise<void> => {
      const me8 = h.me8()
      if (me8) await io.write(`${h.dir()}/${REFUSED_DIR}/${me8}.json`, JSON.stringify({ v: 1, id8: me8, at: now, ...r }))
    },
    /** A135: its request withdrawn, by the person or by age: the one write to another session's file (read-compare-write). */
    withdraw: async (io: FileIo, id8: string, requestedAt: number): Promise<boolean> => (await rewrite(io, id8, requestedAt, () => null, requestedAt)).isWritten,
    /** A135: the sessions the app has archived. */
    archived: (): ReadonlySet<string> => new Set([...desk.values()].filter(d => d.row.isArchived).map(d => d.row.cli.slice(0, 8))),
    /** A139 / A141: the panel's line. */
    line: (now: number): string => {
      const x = h.grantInput(now)
      return idleLine(idle, { now, queued: queueIn(x).length, isFree: h.freeWindow(now) !== null })
    },
    /** A139: how many queued requests have stopped sessions, in the words of the compact line. */
    stoppedCount: (now: number): number => stoppedNow(now),
    night: (now: number): string => nightLine(wake, h.leases(), now),
    /** A141: for status.json. */
    status: (now: number): Record<string, unknown> => ({ stopped: stoppedNow(now), idleWithWork: { run: idle.run, days: idle.days, nights: idle.nights }, starting: wake.current ? { lane: wake.current.lane, id8: wake.current.id8, why: wake.current.why, at: wake.current.at } : null, pausedUntil: wake.pausedUntil > now ? wake.pausedUntil : null }),
  }
}
