// A5R rev 38 (L-42: the Editor sat free 13 h overnight while two sessions were queued and nothing recorded why). Pure: no
// `$`; register.ts logs, pushes and delivers. A112 each session's own wait decision on record; A114 a queued session idle
// an hour (nudge.ts idleMsOf) while only memory holds it back is told what holds the memory, once an hour.
import { MEMORY_NOTE_ID, heavyList, type Decision, type Gates, type Probe, type Want } from './coord.ts'

/** A112: a wait decision is logged when its code or place changes, else at most this often. */
export const WAIT_LOG_EVERY_MS = 15 * 60_000
export type WaitLogged = { key: string; at: number }
type Wait = Extract<Decision, { kind: 'wait' }>

export const waitKey = (d: Wait): string => `${d.code}:${d.place}`

/** A112: whether this wait goes on record now: none logged yet (in this run: a reload logs once more), its code or place
 * changed, or 15 min since the last line. */
export const isWaitLogDue = (last: WaitLogged | null, d: Wait, now: number): boolean => last === null || last.key !== waitKey(d) || now - last.at >= WAIT_LOG_EVERY_MS

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
 * Editor runs), and not told in the last hour. */
export const MEMORY_NOTE_IDLE_MS = 60 * 60_000
export const isMemoryNoteDue = (x: { d: Decision | null; idleMs: number; lastAt: number; now: number }): boolean =>
  x.d?.kind === 'wait' && x.d.code === 'ram' && x.idleMs >= MEMORY_NOTE_IDLE_MS && x.now - x.lastAt >= MEMORY_NOTE_IDLE_MS

/** A114: when the memory note was last told, from the delivered notice ids (kept in the session file across a reload). */
export const lastMemoryNote = (delivered: Iterable<string>): number => {
  let at = 0
  for (const id of delivered) if (id.startsWith(MEMORY_NOTE_ID)) at = Math.max(at, Number(id.slice(MEMORY_NOTE_ID.length)) || 0)
  return at
}
