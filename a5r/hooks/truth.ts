// A5R rev 42 (L-46, the week's audit: "the numbers and alerts tell the truth"): A125. Recorded waits counted the hours a
// request sat on file while its session was gone (421 h recorded against 124.5 h live), PIE was never seen without an MCP
// call (`pieAt` 0 of 87), the no-editor alert fired on 133 of 137 leases, 338 alert files were kept, 7 requests of gone
// sessions stayed on file and about 30 sessions were told of each sync's freeze. Pure: no `$`; register.ts reads, writes
// and delivers.
import { psQuote } from './a5r.ts'
import { buildProcs, isUnrealProc, livenessOf, lockTimes, unrealPids, type LaneBeat, type LockLine, type Probe, type SessionFile, type Want } from './coord.ts'

const MIN = 60_000

// ---------- live waits ----------
/** A request's wait counts only while its own session's minute runs (it is alive): a gap longer than this between two of its
 * minutes (a session asleep, closed or gone) adds only this much. */
export const WAIT_STEP_MAX_MS = 2 * MIN
/** The request after one more minute of its own session: the time since it last counted (at most WAIT_STEP_MAX_MS) added to
 * `waited`; a request from an A5R before 0.26.0 starts from its time on file, as it was counted then. */
export const liveWait = (w: Want, now: number): Want => ({ ...w, waited: w.waited === undefined ? Math.max(0, now - w.requestedAt) : w.waited + Math.min(Math.max(0, now - (w.waitAt ?? now)), WAIT_STEP_MAX_MS), waitAt: now })
/** A new request starts its live wait at 0 (a forced release's kept place too: its place is old, its wait is new); asking
 * again while it waits keeps what it waited. */
export const waitStart = (had: Want | null | undefined, now: number): Pick<Want, 'waited' | 'waitAt'> => (had?.waited === undefined ? { waited: 0, waitAt: now } : { waited: had.waited, waitAt: had.waitAt ?? now })
/** How long a request has waited live, in minutes, as any session reads its file now. */
export const liveWaitMin = (w: Want, now: number): number => Math.round((liveWait(w, now).waited ?? 0) / MIN)

// ---------- the last sign of life ----------
/** When a session last showed it is alive: its A5R heartbeat, its last turn and its Ather lane (beat or activity), the
 * latest of them; null when there is nothing to read (no file and no lane). `needsTurn`: with no turn on record the answer is
 * null too (A123: unknown is never quiet). The 2-h withdrawal (A125), the 30-min orphan (A123) and the lost sync holder (A124)
 * all count from it. */
export const lastSignOf = (id8: string, files: readonly SessionFile[], lanes: readonly LaneBeat[], needsTurn = false): number | null => {
  const f = files.find(s => s.id8 === id8)
  const lane = lanes.find(l => l.sessionId.toLowerCase().startsWith(id8))
  if ((!f && !lane) || (needsTurn && f?.lastTurnAt === undefined)) return null
  return Math.max(f?.heartbeatAt ?? 0, f?.lastTurnAt ?? 0, lane?.mtimeMs ?? 0, lane?.lastActiveAt ?? 0)
}
/** Gone (no fresh heartbeat or lane, A58) and quiet this long by its last sign of life; unknown is never quiet. */
export const isQuietFor = (id8: string, x: { files: readonly SessionFile[]; lanes: readonly LaneBeat[]; now: number }, ms: number, needsTurn = false): boolean => {
  const last = lastSignOf(id8, x.files, x.lanes, needsTurn)
  return last !== null && x.now - last >= ms && livenessOf(id8, x.files, x.lanes, x.now) === 'gone'
}

// ---------- stale requests ----------
/** A request whose session has been gone this long is withdrawn. */
export const STALE_WANT_MS = 2 * 3_600_000
/** The requests to withdraw: a session gone and quiet for 2 h or more, asking and holding nothing (a gone holder's lease is
 * the lapse rules'). The one write A5R makes to another session's file (register.ts tidyStep, read-compare-write): its
 * session is gone, and if it comes back it asks again. */
export const staleWants = (files: readonly SessionFile[], lanes: readonly LaneBeat[], now: number): SessionFile[] => files.filter(f => f.want && !f.holding && isQuietFor(f.id8, { files, lanes, now }, STALE_WANT_MS))

// ---------- PIE from the probe ----------
/** An Unreal Editor window whose title says a Play-In-Editor session runs (a PIE in its own window). Best effort: a PIE in
 * the level viewport changes no window title. */
export const PIE_WINDOW = /\bPreview \[NetMode|\(PIE\)/i
const escaped = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const slash = (s: string): string => s.replace(/\\/g, '/').toLowerCase()
/** Whether a command line names this path as a whole (quoted or bare; never a longer name that starts with it): a file
 * (a .uproject) ends at a space or quote; a folder (`isDir`) may go on with a `/`. */
export const namesPath = (cmd: string, path: string, isDir = false): boolean => {
  const want = slash(path).replace(/\/$/, '')
  const at = want ? slash(cmd).indexOf(want) : -1
  if (at < 0) return false
  const before = slash(cmd)[at - 1] ?? ' '
  const after = slash(cmd)[at + want.length] ?? ' '
  return /[\s"'=]/.test(before) && (isDir ? /[\s"'/]/ : /[\s"']/).test(after)
}
/** The shared checkout as a command line may name it: its folder and its .uproject. */
export type Shared = { root: string; uproject: string }
/** Whether the probe sees PIE running: an Unreal Editor whose window title is a PIE window, or a Python run of one of the
 * person's PIE drivers (the `pieDrivers` option, script names in lower case; none by default, so no project's script is named
 * in the plugin). With `shared`, only the shared checkout's: a PIE window of its .uproject, a driver whose command line names
 * the checkout or its .uproject (the lease's PIE note: another project's PIE is not this lease's). With null, any (A123's
 * close: a driver run from inside the checkout names no path, and unknown is PIE). */
export const pieSeen = (probe: Probe | null, drivers: readonly string[], shared: Shared | null): boolean =>
  (probe?.procs ?? []).some(p =>
    isUnrealProc(p)
      ? PIE_WINDOW.test(p.title ?? '') && (!shared || namesPath(p.cmd ?? '', shared.uproject))
      : /^python/i.test(p.name) && drivers.some(d => new RegExp(`(^|[\\\\/\\s"'])${escaped(d)}($|[\\s"'])`, 'i').test(p.cmd ?? '')) && (!shared || namesPath(p.cmd ?? '', shared.root, true) || namesPath(p.cmd ?? '', shared.uproject)),
  )

// ---------- the no-editor alert ----------
/** A lease held this long with no Unreal Editor and no build at any point is worth the no-editor line. */
export const NO_EDITOR_MS = 30 * MIN
/** Whether the lock's lease has been held 30 min or more with no Editor and no build at any point: none runs now, and its
 * holder's own notes (the first Editor and the first build it saw, A100) say none ran since the grant. A holder without an
 * A5R file (or a lease its file does not hold) is read from the probe alone. */
export const isNoEditorLease = (x: { lock: LockLine; holder: SessionFile | undefined; now: number; probe: Probe }): boolean => {
  const t = lockTimes(x.lock, x.now)
  if (!t || x.now - t.since < NO_EDITOR_MS || unrealPids(x.probe).length > 0 || buildProcs(x.probe).length > 0) return false
  const h = x.holder?.holding
  return !h || Math.abs(h.since - t.since) >= MIN || (h.notes?.editorAt === undefined && h.notes?.buildAt === undefined)
}

// ---------- alert files ----------
/** Alert files (the one-writer claims of Saved/A5R/alerts) are kept this long. */
export const ALERT_KEEP_MS = 7 * 24 * 3_600_000
/** At most this many are removed in one pass (the next day's pass takes the rest). */
export const PRUNE_MAX = 200
/** The alert files to remove: claim files (a plain name ending .json) older than 7 days. */
export const prunable = (entries: readonly { name: string; kind: string; mtimeMs: number }[], now: number): string[] =>
  entries.filter(e => e.kind === 'file' && /^[\w.-]+\.json$/.test(e.name) && now - e.mtimeMs >= ALERT_KEEP_MS).map(e => e.name).slice(0, PRUNE_MAX)
/** The removal of those files (their own names in that folder only, never a wildcard). */
export const pruneArgv = (dir: string, names: readonly string[]): string[] => ['powershell', '-NoProfile', '-NonInteractive', '-Command', `Remove-Item -LiteralPath ${names.map(n => psQuote(`${dir}/${n}`)).join(',')} -ErrorAction SilentlyContinue`]

// ---------- who hears a sync's cutoff and freeze ----------
/** A82 / A125: the sync's cutoff and freeze concern its holder, a session with uncommitted changes in the shared checkout
 * (its own edits there, or a shell command that may write there, since its last commit there), and a session holding or
 * asking for the Editor; any other session hears only the lift. */
export const isSyncConcerned = (x: { isHolder: boolean; touched: number; sharedShellAt: number | null; holds: boolean; wants: boolean }): boolean => x.isHolder || x.touched > 0 || x.sharedShellAt !== null || x.holds || x.wants
