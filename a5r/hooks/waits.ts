// A5R rev 38 (L-42: the Editor sat free 13 h overnight while two sessions were queued and nothing recorded why). Pure: no
// `$`; register.ts logs, pushes and delivers. A112 each session's own wait decision on record; A114 a queued session idle
// an hour (nudge.ts idleMsOf) while only memory holds it back is told what holds the memory, once an hour.
import { MEMORY_NOTE_ID, heavyList, type Decision, type Gates, type Probe, type WaitCode, type Want } from './coord.ts'

/** A112: a wait decision is logged when its place changes, when a new code has held 2 min (Fable review D6: free RAM
 * around a gate does not churn the log), else at most every 15 min. */
export const WAIT_LOG_EVERY_MS = 15 * 60_000
export const WAIT_CODE_HOLD_MS = 2 * 60_000
type Wait = Extract<Decision, { kind: 'wait' }>
/** The last line's code, place and time, and a new code seen since it (with when it was first seen). */
export type WaitLogged = { code: WaitCode; place: number; at: number; next: { code: WaitCode; since: number } | null }

/** A112: the state after this decision, and whether it goes on record now (none logged yet in this run: a reload logs
 * once more). */
export const waitLogOf = (last: WaitLogged | null, d: Wait, now: number): { state: WaitLogged; isDue: boolean } => {
  const logged = { state: { code: d.code, place: d.place, at: now, next: null }, isDue: true }
  if (last === null || last.place !== d.place) return logged
  if (last.code === d.code) return now - last.at >= WAIT_LOG_EVERY_MS ? logged : { state: { ...last, next: null }, isDue: false }
  if (last.next?.code === d.code) return now - last.next.since >= WAIT_CODE_HOLD_MS ? logged : { state: last, isDue: false }
  return { state: { ...last, next: { code: d.code, since: now } }, isDue: false }
}

/** A112: the line's note: the code, free RAM, this request's launch gate, its place, the heaviest processes (keyed words:
 * the log's note filter rewrites a bare "free"). */
export const waitNote = (d: Wait, want: Want, probe: Probe | null, gates: Gates): string =>
  [
    `wait ${d.code}`,
    `freeGb ${probe ? probe.freeGb : 'unknown'}`,
    `gateGb ${want.launch === false ? 'none (launch false)' : `${want.pie ? gates.pieGb : gates.nopieGb}${want.pie ? ' (PIE)' : ''}`}`,
    `place ${d.place}`,
    `heavy ${probe ? heavyList(probe, 3) : 'unknown'}`,
  ].join(' · ')

/** A114: the memory note: queued, idle at least an hour, held back only by memory (the code `ram`: the lock is free and no
 * Editor runs). Fable review D8: told once, then at most every 3 h, so every memory-held session hears what holds the
 * memory (a later one too, which may itself not fit) without a wake an hour all night. */
export const MEMORY_NOTE_IDLE_MS = 60 * 60_000
export const MEMORY_NOTE_AGAIN_MS = 3 * 3_600_000
export const isMemoryNoteDue = (x: { d: Decision | null; idleMs: number; lastAt: number; now: number }): boolean =>
  x.d?.kind === 'wait' && x.d.code === 'ram' && x.idleMs >= MEMORY_NOTE_IDLE_MS && x.now - x.lastAt >= MEMORY_NOTE_AGAIN_MS

/** A114: when the memory note was last told, from the delivered notice ids (kept in the session file across a reload). */
export const lastMemoryNote = (delivered: Iterable<string>): number => {
  let at = 0
  for (const id of delivered) if (id.startsWith(MEMORY_NOTE_ID)) at = Math.max(at, Number(id.slice(MEMORY_NOTE_ID.length)) || 0)
  return at
}
