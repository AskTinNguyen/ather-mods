// A91 (rev 32): a nudge to waiting idle sessions when the Editor comes free. Pure: no `$`; register.ts reads the
// transcript tails, claims each nudge, writes it to the target's inbox (Saved/A5R/nudges/<id8>.json) and delivers it there.
import { hash, livenessOf, type LaneBeat, type LockLine, type Phase, type SessionFile } from './coord.ts'

export const NUDGE_IDLE_MS = 10 * 60_000 // no turn for this long
export const NUDGE_ACTIVE_MS = 24 * 3_600_000 // and a turn within this long
export const NUDGE_MAX = 3 // nudges in one free window

/** The free window a FREE lock line opens (its since stamp, else the line itself), or null while the Editor is held, the
 * lock is missing, or a sync is in its cutoff or freeze (grants wait then). */
export const freeWindowOf = (lock: LockLine, phase: Phase): string | null =>
  lock.kind !== 'free' || phase === 'cutoff' || phase === 'frozen' ? null : lock.since || hash(lock.raw)

/** The idle S2 sessions a nudge may go to: alive (their a5r's heartbeat), no turn for 10 min but one within 24 h, no
 * running agent, not queued, not holding; the most recently active first. */
export const nudgeCandidates = (files: readonly SessionFile[], lanes: readonly LaneBeat[], now: number): SessionFile[] =>
  files
    .filter(f => livenessOf(f.id8, files, lanes, now) === 'alive' && typeof f.lastTurnAt === 'number' && now - f.lastTurnAt >= NUDGE_IDLE_MS && now - f.lastTurnAt <= NUDGE_ACTIVE_MS && (f.agents ?? 0) === 0 && !f.want && !f.holding)
    .sort((a, b) => (b.lastTurnAt ?? 0) - (a.lastTurnAt ?? 0))

const RESOURCE = /\b(editor|pie|slot|lock|ram|memory)\b|bộ nhớ/i
const WAITING = /\b(wait(s|ing)?|queued)\b|chờ|đợi|\b(until|once|when) (the )?(editor|pie|slot|lock|ram|memory)\b|\bkhi (editor|pie|ram|slot)\b/i

/** Whether a session's last assistant message says it waits for the Editor, PIE, a slot, the lock or memory (English and
 * Vietnamese): a resource word and a waiting word, both. */
export const saysWaitingForEditor = (text: string): boolean => RESOURCE.test(text) && WAITING.test(text)
