// a5r-hosts S-b, S-c: the host card (prompt.md "Data structures" 2). Two writers, never of one file: an A5R host's own
// tick writes `<coordinationRoot>/Saved/A5R/card.json` from its local truth (`a5rCard`, S-c); the origin writes its copy
// in its own Saved/A5R/hosts/<id>/card.json, the host's A5R card read through the adapter when fresh (`source: "a5r"`),
// else a probe-built one (`source: "probe"`: a C1 probe, C10's RAM and the process list; a field that cannot be read is
// null or `unknown`, never guessed). Pure.
import { callOp, type Adapter, type RemoteOs } from './adapters/types.ts'
import type { AsHost, Availability, HostDecl, Window } from './hosts.ts'
import { isObj } from './shape.ts'

export type HostCard = {
  v: 1
  at: number
  source: 'a5r' | 'probe'
  hostId?: string
  machine: { label?: string; os?: RemoteOs; freeRamGb: number | null; totalRamGb: number | null; freeDiskGb: number | null; engine?: string }
  editor: { holder: { lane: string; end: number | null } | null; queue: number; running: boolean | 'unknown' }
  availability: { state: 'yes' | 'no' | 'unknown'; reason?: string; until?: number }
  freeze: null | { kind: 'sync'; until?: number }
  lanes: { id: string; slug: string; state: 'idle' | 'busy'; branch?: string }[]
  jobs: { running: number; queued: number }
  account: { shared: 'yes' | 'no' | 'unknown' }
  skew: { ms: number | null }
  /** The host's roles (asHost.roles; a probe card: the declaration's assumed ones), matched against a request's wants. */
  roles?: string[]
  /** The origin ids the host accepts jobs from (asHost.trust; "*" = any). Absent on a probe card: trust unknown. */
  acceptsFrom?: string[]
}

export const parseCard = (raw: string | null): HostCard | null => {
  try {
    const v = JSON.parse(raw ?? '') as unknown
    return isObj(v) && v.v === 1 && typeof v.at === 'number' && isObj(v.machine) && isObj(v.editor) ? (v as HostCard) : null
  } catch {
    return null
  }
}
/** Old past `staleCardMin`, or absent. An A5R card's `at` is the host's clock: corrected by the skew C4 measured
 * (host minus here), which the origin writes into its copy. */
export const isStale = (card: HostCard | null, now: number, staleCardMin: number): boolean => !card || now - (card.at - (card.source === 'a5r' ? (card.skew.ms ?? 0) : 0)) > staleCardMin * 60_000

/** The Unreal Editor's process name on each OS. */
const EDITOR = /^UnrealEditor(\.exe)?$/i
/** Whether an Unreal Editor runs on the host, from its process list; `unknown` when the list cannot be read. */
export const editorRunning = async (a: Adapter, os: RemoteOs): Promise<boolean | 'unknown'> => {
  const r = await callOp(a, 'run', os === 'windows' ? ['tasklist', '/fo', 'csv', '/nh', '/fi', 'IMAGENAME eq UnrealEditor.exe'] : ['ps', '-A', '-o', 'comm='])
  if (!r.ok || r.value.exitCode !== 0) return 'unknown'
  return r.value.stdout.split(/\r?\n/).some(l => EDITOR.test((/^"([^"]*)"/.exec(l.trim())?.[1] ?? l.trim().split('/').pop() ?? '').trim()))
}

/** A probe card from what was read (null where it was not); availability is the declaration's `assumed` one, if any. */
export const probeCard = (id: string, decl: HostDecl, now: number, read: { os: RemoteOs | null; totalRamGb: number | null; freeRamGb: number | null; running: boolean | 'unknown'; skewMs?: number | null }): HostCard => {
  const assumed: Availability | undefined = decl.assumed?.availability
  return {
    v: 1,
    at: now,
    source: 'probe',
    hostId: id,
    machine: { label: decl.label, ...(read.os ? { os: read.os } : {}), freeRamGb: read.freeRamGb, totalRamGb: read.totalRamGb, freeDiskGb: null },
    editor: { holder: null, queue: 0, running: read.running },
    ...(decl.assumed?.roles ? { roles: decl.assumed.roles } : {}),
    availability: assumed ? { state: assumed.state, ...(assumed.reason ? { reason: assumed.reason } : {}) } : { state: 'unknown' },
    freeze: null,
    lanes: [],
    jobs: { running: 0, queued: 0 },
    account: { shared: 'unknown' },
    skew: { ms: read.skewMs ?? null },
  }
}

// ---- S-c: the card an A5R host publishes about itself ----

/** This machine's facts as a5r reads them each minute (register.ts gives them): the shared probe, the lock's holder,
 * the live queue, whether an Unreal Editor runs, the launch gates, and an open sync (its time, hard end, and whether its
 * cutoff or freeze has begun). */
export type LocalTruth = {
  os: RemoteOs
  freeGb: number | null
  diskGb: number | null
  running: boolean | 'unknown'
  holder: { id8: string; lane: string; end: number | null } | null
  queue: number
  gates: { pieGb: number; nopieGb: number }
  sync: { at: number; hardEnd: number; isFrozen: boolean } | null
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
/** The weekday (0 = Sunday) and minute of the day at `now` in an IANA zone; null when the zone is not known. */
const wallClock = (now: number, tz: string): { day: number; min: number } | null => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now))
    const part = (t: string) => parts.find(p => p.type === t)?.value ?? ''
    return { day: DAYS.indexOf(part('weekday').toLowerCase().slice(0, 3)), min: Number(part('hour')) * 60 + Number(part('minute')) }
  } catch {
    return null
  }
}
const minOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
/** Whether `now` falls in a window (`days` are the days a span starts on, English names; a span past midnight ends the
 * next day). An unknown zone matches nothing. */
export const inWindow = (w: Window, now: number): boolean => {
  const t = wallClock(now, w.tz)
  if (!t) return false
  const days = new Set(w.days.map(d => DAYS.indexOf(d.toLowerCase().slice(0, 3))))
  const [from, to] = [minOf(w.from), minOf(w.to)]
  if (from <= to) return days.has(t.day) && t.min >= from && t.min < to
  return (days.has(t.day) && t.min >= from) || (days.has((t.day + 6) % 7) && t.min < to)
}
/** asHost.availability evaluated now: `no` as declared, past its `until`, or outside every window. */
export const availabilityNow = (a: AsHost['availability'], now: number): HostCard['availability'] => {
  if (a.state === 'no') return { state: 'no', ...(a.reason ? { reason: a.reason } : {}) }
  if (a.until !== undefined && now >= a.until) return { state: 'no', reason: 'past its until' }
  if (a.windows?.length && !a.windows.some(w => inWindow(w, now))) return { state: 'no', reason: a.reason || 'outside its windows' }
  return { state: 'yes', ...(a.until !== undefined ? { until: a.until } : {}) }
}

const slashed = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
/** `git worktree list --porcelain` of the coordination root: the worktrees under `laneRoot` (busy on a branch, idle when
 * detached), each named by its path under the lane root and its folder. */
export const lanesOf = (porcelain: string, laneRoot: string): HostCard['lanes'] => {
  const root = `${slashed(laneRoot).toLowerCase()}/`
  return porcelain.split(/\r?\n\r?\n/).flatMap(block => {
    const ls = block.split(/\r?\n/)
    const path = slashed(ls.find(l => l.startsWith('worktree '))?.slice(9) ?? '')
    if (!path.toLowerCase().startsWith(root)) return []
    const branch = ls.find(l => l.startsWith('branch '))?.slice(7).replace(/^refs\/heads\//, '')
    return [{ id: path.slice(root.length), slug: path.slice(path.lastIndexOf('/') + 1), state: branch ? ('busy' as const) : ('idle' as const), ...(branch ? { branch } : {}) }]
  })
}

/** The card an A5R host writes about itself, from local truth only (A16's card part: the coordination root's Editor holder
 * and live queue), its availability evaluated now, its roles and the origins it accepts. Jobs are slice S-d's. */
export const a5rCard = (now: number, as: AsHost, t: LocalTruth, lanes: HostCard['lanes']): HostCard => ({
  v: 1,
  at: now,
  source: 'a5r',
  machine: { os: t.os, freeRamGb: t.freeGb, totalRamGb: null, freeDiskGb: t.diskGb },
  editor: { holder: t.holder && { lane: t.holder.lane, end: t.holder.end }, queue: t.queue, running: t.running },
  availability: availabilityNow(as.availability, now),
  freeze: t.sync?.isFrozen ? { kind: 'sync', until: t.sync.hardEnd } : null,
  lanes,
  jobs: { running: 0, queued: 0 },
  account: as.account ?? { shared: 'unknown' },
  skew: { ms: null },
  roles: as.roles,
  acceptsFrom: as.trust,
})
/** Whether two cards say the same, their `at` aside: an A5R host writes a change, or a heartbeat. */
export const sameCard = (a: HostCard | null, b: HostCard): boolean => a !== null && JSON.stringify({ ...a, at: 0 }) === JSON.stringify({ ...b, at: 0 })
