// A91 (rev 32): a nudge to waiting idle sessions when the Editor comes free. Pure: no `$`; register.ts reads the
// transcript tails, claims each nudge, writes it to the target's inbox (Saved/A5R/nudges/<id8>.json) and delivers it there.
import { hash, livenessOf, type LaneBeat, type LockLine, type Phase, type SessionFile } from './coord.ts'

export const NUDGE_IDLE_MS = 10 * 60_000 // A91 / A114: idle: no turn for this long (and nothing running: idleMsOf)
export const NUDGE_ACTIVE_MS = 24 * 3_600_000 // and a turn within this long
export const NUDGE_MAX = 3 // nudges in one free window
export const NUDGE_EVERY_MS = 60 * 60_000 // at most one nudge an hour per session, across windows

/** The free window a FREE lock line opens (its since stamp, else the line itself), or null while the Editor is held, the
 * lock is missing, or a sync is in its cutoff or freeze (grants wait then). */
export const freeWindowOf = (lock: LockLine, phase: Phase): string | null =>
  lock.kind !== 'free' || phase === 'cutoff' || phase === 'frozen' ? null : lock.since || hash(lock.raw)

/** A91 / A114: how long a session has been idle: no main-loop turn signal (a prompt, a tool call, a turn's end) since, no
 * main-loop tool call and no background agent running (0 while any runs). Another session's file has only its last turn
 * and its agents; a session's own A5R knows its turn signals and running calls too. */
export const idleMsOf = (x: { now: number; lastTurnAt: number | undefined; turnSignalAt: number; mainCalls: number; agents: number }): number =>
  x.mainCalls > 0 || x.agents > 0 ? 0 : Math.max(0, x.now - Math.max(x.lastTurnAt ?? 0, x.turnSignalAt))
export const isIdle = (idleMs: number): boolean => idleMs >= NUDGE_IDLE_MS

/** The idle S2 sessions a nudge may go to: alive (their a5r's heartbeat), no turn for 10 min but one within 24 h, no
 * running agent, not queued, not holding; the most recently active first. */
export const nudgeCandidates = (files: readonly SessionFile[], lanes: readonly LaneBeat[], now: number): SessionFile[] =>
  files
    .filter(f => livenessOf(f.id8, files, lanes, now) === 'alive' && typeof f.lastTurnAt === 'number' && isIdle(idleMsOf({ now, lastTurnAt: f.lastTurnAt, turnSignalAt: 0, mainCalls: 0, agents: f.agents ?? 0 })) && now - f.lastTurnAt <= NUDGE_ACTIVE_MS && !f.want && !f.holding)
    .sort((a, b) => (b.lastTurnAt ?? 0) - (a.lastTurnAt ?? 0))

const RESOURCE = /\b(editor|pie|slot|lock|ram|memory)\b|bộ nhớ/i
const WAITING = /\b(wait(s|ing)?|queued)\b|chờ|đợi|\b(until|once|when) (the )?(editor|pie|slot|lock|ram|memory)\b|\bkhi (editor|pie|ram|slot)\b/i

/** Whether a session's last assistant message says it waits for the Editor, PIE, a slot, the lock or memory (English and
 * Vietnamese): a resource word and a waiting word, both. */
export const saysWaitingForEditor = (text: string): boolean => RESOURCE.test(text) && WAITING.test(text)
