// A5R rev 42 (L-46; Hai: "Ngày ít nhất 2 lần, còn giờ cố định thì tôi nghĩ nên linh động tùy vào tình hình các session"):
// A124, main is synced at least twice a day, timed to the sessions. MEASURED (audit): 2 merges of main in 7 days, the
// shared branch 312 commits off main, 3 wip/revert pairs from the drift; the 28 Oct 15:00 sync expired because its holder
// was gone. A5R plans and hands a sync on through the same path as the person (register.ts syncAction, every guard of it),
// and only the would-be holder's A5R does, so two sessions never plan at once; a sync whose holder is lost with nobody to
// take it is cancelled the way an expiry is written (any session, sync.json's own read-compare-write). Pure: no `$`.
import { CUTOFF_MS, RELEASE_BEFORE_MS, hhmm, isOpenPhase, livenessOf, noticeText, type LaneBeat, type Phase, type SessionFile, type SyncFile } from './coord.ts'
import { isQuietFor } from './truth.ts'

const MIN = 60_000
/** A sync is due when none ran or was planned for this long. */
export const SYNC_EVERY_MS = 6 * 3_600_000
/** An auto-planned sync is at least this far ahead (its cutoff 15 min after the plan, so every session hears it in time). */
export const SYNC_LEAD_MS = 45 * MIN
/** The hours an auto-planned sync may start in (machine time): morning to noon, and the evening; with the 6-h rule that is
 * two or more a day while sessions run. */
export const SYNC_HOURS: readonly (readonly [number, number])[] = [
  [7, 13],
  [16, 22],
]
/** The sync conductor: a session whose title or lane names the sync of main (e.g. "S2 sync main", lane sync-main). */
export const CONDUCTOR = /\bsync[\s_-]*main\b/i

export const isConductor = (f: SessionFile, titleOf: (id8: string) => string): boolean => [titleOf(f.id8), f.title, f.lane].some(t => CONDUCTOR.test(t ?? ''))
const isAlive = (id8: string, x: { files: readonly SessionFile[]; lanes: readonly LaneBeat[]; now: number }): boolean => livenessOf(id8, x.files, x.lanes, x.now) === 'alive'

/** The session that holds an auto-planned sync: a live conductor (the first by id), else the last sync's holder while it is
 * alive; never `except` (a gone holder being replaced). */
export const syncHolderOf = (x: { files: readonly SessionFile[]; lanes: readonly LaneBeat[]; now: number; last: SyncFile | null; titleOf: (id8: string) => string; except?: string }): SessionFile | null =>
  [...x.files].sort((a, b) => a.id8.localeCompare(b.id8)).find(f => f.id8 !== x.except && isConductor(f, x.titleOf) && isAlive(f.id8, x)) ??
  x.files.find(f => f.id8 !== x.except && f.id8 === x.last?.holder.id8 && isAlive(f.id8, x)) ??
  null

/** A planned sync's holder is lost once it is gone (no heartbeat, no lane) for 30 min (a reload or a short gap keeps it), or
 * is gone when the Editor must be released for the sync (T − 10 min); after T the freeze rules (D8) apply. A lost holder's
 * sync is handed to a live sync holder session at once; with none it stays open to a takeover by hand until T − 10 min, and
 * is cancelled then (it would expire at T). */
export const HOLDER_LOST_MS = 30 * MIN
const isLastCall = (s: SyncFile, now: number): boolean => now >= s.at - RELEASE_BEFORE_MS
const isHolderLost = (s: SyncFile, x: Pick<AutoSyncInput, 'phase' | 'files' | 'lanes' | 'now'>): boolean =>
  (x.phase === 'planned' || x.phase === 'cutoff') && isQuietFor(s.holder.id8, x, isLastCall(s, x.now) ? 0 : HOLDER_LOST_MS)

export const inSyncHours = (at: number): boolean => {
  const h = new Date(at).getHours()
  return SYNC_HOURS.some(([from, to]) => h >= from && h < to)
}
const quarterUp = (ms: number): number => Math.ceil(ms / (15 * MIN)) * 15 * MIN

export type AutoSyncInput = { sync: SyncFile | null; phase: Phase; files: readonly SessionFile[]; lanes: readonly LaneBeat[]; now: number; titleOf: (id8: string) => string; queued: number; lockEnd: number | null; isFocusRunning: boolean }
/** What A5R does about the sync now: plan one (`holder` plans it, at `at`); hand a planned sync whose holder is gone to the
 * next live holder (`take`: that session takes it over) or, with none, cancel it (any session, one writer); tell the person
 * no sync holder is live; or nothing, and why. */
export type AutoSync = { kind: 'plan'; at: number; holder: SessionFile } | { kind: 'take'; holder: SessionFile } | { kind: 'cancel'; note: string } | { kind: 'no-holder'; since: number } | { kind: 'none'; why: string }

/** The note of a sync A5R cancelled because its holder was lost: such a sync did not run, so the next one is planned as soon
 * as a holder is live (a sync the person cancelled waits the 6 h like any other). */
export const LOST_NOTE = 'holder lost: '
const lastSyncAt = (s: SyncFile | null): number => (!s || (s.state === 'cancelled' && s.note.startsWith(LOST_NOTE)) ? 0 : Math.max(s.at, s.updatedAt))

export const autoSyncOf = (x: AutoSyncInput): AutoSync => {
  const none = (why: string): AutoSync => ({ kind: 'none', why })
  const s = x.sync
  if (s && isHolderLost(s, x)) {
    const next = syncHolderOf({ ...x, last: null, except: s.holder.id8 })
    if (next) return { kind: 'take', holder: next }
    if (isLastCall(s, x.now)) return { kind: 'cancel', note: `${LOST_NOTE}${s.holder.lane} (session ${s.holder.id8}) is gone and no sync holder session is live` }
  }
  if (s && isOpenPhase(x.phase)) return none('a sync is open')
  const lastAt = lastSyncAt(s)
  if (x.now - lastAt < SYNC_EVERY_MS) return none(`the last sync was ${hhmm(lastAt)}`)
  const holder = syncHolderOf({ ...x, last: s })
  if (!holder) return { kind: 'no-holder', since: lastAt }
  if (x.isFocusRunning) return none('a Focus runs')
  if (x.queued > 1) return none(`${x.queued} sessions are queued for the Editor`)
  const at = quarterUp(Math.max(x.now + SYNC_LEAD_MS, (x.lockEnd ?? 0) + CUTOFF_MS))
  return inSyncHours(at) ? { kind: 'plan', at, holder } : none(`${hhmm(at)} is outside the sync hours`)
}

/** What the person is told (a toast, by the one session that claims it): a sync A5R cancelled for want of a holder, or, once a
 * day, that no sync can be planned because no sync holder session is live ('' otherwise). */
export const holderMissingText = (a: AutoSync, now: number): string => {
  const next = 'open the sync conductor session (a title or lane with "sync main"), or plan a sync yourself (/a5r sync HH:MM)'
  if (a.kind === 'cancel') return noticeText('Sync main', `the planned sync was cancelled: its ${a.note.slice(LOST_NOTE.length)}`, `${next}; A5R plans the next one once a holder is live`)
  return a.kind === 'no-holder' ? noticeText('Sync main', `main has not been synced${a.since > 0 ? ` for ${Math.floor((now - a.since) / 3_600_000)} h` : ''} and no sync holder session is live`, next) : ''
}
