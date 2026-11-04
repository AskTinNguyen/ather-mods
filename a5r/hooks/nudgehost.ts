// A91 (rev 32), the host side, as it was in register.ts, on closures (rev 45 needed the room). The rule is nudge.ts's.
import { oneLine, type LaneBeat, type SessionFile } from './coord.ts'
import { parseTail } from './judge.ts'
import { NUDGE_EVERY_MS, NUDGE_MAX, nudgeCandidates, saysWaitingForEditor } from './nudge.ts'

export type NudgeIo = {
  /** A session's record, its last 64 KB ('' when unread). */
  tail: (session: string) => Promise<string>
  /** The times of the nudges in a session's inbox. */
  nudgedAts: (id8: string) => Promise<number[]>
  nudge: (id8: string, window: string, now: number, freeGb: number | null) => Promise<void>
  claimAlert: (key: string) => Promise<boolean>
  nudgeLog: (f: SessionFile, note: string, now: number) => Promise<void>
}

/** A91: while the Editor is free and no live session is queued, the idle S2 sessions whose last assistant message says they wait
 * for the Editor, PIE, a slot, the lock or memory get one nudge each per free window, at most 3 in a window: each target and each
 * of the 3 slots is claimed (one writer, an exact cap), the nudge goes to the target's inbox and is logged. */
export const nudges = () => {
  /** Tails already read in the current free window, by session and its last turn: an idle session is read once a window. */
  let read = { window: '', seen: new Set<string>() }
  const claimSlot = async (io: NudgeIo, window: string): Promise<boolean> => {
    for (let k = 0; k < NUDGE_MAX; k += 1) if (await io.claimAlert(`nudge-${window}-slot-${k}`)) return true
    return false
  }
  return async (io: NudgeIo, x: { all: readonly SessionFile[]; lanes: readonly LaneBeat[]; now: number; window: string | null; queued: number; freeGb: number | null }): Promise<void> => {
    const { all, lanes, now, window } = x
    if (!window || x.queued > 0) return
    if (read.window !== window) read = { window, seen: new Set() }
    for (const f of nudgeCandidates(all, lanes, now).filter(c => !read.seen.has(`${c.id8}:${c.lastTurnAt}`))) {
      read.seen.add(`${f.id8}:${f.lastTurnAt}`)
      // Review: at most one nudge an hour per session, whatever the window.
      if ((await io.nudgedAts(f.id8)).some(at => now - at < NUDGE_EVERY_MS)) continue
      const last = parseTail(f.session ? await io.tail(f.session) : '').filter(e => e.role === 'assistant' && e.text).pop()
      if (!last || !saysWaitingForEditor(last.text) || !(await io.claimAlert(`nudge-${window}-${f.id8}`))) continue
      // The target's claim above is spent even when no slot is left: harmless, the window's cap is reached anyway.
      if (!(await claimSlot(io, window))) return // 3 sent in this window
      await io.nudge(f.id8, window, now, x.freeGb)
      await io.nudgeLog(f, `the Editor is free (window ${window}), nobody queued; its last message: ${oneLine(last.text).slice(0, 100)}`, now)
    }
  }
}
