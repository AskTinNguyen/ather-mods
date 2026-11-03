// Rev 44 (L-48), the host side of the git turn and the stale index.lock, on closures (no `$`: register.ts hands it this
// session's state once and the engine's reads and writes per call). A128: the claim taken before a shared-checkout git
// write runs and given back when the call returns; the session a claim refused told when the turn frees. A129: the call's
// long timeout and the refusal of a write that could be cut short. A130: a stale index.lock moved aside. The rules are
// gitturn.ts's.
import { DIR, checkoutGitPids, isOpenPhase, type GitBusy, type LookRow, type Notice, type Phase, type Probe, type SessionFile, type SyncFile } from './coord.ts'
import type { FileIo } from './freezehost.ts'
import { gitPlace, walkDeep, type Seg } from './gitshared.ts'
import { GIT_TURN_DIR, LOCK_UNREAD_LOOK, STALE_LOCK_MOVED_FILE, TURN_GATE, TURN_NEXT, busyText, cutProblem, goneAfter, heldBy, lockMovedText, moveLockArgv, parseGitTurn, parseLockMoved, raisedTimeout, staleLockAct, staleLockName, turnFreeText, turnKey, turnOf, turnVerb, type GitTurn } from './gitturn.ts'

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
  const mine = (): string => `${claimDir()}/${h.me8()}.json`
  const claims = async (io: FileIo): Promise<GitTurn[]> => (await Promise.all((await io.list(claimDir())).filter(f => f.name.endsWith('.json')).map(async f => parseGitTurn(await io.read(`${claimDir()}/${f.name}`))))).filter((c): c is GitTurn => c !== null)
  const holder = async (io: FileIo, now: number): Promise<GitTurn | null> => heldBy(await claims(io), { me8: h.me8(), now, isLive: id => h.isLive(id, now), gone })
  const release = (io: FileIo): Promise<void> => io.write(mine(), 'null')

  /** A130: every condition read again, fresh (the processes, the lock, the claims), by one session (the alert claim): the
   * lock file is moved, never deleted; the move is logged and written for the others to read. */
  const moveStaleLock = async (io: TurnIo, now: number, isClaimed: boolean): Promise<void> => {
    const fresh = await io.gitBusy()
    if (staleLockAct({ lockAgeMs: fresh.lockAgeMs, gitPids: fresh.gitPids, isTurnHeld: isClaimed || (await holder(io, now)) !== null }) !== 'move' || !(await io.claimAlert(`stale-index-lock-${now - (fresh.lockAgeMs ?? 0)}`))) return
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
      const me = h.me()
      if (!me) return null
      const segs = walkDeep(command, await io.cwd(), h.home()).segs
      const writes: Seg[] = []
      for (const seg of segs) if (turnVerb(seg) && (await io.isShared(gitPlace(seg).dir))) writes.push(seg)
      if (writes.length === 0) return null
      const cut = cutProblem(command, segs, writes)
      if (cut) return { deny: `A5R · ${TURN_GATE} — ${cut.why} → ${cut.alt}`, isTaken: false }
      const timeout = raisedTimeout(input.timeout, input.run_in_background === true) ?? undefined
      if (h.isSyncCommand(command) && (await io.isFrozenHolder())) return { timeout, isTaken: false }
      const now = await io.now()
      const refuse = (t: GitTurn) => {
        wait = t
        return { deny: `A5R · ${TURN_GATE} — ${busyText(t)} → ${TURN_NEXT}`, isTaken: false }
      }
      const before = await holder(io, now)
      if (before) return refuse(before)
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
      const lockSt = await io.stat(`${h.root()}/.git/index.lock`)
      const pids = checkoutGitPids(h.probe(), h.root())
      const all = await claims(io)
      gone = goneAfter(gone, all, pids === null ? null : pids.length > 0 || lockSt !== null, now)
      const own = all.find(c => c.id8 === h.me8())
      if (own && calls === 0 && isBackground && now - (gone.get(turnKey(own)) ?? now) >= 2 * 60_000) {
        isBackground = false
        await release(io)
      }
      const held = heldBy(all, { me8: h.me8(), now, isLive: id => h.isLive(id, now), gone })
      if (wait && !held) h.push({ id: `git-turn:free:${wait.id8}:${wait.startedAt}`, text: `A5R · ${TURN_GATE} — ${turnFreeText(wait)}`, isActionable: true })
      if (!held) wait = null
      const isClaimed = held !== null || calls > 0 || isBackground
      const act = staleLockAct({ lockAgeMs: lockSt ? now - lockSt.mtimeMs : null, gitPids: pids, isTurnHeld: isClaimed })
      look = act === 'unread' ? LOCK_UNREAD_LOOK : null
      if (act === 'move') await moveStaleLock(io, now, isClaimed)
      const moved = parseLockMoved(await io.read(`${h.dir()}/${STALE_LOCK_MOVED_FILE}`))
      const s = h.sync()
      const isHolder = s?.holder.id8 === h.me8() && isOpenPhase(h.phaseOf(s, now))
      if (moved && now - moved.at < 30 * 60_000 && ((lockFailAt > 0 && lockFailAt <= moved.at) || isHolder)) h.push({ id: `index-lock-moved:${moved.at}`, text: `A5R · Git — ${lockMovedText(moved)}`, isActionable: true })
    },
    /** A130: the NEEDS A LOOK rows while a stale-looking lock cannot be judged (none otherwise). */
    looks: (): LookRow[] => (look ? [look] : []),
    /** A130: this session's git failed on .git/index.lock. */
    lockFailed: (at: number): void => {
      lockFailAt = at
    },
  }
}
