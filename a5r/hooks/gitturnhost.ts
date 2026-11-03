// Rev 44 (L-48), the host side of the git turn and the stale index.lock, on closures (no `$`: register.ts hands it this
// session's state once and the engine's reads and writes per call). A128: the claim taken before a shared-checkout git
// write runs and given back when the call returns; the session a claim refused told when the turn frees. A129: the call's
// long timeout and the refusal of a write that could be cut short. A130: a stale index.lock moved aside. The rules are
// gitturn.ts's.
import { DIR, checkoutGitPids, isOpenPhase, type GitBusy, type LookRow, type Notice, type Phase, type Probe, type SessionFile, type SyncFile } from './coord.ts'
import type { FileIo } from './hostio.ts'
import { gitPlace, walkDeep, type Seg } from './gitshared.ts'
import { GIT_TURN_DIR, LOCK_UNREAD_LOOK, STALE_LOCK_MS, TURN_LAPSE_MS, untargetedGitPids, STALE_LOCK_MOVED_FILE, TURN_GATE, TURN_NEXT, busyText, cutProblem, goneAfter, heldBy, lockMovedText, moveLockArgv, parseGitTurn, parseLockMoved, raisedTimeout, staleLockAct, staleLockName, turnFreeText, turnKey, turnOf, turnVerb, type GitTurn } from './gitturn.ts'

/** The engine's reads and writes for one call, and the host's own checks this needs. */
export type TurnIo = FileIo & {
  /** orchestrate.log, rule stale-index-lock */
  log: (note: string, now: number) => Promise<void>
  claimAlert: (key: string) => Promise<boolean>
  /** a fresh probe of the checkout's git processes and its index.lock's age (register.ts gitBusy) */
  gitBusy: () => Promise<GitBusy>
  /** whether a folder is in the shared checkout's own tree (register.ts isSharedDir: never a worktree) */
  isShared: (dir: string) => Promise<boolean>
  isFrozenHolder: () => Promise<boolean>
  cwd: () => Promise<string>
  /** Fable 3: this session's id, for its claim when it does not coordinate the checkout (it runs no tick, has no file) */
  sessionId: () => Promise<string>
}
/** This session's state as register.ts last read it. */
export type TurnState = {
  push: (n: Notice) => void
  home: () => string
  me: () => SessionFile | null
  me8: () => string
  sync: () => SyncFile | null
  probe: () => Probe | null
  isLive: (id8: string, now: number) => boolean
  phaseOf: (s: SyncFile | null, now: number) => Phase
  /** the sync holder's own merge commands (coord.ts isSyncCommandOnly), which its freeze covers */
  isSyncCommand: (command: string) => boolean
  dir: () => string
  root: () => string
}

/** Fable 2: the stand-in claim for an index.lock no claim explains (its id8 is empty: told free once the lock is gone). */
const LOCK_TURN = (now: number): GitTurn => ({ v: 1, session: '', id8: '', lane: '.git/index.lock', command: 'a git command', startedAt: now })

export const gitTurns = (h: TurnState) => {
  /** In this process: this session's foreground calls under its claim and whether a backgrounded one ran under it, since
   * when this reader has seen each claim's git gone, the claim that refused it, its last git that failed on index.lock,
   * the NEEDS A LOOK row. */
  let calls = 0
  let isBackground = false
  let gone = new Map<string, number>()
  let wait: GitTurn | null = null
  let lockFailAt = 0
  let look: LookRow | null = null
  const claimDir = (): string => `${h.dir()}/${GIT_TURN_DIR}`
  /** This session's id8 as its claim names it (its file's, else its own id's: Fable 3). */
  let self = ''
  const me8 = (): string => h.me8() || self
  const mine = (): string => `${claimDir()}/${me8()}.json`
  /** The claims on file, each with when its owner last wrote it (an owner rewrites its claim every minute while its
   * foreground call runs). */
  const claimsAt = async (io: FileIo): Promise<{ turn: GitTurn; at: number }[]> => (await Promise.all((await io.list(claimDir())).filter(f => f.name.endsWith('.json')).map(async f => ({ turn: parseGitTurn(await io.read(`${claimDir()}/${f.name}`)), at: f.mtimeMs })))).flatMap(c => (c.turn ? [{ turn: c.turn, at: c.at }] : []))
  /** Fable 1: a claim's git is seen gone when no git of the checkout runs and its index.lock, if any, is 2 min old or
   * older (a lock git left behind keeps no claim alive), unless its owner rewrote the claim within 2 min (its call runs). */
  const observe = async (io: FileIo, now: number): Promise<{ all: GitTurn[]; lockSt: { mtimeMs: number } | null; pids: number[] | null }> => {
    const lockSt = await io.stat(`${h.root()}/.git/index.lock`)
    const pids = checkoutGitPids(h.probe(), h.root())
    const at = await claimsAt(io)
    const isRunning = pids === null ? null : pids.length > 0 || (lockSt !== null && now - lockSt.mtimeMs < STALE_LOCK_MS)
    gone = goneAfter(gone, at.map(c => c.turn), isRunning, now)
    return { all: at.map(c => c.turn), lockSt, pids }
  }
  /** The claim that holds the turn against this session; a claim its owner rewrote within 2 min does not lapse. */
  const holder = async (io: FileIo, now: number): Promise<GitTurn | null> => {
    const at = await claimsAt(io)
    const fresh = new Set(at.filter(c => now - c.at < TURN_LAPSE_MS).map(c => turnKey(c.turn)))
    return heldBy(at.map(c => c.turn), { me8: me8(), now, isLive: id => h.isLive(id, now), gone: new Map([...gone].filter(([k]) => !fresh.has(k))) })
  }
  const release = (io: FileIo): Promise<void> => io.write(mine(), 'null')
  /** Fable 4: the git processes that may hold the lock: those of the checkout and those whose folder cannot be read. */
  const lockPids = (pids: number[] | null): number[] | null => (pids === null ? null : [...pids, ...untargetedGitPids(h.probe())])

  /** A130: every condition read again, fresh (the processes, the lock, the claims), by one session (the alert claim): the
   * lock file is moved, never deleted; the move is logged and written for the others to read. */
  const moveStaleLock = async (io: TurnIo, now: number, isClaimed: boolean): Promise<void> => {
    const fresh = await io.gitBusy()
    if (staleLockAct({ lockAgeMs: fresh.lockAgeMs, gitPids: lockPids(fresh.gitPids), isTurnHeld: isClaimed || (await holder(io, now)) !== null }) !== 'move' || !(await io.claimAlert(`stale-index-lock-${now - (fresh.lockAgeMs ?? 0)}`))) return
    const to = `${h.dir()}/${staleLockName(now)}`
    const ran = await io.run(moveLockArgv(`${h.root()}/.git/index.lock`, to), 30_000)
    if (ran?.exitCode !== 0 || !(await io.stat(to))) return
    const m = { at: now, to: `${DIR}/${staleLockName(now)}`, ageMin: Math.floor((fresh.lockAgeMs ?? 0) / 60_000) }
    await io.write(`${h.dir()}/${STALE_LOCK_MOVED_FILE}`, JSON.stringify(m))
    await io.log(`moved .git/index.lock (${m.ageMin} min old, no git of the checkout running, no git turn held) to ${m.to}`, now)
  }

  return {
    /** A128 / A129: before a git write in the shared checkout runs: a call that could cut it short is refused; the call
     * gets a long timeout; this session claims the turn, or is refused at once naming the claim that holds it. Null: no
     * such write. The sync holder's own merge commands in its freeze take no turn; its worker is this session. */
    start: async (io: TurnIo, command: string, input: { timeout?: unknown; run_in_background?: unknown }): Promise<{ deny?: string; timeout?: number; isTaken: boolean } | null> => {
      const id = await io.sessionId()
      const me = h.me() ?? { session: id, id8: id.slice(0, 8).toLowerCase(), lane: `session-${id.slice(0, 8).toLowerCase()}` } // Fable 3: a session outside the checkout writes it too
      self = me.id8
      const segs = walkDeep(command, await io.cwd(), h.home()).segs
      const writes: Seg[] = []
      for (const seg of segs) if (turnVerb(seg) && (await io.isShared(gitPlace(seg).dir))) writes.push(seg)
      if (writes.length === 0) return null
      const cut = cutProblem(command, segs, writes)
      if (cut) return { deny: `A5R · ${TURN_GATE} — ${cut.why} → ${cut.alt}`, isTaken: false }
      const timeout = raisedTimeout(input.timeout, input.run_in_background === true) ?? undefined
      const now = await io.now()
      const refuse = (t: GitTurn) => {
        wait = t
        return { deny: `A5R · ${TURN_GATE} — ${busyText(t)} → ${TURN_NEXT}`, isTaken: false }
      }
      const before = await holder(io, now)
      if (before) return refuse(before)
      // Fable 2: the sync's own merge takes no claim (its freeze covers it) but never runs over another session's git.
      if (h.isSyncCommand(command) && (await io.isFrozenHolder())) return (await io.stat(`${h.root()}/.git/index.lock`)) ? refuse(LOCK_TURN(now)) : { timeout, isTaken: false }
      if (calls === 0 && !isBackground) await io.write(mine(), JSON.stringify(turnOf(me, writes.map(turnVerb), now)))
      const after = await holder(io, now) // another claim written meanwhile: both step back, neither writes over the other
      if (after) {
        if (calls === 0 && !isBackground) await release(io)
        return refuse(after)
      }
      calls += 1
      isBackground ||= input.run_in_background === true
      return { timeout, isTaken: true }
    },
    /** A128: the call returned: the claim is given back once no other foreground call of this session runs under it and
     * none ran in the background (a backgrounded git is given back at the minute once its git is seen gone). */
    end: async (io: FileIo): Promise<void> => {
      calls = Math.max(0, calls - 1)
      if (calls === 0 && !isBackground) await release(io)
    },
    /** A128 / A130 at the minute: each claim's git seen gone or not; a backgrounded claim of this session given back once
     * its git is gone; the session a claim refused told when the turn frees (woken when idle); an index.lock git left
     * behind moved aside; a moved lock told to the sessions it failed and to the sync holder. */
    tick: async (io: TurnIo, now: number): Promise<void> => {
      const { all, lockSt, pids } = await observe(io, now)
      const own = all.find(c => c.id8 === me8())
      if (own && calls > 0) await io.write(mine(), JSON.stringify(own)) // its call runs: the claim stays fresh
      if (own && calls === 0 && isBackground && now - (gone.get(turnKey(own)) ?? now) >= TURN_LAPSE_MS) {
        isBackground = false
        await release(io)
      }
      const held = await holder(io, now)
      if (wait && !held && !(wait.id8 === '' && lockSt)) h.push({ id: `git-turn:free:${wait.id8}:${wait.startedAt}`, text: `A5R · ${TURN_GATE} — ${turnFreeText(wait)}`, isActionable: true })
      if (!held && !(wait?.id8 === '' && lockSt)) wait = null
      const isClaimed = held !== null || calls > 0 || isBackground
      const act = staleLockAct({ lockAgeMs: lockSt ? now - lockSt.mtimeMs : null, gitPids: lockPids(pids), isTurnHeld: isClaimed })
      look = act === 'unread' ? LOCK_UNREAD_LOOK : null
      if (act === 'move') await moveStaleLock(io, now, isClaimed)
      const moved = parseLockMoved(await io.read(`${h.dir()}/${STALE_LOCK_MOVED_FILE}`))
      const s = h.sync()
      const isHolder = s?.holder.id8 === h.me8() && isOpenPhase(h.phaseOf(s, now))
      if (moved && now - moved.at < 30 * 60_000 && ((lockFailAt > 0 && lockFailAt <= moved.at) || isHolder)) h.push({ id: `index-lock-moved:${moved.at}`, text: `A5R · Git — ${lockMovedText(moved)}`, isActionable: true })
    },
    /** Fable 2: whether the sync's worker must wait for another session's git (a live claim, or .git/index.lock); the
     * holder is told once a minute and woken when it is free. */
    blocksMerge: async (io: FileIo, now: number): Promise<boolean> => {
      const t = (await holder(io, now)) ?? ((await io.stat(`${h.root()}/.git/index.lock`)) ? LOCK_TURN(now) : null)
      if (!t) return false
      wait = t
      h.push({ id: `git-turn:merge-waits:${Math.floor(now / 60_000)}`, text: `A5R · ${TURN_GATE} — the sync's merge waits: ${busyText(t)} → A5R starts the sync worker once git is free (you are told)`, isActionable: false })
      return true
    },
    /** A130: the NEEDS A LOOK rows while a stale-looking lock cannot be judged (none otherwise). */
    looks: (): LookRow[] => (look ? [look] : []),
    /** A130: this session's git failed on .git/index.lock. */
    lockFailed: (at: number): void => {
      lockFailAt = at
    },
  }
}
