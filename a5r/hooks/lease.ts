// A5R rev 34 (L-38): the Editor lease's record and the rules that keep a slot with the session that needs it. Pure: no
// `$`; register.ts reads and writes the files. A100 one record per lease (Saved/A5R/leases.jsonl) and its 24-hour summary;
// A101 busy is not idle; A102 a retest extension; A104 a forced release keeps its place; A105 the queue as Hai sees it
// (A116: in plain words; A117: in the person's order, a holder's resized end).
import { liveWaitMin } from './truth.ts'
import { IDLE_RELEASE_MS, LEASE_WARN_MS, NOTICES, PASS_MAX_MIN, YIELD_EVERY_MS, claimIn, decide, hhmm, holdsSyncSlot, isPlaced, isYieldMoment, lockTimes, noticeIds, noticeText, queueIn, type Claim, type Decision, type GrantInput, type Holding, type LockLine, type Notice, type SessionFile, type Want, type WaitCode, type YieldAsk } from './coord.ts'

/** A100: the lease records, beside the other files in Saved/A5R, kept to the last 2,000 lines. */
export const LEASES_FILE = 'leases.jsonl'
export const LEASES_MAX = 2_000
/** A104: how long a forced release keeps the place of the request it held. */
export const RETURN_MS = 60 * 60_000
/** A100: the summary's window, and the same lane asking again within this counts as a return. */
export const SUMMARY_MS = 24 * 3_600_000
export const RETURN_WITHIN_MS = 60 * 60_000
/** A100 / A121: a request asked again within 60 min of the same lane's previous lease end (a kept place, asked before it, too). */
export const isReturnAsk = (requestedAt: number | null, prevEnd: number): boolean => requestedAt !== null && requestedAt - prevEnd <= RETURN_WITHIN_MS
/** A102: the retest extension: at most this many minutes, the whole lease at most this long. */
export const RETEST_MAX_MIN = 15
export const RETEST_LEASE_MAX_MIN = 90

/** A101: a shell command that uses the Editor: a build, the Editor itself, RunUAT, and the S2 drivers that launch, drive
 * or close it (launch_s2.ps1, lab.py, mcp.py, close_editor.ps1). */
export const EDITOR_WORK = /Build\.(bat|sh|cmd)\b|UnrealEditor|RunUAT|launch_s2\.ps1|close_editor\.ps1|\blab\.py\b|\bmcp\.py\b/i

/** A100: why a lease ended. `sync`: the sync's own slot ended with its sync; `cutoff`: a lease given up because a sync's
 * cutoff or freeze needed the Editor; A118 `focus`: given up because the person gave another session a Focus. */
export type EndReason = 'released' | 'yielded' | 'idle' | 'overrun' | 'lapsed' | 'unseen' | 'sync' | 'cutoff' | 'focus'
/** A104: the reasons the code forces on a holder (a yield ask it was told of, a sync's need, another session's lapse, A118 a
 * Focus). */
const FORCED: ReadonlySet<EndReason> = new Set(['yielded', 'cutoff', 'lapsed', 'unseen', 'focus'])

export type LeaseRecord = {
  v: 1
  lane: string
  id8: string
  requestedAt: number | null
  grantedAt: number
  reusedPid: number | null
  minutes: number
  /** The first minute an Unreal Editor ran during the lease (the grant itself when it reused one). */
  firstEditorSeenAt: number | null
  pieAt: number | null
  extensions: number
  endAt: number
  endReason: EndReason
  editorLeftOpen: boolean
  queueAtGrant: number
  pie: boolean
  build: boolean
  pieAborted: boolean
  /** A125: how long the request waited while its session was alive (absent: an A5R before 0.26.0). */
  liveWaitMs?: number
}

/** A100: what a holder notes about its lease for the record (kept in its Holding, so a reload and a lapsing session read
 * it): the Editor it reused and the queue behind it at the grant, the first Editor seen (the grant itself when it reused
 * one: no launch), the first PIE start, a PIE abort. */
export type LeaseNotes = { reuse?: number; queue?: number; editorAt?: number; pieAt?: number; pieAborted?: boolean; buildAt?: number } // buildAt: A125, the first build seen

/** A100: the holder's lease with what it noted since the last minute. */
export const noteLease = (h: Holding, f: { now: number; editorRuns: boolean; buildRuns: boolean; pieStartedAt: number; isPieLow: boolean }): Holding => {
  const n = h.notes ?? {}
  const notes: LeaseNotes = {
    ...n,
    ...(n.editorAt === undefined && f.editorRuns ? { editorAt: f.now } : {}),
    ...(n.buildAt === undefined && f.buildRuns ? { buildAt: f.now } : {}),
    ...(n.pieAt === undefined && f.pieStartedAt >= h.since ? { pieAt: f.pieStartedAt } : {}),
    ...(f.isPieLow ? { pieAborted: true } : {}),
  }
  return Object.keys(notes).length ? { ...h, notes } : h
}

/** A100 / A104: how a lease ends: when, why, whether an Editor was left open, the request time another session wrote
 * down for it (a lapse record), used when the holder's own request is already gone, and for a yield the request time of
 * the session it yielded to (the kept place ranks right after it). */
export type LeaseEnd = { at: number; reason: EndReason; isEditorOpen: boolean; requestedAt?: number; after?: number }

/** A104: the request time a release may keep: the request's own, never one that was itself a kept place (a place is
 * used once); undefined without a request. */
export const keepableOf = (want: Want | null): number | undefined => (want && !want.isKept ? want.requestedAt : undefined)

/** A100 / A104: a lease that ends: its record (none when the file holds no lease), and the holder's file after it: no
 * request and no lease; a forced end keeps the request's place for 60 min, any other end clears it. The record's
 * requestedAt is the file's own request only (`end.requestedAt` serves the kept place alone: the released-file path,
 * which writes no record). */
export const endLease = (f: SessionFile, end: LeaseEnd): { record: LeaseRecord | null; after: SessionFile } => {
  const { return: _was, ...rest } = f
  const back = returnOf(end.reason, f.want ? keepableOf(f.want) : end.requestedAt, end.at, end.after)
  const h = f.holding
  const n = h?.notes ?? {}
  const record: LeaseRecord | null = h
    ? {
        v: 1,
        lane: f.lane,
        id8: f.id8,
        requestedAt: f.want?.requestedAt ?? null,
        grantedAt: h.since,
        reusedPid: n.reuse ?? null,
        minutes: f.want?.minutes ?? Math.round((h.end - h.since) / 60_000),
        firstEditorSeenAt: n.editorAt ?? null,
        pieAt: n.pieAt ?? null,
        extensions: h.extended,
        endAt: end.at,
        endReason: end.reason,
        editorLeftOpen: end.isEditorOpen,
        queueAtGrant: n.queue ?? 0,
        pie: f.want?.pie === true,
        build: f.want?.build === true,
        pieAborted: n.pieAborted === true,
        ...(f.want?.waited === undefined ? {} : { liveWaitMs: f.want.waited }),
      }
    : null
  return { record, after: { ...rest, want: null, holding: null, ...(back ? { return: back } : {}) } }
}

/** A100: the file with one more line, kept to the last `max` lines. */
export const appendCapped = (cur: string, line: string, max = LEASES_MAX): string => `${[...cur.split(/\r?\n/).filter(l => l.trim() !== ''), line].slice(-max).join('\n')}\n`

const REASONS: readonly EndReason[] = ['released', 'yielded', 'idle', 'overrun', 'lapsed', 'unseen', 'sync', 'cutoff', 'focus']
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** A100: the records of the file, each read field by field (a line another version or a half write left is skipped). */
export const parseLeases = (text: string | null): LeaseRecord[] =>
  (text ?? '').split(/\r?\n/).flatMap((l): LeaseRecord[] => {
    try {
      const v = JSON.parse(l) as Record<string, unknown>
      const grantedAt = num(v.grantedAt)
      const endAt = num(v.endAt)
      const reason = REASONS.find(r => r === v.endReason)
      if (grantedAt === null || endAt === null || reason === undefined || typeof v.lane !== 'string') return []
      return [{ v: 1, lane: v.lane, id8: String(v.id8 ?? ''), requestedAt: num(v.requestedAt), grantedAt, reusedPid: num(v.reusedPid), minutes: num(v.minutes) ?? 0, firstEditorSeenAt: num(v.firstEditorSeenAt), pieAt: num(v.pieAt), extensions: num(v.extensions) ?? 0, endAt, endReason: reason, editorLeftOpen: v.editorLeftOpen === true, queueAtGrant: num(v.queueAtGrant) ?? 0, pie: v.pie === true, build: v.build === true, pieAborted: v.pieAborted === true, ...(typeof v.liveWaitMs === 'number' ? { liveWaitMs: v.liveWaitMs } : {}) }]
    } catch {
      return []
    }
  })

/** A100: the release's reason, from what the code knows: a yield ask it was told of within the notice's safe-point window
 * (D3: a later release is no yield), another session's claim (a sync's cutoff or freeze, A118 a Focus), past its end, told
 * it was idle; else a plain release. Never a session's own word. */
export const releaseReason = (x: { isYieldTold: boolean; claimedBy: Claim['kind'] | null; isOver: boolean; isIdleTold: boolean }): EndReason =>
  x.isYieldTold ? 'yielded' : x.claimedBy === 'sync' ? 'cutoff' : x.claimedBy === 'focus' ? 'focus' : x.isOver ? 'overrun' : x.isIdleTold ? 'idle' : 'released'

/** A104: the place a release keeps: a forced one keeps the request's requestedAt for 60 min (a yield ranks right after
 * the session it yielded to, `after`); any other keeps none. */
export const returnOf = (reason: EndReason, requestedAt: number | undefined, at: number, after?: number): { requestedAt: number; until: number } | undefined =>
  FORCED.has(reason) && requestedAt !== undefined ? { requestedAt: after === undefined ? requestedAt : Math.max(requestedAt, after + 1), until: at + RETURN_MS } : undefined

/** A104: the place of a new request, as its Want carries it: asking again keeps the request's own (and its kept mark); a
 * forced release's place within its 60 min, marked kept (used once: a release of that request keeps nothing). */
export const placeOf = (me: Pick<SessionFile, 'want' | 'return'> | null, now: number): Pick<Want, 'requestedAt' | 'isKept'> =>
  me?.want ? { requestedAt: me.want.requestedAt, ...(me.want.isKept ? { isKept: true } : {}) } : me?.return && now < me.return.until ? { requestedAt: me.return.requestedAt, isKept: true } : { requestedAt: now }

/** D3: the window a yield notice gives the holder (its text: "at your next safe point (≤ 10 min)"). */
export const YIELD_SAFE_MS = 10 * 60_000

/** D3: the yield ask this holder was told of within the last 10 min (`toldAt`: when each notice reached it), if any. */
export const yieldTold = (asks: readonly { asker: SessionFile; ask: YieldAsk }[], toldAt: ReadonlyMap<string, number>, now: number): { asker: SessionFile; ask: YieldAsk } | undefined =>
  asks.find(y => {
    const at = toldAt.get(noticeIds.yield(y.asker.id8, y.ask.at))
    return at !== undefined && now - at <= YIELD_SAFE_MS
  })

/** A103: the yield asks this lease's holder has in other sessions' files: through its own a5r (`file`), made during the
 * lease (a minute before its grant counts) and less than an hour old; each with the session that asked, whose id keys
 * its notice. A113: never from the head a pass slot went before (a 0.22.0 head may still ask). */
export const yieldAsksTo = (files: readonly SessionFile[], holder8: string, lease: Pick<Holding, 'since' | 'pass'>, now: number): { asker: SessionFile; ask: YieldAsk }[] =>
  files.filter(asker => asker.id8 !== lease.pass).flatMap(asker => asker.yieldAsks.filter(a => a.holder === holder8 && a.via === 'file' && a.at >= lease.since - 60_000 && now - a.at < YIELD_EVERY_MS).map(ask => ({ asker, ask })))

/** A101: the idle notice goes out only when the holder ran no turn, made no Editor use and ran no background agent for
 * 15 min (counted from the grant at most), with no PIE of its own and not unattended. D2: past the lease's end its turns
 * no longer count (the end bounds a working holder's time): only Editor use, PIE or an agent keep the notice back. */
export const isIdleHolder = (x: { now: number; since: number; end: number; editorUseAt: number; lastTurnAt: number | undefined; agents: number; isPie: boolean; isUnattended: boolean }): boolean =>
  !x.isPie && !x.isUnattended && x.agents === 0 && x.now - Math.max(x.editorUseAt, x.since) >= IDLE_RELEASE_MS && (x.now >= x.end || x.now - Math.max(x.lastTurnAt ?? 0, x.since) >= IDLE_RELEASE_MS)

/** The holder's own notices for its lease this minute: its end is near (5 min), it is over, it is idle (A101), yields asked
 * of it (A103, once it is between Editor work). A118: a lease a Focus gave hears its end from the Focus notices alone, and
 * while this session's Focus runs (`isClaimed`: a Focus claim only; a sync's holder still hears it is idle) it is neither told
 * it is idle nor asked to yield. */
export const holderNotices = (h: Holding, x: { now: number; isFocusLease: boolean; isClaimed: boolean; editorUseAt: number; lastTurnAt: number | undefined; agents: number; isPie: boolean; isUnattended: boolean; asks: readonly { asker: SessionFile; ask: YieldAsk }[]; waiting: number }): Notice[] => {
  const { now } = x
  const ends: Notice[] = x.isFocusLease ? [] : now >= h.end ? [{ id: noticeIds.overrun(h.since, h.end), text: NOTICES.overrun(h.end), isActionable: true }, ...overrunWait(h, now, x.waiting)] : now >= h.end - LEASE_WARN_MS ? [{ id: noticeIds.leaseEnding(h.since, h.end), text: NOTICES.leaseEnding(h.end), isActionable: true }] : []
  if (x.isClaimed) return ends
  const idle = isIdleHolder({ now, since: h.since, end: h.end, editorUseAt: x.editorUseAt, lastTurnAt: x.lastTurnAt, agents: x.agents, isPie: x.isPie, isUnattended: x.isUnattended }) ? [{ id: noticeIds.idle(h.since), text: NOTICES.idle(Math.round((now - Math.max(x.editorUseAt, h.since)) / 60_000)), isActionable: true }] : []
  const yields = isYieldMoment({ now, since: h.since, end: h.end, editorUseAt: x.editorUseAt }) ? x.asks.map(({ asker, ask }) => ({ id: noticeIds.yield(asker.id8, ask.at), text: NOTICES.yield(asker.lane, ask.minutes), isActionable: true })) : []
  return [...ends, ...idle, ...yields]
}

/** A122: 30 min past its end with sessions waiting, the holder is woken once more (an actionable notice reaches it idle). */
export const OVERRUN_WAIT_MS = 30 * 60_000
const OVERRUN_WAIT_ID = 'editor:overrun-wait:'
const overrunWait = (h: Holding, now: number, waiting: number): Notice[] =>
  now >= h.end + OVERRUN_WAIT_MS && waiting > 0 ? [{ id: `${OVERRUN_WAIT_ID}${h.since}`, text: noticeText('Editor lease', `your lease ended at ${hhmm(h.end)}, ${Math.round((now - h.end) / 60_000)} min ago, and ${waiting} session${waiting === 1 ? '' : 's'} wait${waiting === 1 ? 's' : ''} for the Editor`, 'release it now with the editor tool if your Editor work is done (stop PIE and save your own assets first); if it is not, say so: the person may give you more time or free the lock'), isActionable: true }] : []

/** A102: a second extension while others wait is the retest one: at most 15 min, no build lease, an Unreal Editor running,
 * the whole lease within 90 min, asked before its end. */
export const isRetestExtension = (x: { extended: number; add: number; isBuild: boolean; editorRuns: boolean; since: number; end: number; newEnd: number; now: number }): boolean =>
  x.extended === 1 && x.add <= RETEST_MAX_MIN && !x.isBuild && x.editorRuns && x.newEnd - x.since <= RETEST_LEASE_MAX_MIN * 60_000 && x.now < x.end

// ---------- A100: the 24-hour summary ----------
export type LeaseSummary = { leases: number; medianWaitMin: number | null; launchSharePct: number | null; yields: number; returns: number; pieAborts: number; syncHours: number }

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2
}

/** A100: the leases that ended in the last 24 h: how many; the median wait (request to grant); the launch share (the part
 * of the leased time before the first Editor ran); yields; returns (the same lane asked again within 60 min of the end,
 * computed here from the later record rather than written back); PIE aborts; hours the sync's own slots held. */
export const leaseSummary = (all: readonly LeaseRecord[], now: number): LeaseSummary => {
  const recs = all.filter(r => r.endAt <= now && now - r.endAt < SUMMARY_MS)
  const own = recs.filter(r => r.endReason !== 'sync')
  const held = own.reduce((n, r) => n + Math.max(0, r.endAt - r.grantedAt), 0)
  const launching = own.reduce((n, r) => n + Math.max(0, Math.min(r.firstEditorSeenAt ?? r.endAt, r.endAt) - r.grantedAt), 0)
  const returns = recs.filter(r => all.some(n => n.lane === r.lane && n.grantedAt > r.endAt && isReturnAsk(n.requestedAt, r.endAt))).length
  const wait = median(own.filter(r => r.requestedAt !== null).map(r => Math.max(0, r.liveWaitMs ?? r.grantedAt - (r.requestedAt ?? r.grantedAt)) / 60_000)) // A125: the live wait
  return {
    leases: recs.length,
    medianWaitMin: wait === null ? null : Math.round(wait),
    launchSharePct: held > 0 ? Math.round((launching / held) * 100) : null,
    yields: recs.filter(r => r.endReason === 'yielded').length,
    returns,
    pieAborts: recs.filter(r => r.pieAborted).length,
    syncHours: Math.round(recs.filter(r => r.endReason === 'sync').reduce((n, r) => n + Math.max(0, r.endAt - r.grantedAt), 0) / 360_000) / 10,
  }
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
/** A116: the 24 hours in plain words, one small line on the panel ('' with no lease in them). */
export const todayLine = (s: LeaseSummary): string =>
  s.leases === 0 ? '' : [`today: ${count(s.leases, 'turn')}`, ...(s.medianWaitMin === null ? [] : [`usually ${s.medianWaitMin} min wait`]), ...(s.launchSharePct === null ? [] : [`${s.launchSharePct}% of turns spent opening the Editor`])].join(' · ')
export const summaryLine = (s: LeaseSummary): string =>
  [
    `24 h: ${count(s.leases, 'lease')}`,
    s.medianWaitMin === null ? '' : `median wait ${s.medianWaitMin} min`,
    s.launchSharePct === null ? '' : `launch ${s.launchSharePct}%`,
    count(s.yields, 'yield'),
    count(s.returns, 'return'),
    count(s.pieAborts, 'PIE abort'),
    `sync ${s.syncHours} h`,
  ]
    .filter(Boolean)
    .join(' · ')

// ---------- A105: the queue as Hai sees it ----------
/** A117: a holder's lease takes the end its HELD line says once the person resized it from any session: the line every
 * session reads is the truth. The rule holds while every writer of the holder's line other than the person's resize keeps
 * the holder's own `holding` equal to it to the minute in the same step (the grant, extend, the sync's end, the pid note:
 * all the holder's own, through heldNow), so another whole minute (the line says HH:MM; the holder's own end may carry
 * seconds) with the same grant means the person rewrote it. Read through the holder's one accessor (register.ts heldNow) and
 * by every queue view. */
export const adoptLockEnd = (h: Holding, lock: LockLine, now: number): Holding => {
  const t = lock.kind === 'held' && lock.isStandard ? lockTimes(lock, now) : null
  return t && Math.abs(t.since - h.since) < 60_000 && Math.floor(t.end / 60_000) !== Math.floor(h.end / 60_000) ? { ...h, end: t.end } : h
}

/** A105: the holder; `end` its lease's end (A117: as its HELD line says once resized); `isSyncSlot` the sync's own slot. */
export type HolderRow = { lane: string; id8: string; isMe: boolean; grantedAt: number | null; editorAt: number | null; pieAt: number | null; extensions: number; end: number | null; leftMin: number | null; isSyncSlot: boolean }
/** A112: `wait`: the row's current wait code by decide, read from the files every session reads ('grant': it takes the
 * Editor at its next minute; 'pass': it goes before a head waiting for memory, A113). A116: `reason`, why in plain words.
 * A117: `minutes` the slot it will be granted (the person's, else its own `asked`); `isPlaced`, placed by the person. A119:
 * `startsAt`, when its turn is expected while a Focus runs (null otherwise, and for the focus session itself). */
export type QueueRow = { place: number; lane: string; id8: string; isMe: boolean; waitedMin: number; minutes: number; asked: number; isPlaced: boolean; pie: boolean; build: boolean; wait: WaitCode | 'grant' | 'pass' | null; reason: string; startsAt: number | null }
export type QueueView = { holder: HolderRow | null; rows: QueueRow[] }

/** A105: the holder (its file's lease, else the lock line's times) and each queued session in the order every session
 * computes (A117: the person's order included); A112: with each one's wait code; A116: and its reason in plain words. */
export const queueView = (x: GrantInput): QueueView => {
  const isHeld = x.lock.kind === 'held' || x.lock.kind === 'handed'
  const f = isHeld ? x.files.find(s => s.id8 === x.lock.id8) : undefined
  const h = f?.holding ? adoptLockEnd(f.holding, x.lock, x.now) : undefined
  const t = isHeld ? lockTimes(x.lock, x.now) : null
  const grantedAt = h?.since ?? (t && t.since !== t.end ? t.since : null)
  const end = h?.end ?? t?.end ?? null
  const holder: HolderRow | null = isHeld
    ? { lane: f?.lane || x.lock.lane || x.lock.id8 || 'unknown', id8: x.lock.id8, isMe: x.lock.id8 !== '' && x.lock.id8 === x.me8, grantedAt, editorAt: h?.notes?.editorAt ?? null, pieAt: h?.notes?.pieAt ?? null, extensions: h?.extended ?? 0, end, leftMin: end === null ? null : Math.round((end - x.now) / 60_000), isSyncSlot: holdsSyncSlot(x.lock, f) }
    : null
  const claim = claimIn(x)
  const starts = claim?.kind === 'focus' ? expectedStarts(x, claim.end) : new Map<string, number>() // A119
  const rows = queueIn(x).map((s, i): QueueRow => {
    const asked = s.want?.minutes ?? 0
    const d = decide({ ...x, me8: s.id8 })
    return { place: i + 1, lane: s.lane, id8: s.id8, isMe: s.id8 === x.me8, waitedMin: s.want ? liveWaitMin(s.want, x.now) : 0, minutes: x.manual.minutes[s.id8] ?? asked, asked, isPlaced: isPlaced(x.manual, s.id8), pie: s.want?.pie === true, build: s.want?.build === true, wait: waitOf(d), reason: reasonOf(d), startsAt: starts.get(s.id8) ?? null }
  })
  return { holder, rows }
}

/** A119: when each queued session's turn is expected to start: the Editor comes back to the queue at `base` (now at the
 * earliest), then each turn takes its minutes (the person's, A117, else its own) in the order every session computes; a
 * Focus's session is left out (its time is the box). */
export const expectedStarts = (x: Pick<GrantInput, 'files' | 'lanes' | 'now' | 'sync' | 'focus' | 'manual'>, base: number): Map<string, number> => {
  const out = new Map<string, number>()
  const claim = claimIn(x)
  const focus8 = claim?.kind === 'focus' ? claim.id8 : undefined
  let at = Math.max(base, x.now)
  for (const f of queueIn(x)) {
    if (f.id8 === focus8 || !f.want) continue
    out.set(f.id8, at)
    at += (x.manual.minutes[f.id8] ?? f.want.minutes) * 60_000
  }
  return out
}

/** A105 / A116: the holder's facts in plain words, one line (the panel's row): granted at (`sync` for the sync's own slot),
 * Editor seen at, PIE since, extensions. */
export const holderLine = (h: HolderRow): string =>
  [
    h.grantedAt === null ? 'granted ?' : `${h.isSyncSlot ? 'sync' : 'granted'} ${hhmm(h.grantedAt)}`,
    h.editorAt === null ? 'Editor not open yet' : `Editor ${hhmm(h.editorAt)}`,
    ...(h.pieAt === null ? [] : [`PIE ${hhmm(h.pieAt)}`]),
    ...(h.extensions > 0 ? [`extended ${h.extensions}×`] : []),
  ].join(' · ')
/** The time left on the holder's lease, or past it ('' with no end). */
export const leftText = (h: HolderRow): string => (h.leftMin === null ? '' : h.leftMin < 0 ? `${-h.leftMin} min over` : `${h.leftMin} min left`)
/** A105: the holder in the editor tool's status: the panel's line and the time left. */
export const holderText = (h: HolderRow): string => [holderLine(h), leftText(h)].filter(Boolean).join(' · ')

const waitOf = (d: Decision): QueueRow['wait'] => (d.kind === 'wait' ? d.code : d.kind === 'grant' ? (d.pass ? 'pass' : 'grant') : null)

/** A116: why a queued row waits, in plain words: the wait's own reason (decide), or that it takes the Editor next, or goes
 * before a head waiting for memory (A113). */
const reasonOf = (d: Decision): string => (d.kind === 'wait' ? d.reason : d.kind === 'grant' ? (d.pass ? `goes before 1 for ≤ ${PASS_MAX_MIN} min` : 'granted next') : '')

/** A105 / A116: a queued session's facts in plain words, one line (the panel's row): waited for, its minutes (A117: set by
 * hand), PIE / build, placed by hand, why it waits, A119 when its turn is expected after a Focus. */
export const queuedLine = (r: QueueRow): string =>
  [`waiting ${r.waitedMin} min`, r.minutes === r.asked ? `${r.minutes} min` : `${r.minutes} min (set by hand)`, ...(r.pie ? ['PIE'] : []), ...(r.build ? ['build'] : []), ...(r.isPlaced ? ['placed by hand'] : []), ...(r.reason ? [r.reason] : []), ...(r.startsAt === null ? [] : [`starts ~${hhmm(r.startsAt)}`])].join(' · ')
/** A105 / A112: a queued session in the editor tool's status: the panel's line and its wait code (for the logs and models). */
export const queueRowText = (r: QueueRow): string => [queuedLine(r), ...(r.wait && r.wait !== 'grant' && r.wait !== 'pass' ? [`wait ${r.wait}`] : [])].join(' · ')
