// A91 (rev 32): a nudge to waiting idle sessions when the Editor comes free. Pure: no `$`; the conductor (wakehost.ts, A140)
// reads the transcript tails and claims each nudge; it goes to the target's inbox (Saved/A5R/nudges/<id8>.json) and its own
// A5R delivers it there.
import { hash, type Claim, type LockLine } from './coord.ts'

export const NUDGE_IDLE_MS = 10 * 60_000 // A91 / A114: idle: no turn for this long (and nothing running: idleMsOf)
export const NUDGE_MAX = 3 // nudges in one free window

/** The free window a FREE lock line opens (its since stamp, else the line itself), or null while the Editor is held, the
 * lock is missing, or a claim stands (a sync in its cutoff or freeze, A118 a running Focus: grants wait for it). */
export const freeWindowOf = (lock: LockLine, claim: Claim | null): string | null =>
  lock.kind !== 'free' || claim ? null : lock.since || hash(lock.raw)

/** A91 / A114: how long a session has been idle: no main-loop turn signal (a prompt, a tool call, a turn's end) since, no
 * main-loop tool call and no background agent running (0 while any runs). Another session's file has only its last turn
 * and its agents; a session's own A5R knows its turn signals and running calls too. */
export const idleMsOf = (x: { now: number; lastTurnAt: number | undefined; turnSignalAt: number; mainCalls: number; agents: number }): number =>
  x.mainCalls > 0 || x.agents > 0 ? 0 : Math.max(0, x.now - Math.max(x.lastTurnAt ?? 0, x.turnSignalAt))
export const isIdle = (idleMs: number): boolean => idleMs >= NUDGE_IDLE_MS

const RESOURCE = /\b(editor|pie|slot|lock|ram|memory)\b|bộ nhớ/i
const WAITING = /\b(wait(s|ing)?|queued)\b|chờ|đợi|\b(until|once|when) (the )?(editor|pie|slot|lock|ram|memory)\b|\bkhi (editor|pie|ram|slot)\b/i

/** Whether a session's last assistant message says it waits for the Editor, PIE, a slot, the lock or memory (English and
 * Vietnamese): a resource word and a waiting word, both. */
export const saysWaitingForEditor = (text: string): boolean => RESOURCE.test(text) && WAITING.test(text)
