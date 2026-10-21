// A5R rev 34 (L-38): the Editor lease's record and the rules that keep a slot with the session that needs it. Pure: no
// `$`; register.ts reads and writes the files. A100 one record per lease (Saved/A5R/leases.jsonl) and its 24-hour summary;
// A101 busy is not idle; A102 a retest extension; A104 a forced release keeps its place; A105 the queue as Hai sees it.
import { IDLE_RELEASE_MS, PASS_MAX_MIN, YIELD_EVERY_MS, decide, hhmm, lockTimes, noticeIds, queueOf, type Decision, type GrantInput, type Holding, type SessionFile, type Want, type WaitCode, type YieldAsk } from './coord.ts'

/** A100: the lease records, beside the other files in Saved/A5R, kept to the last 2,000 lines. */
export const LEASES_FILE = 'leases.jsonl'
export const LEASES_MAX = 2_000
/** A104: how long a forced release keeps the place of the request it held. */
export const RETURN_MS = 60 * 60_000
/** A100: the summary's window, and the same lane asking again within this counts as a return. */
export const SUMMARY_MS = 24 * 3_600_000
export const RETURN_WITHIN_MS = 60 * 60_000
/** A102: the retest extension: at most this many minutes, the whole lease at most this long. */
export const RETEST_MAX_MIN = 15
export const RETEST_LEASE_MAX_MIN = 90

/** A101: a shell command that uses the Editor: a build, the Editor itself, RunUAT, and the S2 drivers that launch, drive
 * or close it (launch_s2.ps1, lab.py, mcp.py, close_editor.ps1). */
export const EDITOR_WORK = /Build\.(bat|sh|cmd)\b|UnrealEditor|RunUAT|launch_s2\.ps1|close_editor\.ps1|\blab\.py\b|\bmcp\.py\b/i

/** A100: why a lease ended. `sync`: the sync's own slot ended with its sync; `cutoff`: a lease given up because a sync's
 * cutoff or freeze needed the Editor. */
export type EndReason = 'released' | 'yielded' | 'idle' | 'overrun' | 'lapsed' | 'unseen' | 'sync' | 'cutoff'
/** A104: the reasons the code forces on a holder (a yield ask it was told of, a sync's need, another session's lapse). */
const FORCED: ReadonlySet<EndReason> = new Set(['yielded', 'cutoff', 'lapsed', 'unseen'])

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
}

/** A100: what a holder notes about its lease for the record (kept in its Holding, so a reload and a lapsing session read
 * it): the Editor it reused and the queue behind it at the grant, the first Editor seen (the grant itself when it reused
 * one: no launch), the first PIE start, a PIE abort. */
export type LeaseNotes = { reuse?: number; queue?: number; editorAt?: number; pieAt?: number; pieAborted?: boolean }

/** A100: the holder's lease with what it noted since the last minute. */
export const noteLease = (h: Holding, f: { now: number; editorRuns: boolean; pieStartedAt: number; isPieLow: boolean }): Holding => {
  const n = h.notes ?? {}
  const notes: LeaseNotes = {
    ...n,
    ...(n.editorAt === undefined && f.editorRuns ? { editorAt: f.now } : {}),
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
      }
    : null
  return { record, after: { ...rest, want: null, holding: null, ...(back ? { return: back } : {}) } }
}

/** A100: the file with one more line, kept to the last `max` lines. */
export const appendCapped = (cur: string, line: string, max = LEASES_MAX): string => `${[...cur.split(/\r?\n/).filter(l => l.trim() !== ''), line].slice(-max).join('\n')}\n`

const REASONS: readonly EndReason[] = ['released', 'yielded', 'idle', 'overrun', 'lapsed', 'unseen', 'sync', 'cutoff']
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
      return [{ v: 1, lane: v.lane, id8: String(v.id8 ?? ''), requestedAt: num(v.requestedAt), grantedAt, reusedPid: num(v.reusedPid), minutes: num(v.minutes) ?? 0, firstEditorSeenAt: num(v.firstEditorSeenAt), pieAt: num(v.pieAt), extensions: num(v.extensions) ?? 0, endAt, endReason: reason, editorLeftOpen: v.editorLeftOpen === true, queueAtGrant: num(v.queueAtGrant) ?? 0, pie: v.pie === true, build: v.build === true, pieAborted: v.pieAborted === true }]
    } catch {
      return []
    }
  })

/** A100: the release's reason, from what the code knows: a yield ask it was told of within the notice's safe-point window
 * (D3: a later release is no yield), a sync's cutoff or freeze (not its holder), past its end, told it was idle; else a
 * plain release. Never a session's own word. */
export const releaseReason = (x: { isYieldTold: boolean; isSyncNeed: boolean; isOver: boolean; isIdleTold: boolean }): EndReason =>
  x.isYieldTold ? 'yielded' : x.isSyncNeed ? 'cutoff' : x.isOver ? 'overrun' : x.isIdleTold ? 'idle' : 'released'

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
 * its notice. */
export const yieldAsksTo = (files: readonly SessionFile[], holder8: string, since: number, now: number): { asker: SessionFile; ask: YieldAsk }[] =>
  files.flatMap(asker => asker.yieldAsks.filter(a => a.holder === holder8 && a.via === 'file' && a.at >= since - 60_000 && now - a.at < YIELD_EVERY_MS).map(ask => ({ asker, ask })))

/** A101: the idle notice goes out only when the holder ran no turn, made no Editor use and ran no background agent for
 * 15 min (counted from the grant at most), with no PIE of its own and not unattended. D2: past the lease's end its turns
 * no longer count (the end bounds a working holder's time): only Editor use, PIE or an agent keep the notice back. */
export const isIdleHolder = (x: { now: number; since: number; end: number; editorUseAt: number; lastTurnAt: number | undefined; agents: number; isPie: boolean; isUnattended: boolean }): boolean =>
  !x.isPie && !x.isUnattended && x.agents === 0 && x.now - Math.max(x.editorUseAt, x.since) >= IDLE_RELEASE_MS && (x.now >= x.end || x.now - Math.max(x.lastTurnAt ?? 0, x.since) >= IDLE_RELEASE_MS)

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
  const returns = recs.filter(r => all.some(n => n.lane === r.lane && n.grantedAt > r.endAt && n.requestedAt !== null && n.requestedAt <= r.endAt + RETURN_WITHIN_MS)).length
  const wait = median(own.filter(r => r.requestedAt !== null).map(r => Math.max(0, r.grantedAt - (r.requestedAt ?? r.grantedAt)) / 60_000))
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
export type HolderRow = { lane: string; id8: string; isMe: boolean; grantedAt: number | null; editorAt: number | null; pieAt: number | null; extensions: number; leftMin: number | null }
/** A112: `wait`: the row's current wait code by decide, read from the files every session reads ('grant': it takes the
 * Editor at its next minute; 'pass': it goes before a head waiting for memory, A113). */
export type QueueRow = { place: number; lane: string; id8: string; isMe: boolean; waitedMin: number; minutes: number; pie: boolean; build: boolean; wait: WaitCode | 'grant' | 'pass' | null }
export type QueueView = { holder: HolderRow | null; rows: QueueRow[] }

/** A105: the holder (its file's lease, else the lock line's times) and each queued session in the order every session
 * computes; A112: with each one's wait code. */
export const queueView = (x: GrantInput): QueueView => {
  const isHeld = x.lock.kind === 'held' || x.lock.kind === 'handed'
  const f = isHeld ? x.files.find(s => s.id8 === x.lock.id8) : undefined
  const h = f?.holding
  const t = isHeld ? lockTimes(x.lock, x.now) : null
  const grantedAt = h?.since ?? (t && t.since !== t.end ? t.since : null)
  const end = h?.end ?? t?.end ?? null
  const holder: HolderRow | null = isHeld
    ? { lane: f?.lane || x.lock.lane || x.lock.id8 || 'unknown', id8: x.lock.id8, isMe: x.lock.id8 !== '' && x.lock.id8 === x.me8, grantedAt, editorAt: h?.notes?.editorAt ?? null, pieAt: h?.notes?.pieAt ?? null, extensions: h?.extended ?? 0, leftMin: end === null ? null : Math.round((end - x.now) / 60_000) }
    : null
  const rows = queueOf(x.files, x.lanes, x.now, x.sync).map((s, i): QueueRow => ({ place: i + 1, lane: s.lane, id8: s.id8, isMe: s.id8 === x.me8, waitedMin: Math.max(0, Math.round((x.now - (s.want?.requestedAt ?? x.now)) / 60_000)), minutes: s.want?.minutes ?? 0, pie: s.want?.pie === true, build: s.want?.build === true, wait: waitOf(decide({ ...x, me8: s.id8 })) }))
  return { holder, rows }
}

/** A105: the holder's facts in one line: granted at, Editor seen at, PIE since, extensions, time left. */
export const holderText = (h: HolderRow): string =>
  [
    h.grantedAt === null ? 'granted ?' : `granted ${hhmm(h.grantedAt)}`,
    h.editorAt === null ? 'no Editor yet' : `Editor ${hhmm(h.editorAt)}`,
    ...(h.pieAt === null ? [] : [`PIE ${hhmm(h.pieAt)}`]),
    ...(h.extensions > 0 ? [`ext ${h.extensions}`] : []),
    h.leftMin === null ? 'no end' : h.leftMin < 0 ? `${-h.leftMin} min over` : `${h.leftMin} min left`,
  ].join(' · ')

const waitOf = (d: Decision): QueueRow['wait'] => (d.kind === 'wait' ? d.code : d.kind === 'grant' ? (d.pass ? 'pass' : 'grant') : null)
const waitWords = (w: NonNullable<QueueRow['wait']>): string => (w === 'grant' ? 'granted next' : w === 'pass' ? `passes the head (≤ ${PASS_MAX_MIN} min)` : `wait ${w}`)

/** A105: a queued session's facts in one line: waited for, minutes asked, PIE / build; A112: why it waits (or that it takes
 * the Editor next, or goes before a head waiting for memory). */
export const queueRowText = (r: QueueRow): string =>
  [`waited ${r.waitedMin} min`, `asks ${r.minutes} min`, ...(r.pie ? ['PIE'] : []), ...(r.build ? ['build'] : []), ...(r.wait === null ? [] : [waitWords(r.wait)])].join(' · ')
