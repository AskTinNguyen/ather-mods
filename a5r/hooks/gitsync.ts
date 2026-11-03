// Rev 44 (L-48): the host side of A128-A134, on closures (no `$`: register.ts hands it the reads, writes and state it
// needs: State44 once, Io44 per call). A128: the git turn taken and given back around a call, and the session a turn refused told when it
// frees. A129: the call's long timeout and the refusal of a git write that could be cut short. A130: a stale index.lock
// moved aside. A131-A132: the step the sync is in, the needs it refused, each step told once (woken for what it frees).
// A133: the measured times, the timeline line, what each Editor wait waits for. A134: the band, the prompt's line and
// toast, Saved/A5R/status.json. The decisions themselves are gitturn.ts's and syncplan.ts's.
import { under } from './a5r.ts'
import { DIR, checkoutGitPids, claimIn, gitWrites, isOpenPhase, isSyncCommandOnly, type GitBusy, type GrantInput, type LookRow, type Notice, type Phase, type Probe, type SessionFile, type SyncFile } from './coord.ts'
import { gitPlace, walkDeep } from './gitshared.ts'
import { GIT_TURN_FILE, LOCK_UNREAD_LOOK, STALE_LOCK_MOVED_FILE, TURN_GATE, TURN_NEXT, TURN_VERBS, busyText, cutProblem, goneAfter, lockMovedText, moveLockArgv, parseGitTurn, parseLockMoved, raisedTimeout, readTurn, staleLockAct, staleLockName, turnFreeText, turnOf, type GitTurn } from './gitturn.ts'
import { expectedStarts, queueView, appendCapped } from './lease.ts'
import { NO_TIMES, STATUS_FILE, SYNC_TIMES_FILE, aheadOf, bandLine, buildMsOf, editorWaits, freesAny, freezeStepOf, isMoved, parseSyncTimes, promptLine, shortLine, statusAtOf, statusOf, stepNotice, timelineLine, timesLine, toastText, type FreezeStep, type Need } from './syncplan.ts'
import { readBuildLog, type BuildLogRead } from './syncstage.ts'

/** What register.ts hands over for one call: the engine's reads and writes, as closures over that call's engine. */
export type Io44 = {
  now: () => Promise<number>
  read: (path: string) => Promise<string | null>
  write: (path: string, text: string) => Promise<void>
  stat: (path: string) => Promise<{ mtimeMs: number } | null>
  list: (dir: string) => Promise<{ name: string; mtimeMs: number }[]>
  run: (argv: string[], timeoutMs: number) => Promise<{ exitCode: number; stdout: string } | null>
  toast: (text: string) => void
  /** orchestrate.log, rule stale-index-lock */
  log: (note: string, now: number) => Promise<void>
  claimAlert: (key: string) => Promise<boolean>
  /** a fresh probe of the checkout's git processes and its index.lock's age (register.ts gitBusy) */
  gitBusy: () => Promise<GitBusy>
  isSharedWrite: (writes: { verb: string; dir: string }[]) => Promise<boolean>
  isFrozenHolder: () => Promise<boolean>
  cwd: () => Promise<string>
}
/** This session's state as register.ts last read it, and its notice queue. */
export type State44 = {
  push: (n: Notice) => void
  home: () => string
  me: () => SessionFile | null
  me8: () => string
  sync: () => SyncFile | null
  probe: () => Probe | null
  isLive: (id8: string, now: number) => boolean
  phaseOf: (s: SyncFile | null, now: number) => Phase
  grantInput: (now: number) => GrantInput
  dir: () => string
  root: () => string
}

export const git44 = (h: State44) => {
  /** In this process: this session's calls under its git turn, this reader's "the turn's git gone since", the turn that
   * refused it, its last git that failed on index.lock, the freeze needs refused per sync, the step and lift told per
   * sync, the measured times and build logs read, the files the merge changed, the build log of this run as read, the
   * NEEDS A LOOK row, the sync whose toast it showed. */
  const g = { turnUse: 0, gone: null as { key: string; since: number } | null, wait: null as GitTurn | null, lockFailAt: 0, refused: { id: '', needs: new Set<Need>() }, told: new Map<string, { step: FreezeStep; lift: number | null; moved: boolean }>(), times: NO_TIMES, timesAt: -Infinity, builds: new Map<string, number | null>(), changed: { sha: '', paths: new Set<string>() }, log: { path: '', mtime: 0, read: null as BuildLogRead | null }, look: null as LookRow | null, toasted: '' }
  const turnPath = (): string => `${h.dir()}/${GIT_TURN_FILE}`
  const turnNow = async (io: Io44, now: number) => readTurn(parseGitTurn(await io.read(turnPath())), { me8: h.me8(), now, isLive: id => h.isLive(id, now), gone: g.gone })
  /** A131: the sync's step as last read, or read fresh with its build log of this run when that changed. */
  const stepCached = (s: SyncFile | null, now: number): FreezeStep | null => (s ? freezeStepOf(h.phaseOf(s, now), s.stage, g.log.path === s.buildLog ? g.log.read : null) : null)
  const stepNow = async (io: Io44, s: SyncFile | null, now: number): Promise<FreezeStep | null> => {
    const st = s?.stage === 'building' && s.buildLog ? await io.stat(s.buildLog) : null
    if (s && st && st.mtimeMs >= (s.workerAt ?? s.stageAt) && (g.log.path !== s.buildLog || g.log.mtime !== st.mtimeMs)) g.log = { path: s.buildLog, mtime: st.mtimeMs, read: readBuildLog((await io.read(s.buildLog)) ?? '', st.mtimeMs).log }
    return stepCached(s, now)
  }
  /** A133: the sync's one line, as every place A5R speaks shows it. */
  const lineNow = (s: SyncFile, now: number): string => timelineLine(s, h.phaseOf(s, now), stepCached(s, now), g.times, now)

  /** A133: what each queued session waits for and when its turn is expected: the Editor comes back after the holder's end
   * and, in a sync's cutoff or freeze, after the sync's lift (unknown while the lift is). `withMe`: this session too when
   * it is not queued (an Editor refusal), its turn after the last queued one. */
  const waitsNow = (now: number, withMe = false): { texts: Map<string, string>; starts: Map<string, number> } => {
    const x = h.grantInput(now)
    const view = queueView(x)
    if (claimIn(x)?.kind === 'focus') return { texts: new Map(), starts: new Map() } // A119: the rows say their start after the Focus
    const s = claimIn(x)?.kind === 'sync' ? h.sync() : null
    const lift = s ? aheadOf(s, stepCached(s, now), g.times, now).lift : null
    const base = Math.max(now, view.holder && !view.holder.isSyncSlot ? (view.holder.end ?? now) : now, lift ?? now)
    const starts = expectedStarts(x, base)
    const me8 = h.me8()
    const rows = withMe && !view.rows.some(r => r.id8 === me8) ? [...view.rows, { id8: me8, lane: h.me()?.lane ?? me8 }] : view.rows
    if (rows !== view.rows) starts.set(me8, view.rows.reduce((at, r) => at + r.minutes * 60_000, base))
    return { texts: editorWaits({ holder: view.holder, rows, sync: s && { lane: s.holder.lane, word: s.build ? 'build and tests' : 'merge and tests', at: lift }, starts, isKnown: !s || lift !== null }), starts }
  }

  /** A128 / A130 at the minute: whether the turn's git is seen gone; the session a turn refused is told when it frees
   * (woken when idle); an index.lock git left behind is moved aside; a moved lock is told to the sessions it failed and to
   * the sync holder. */
  const gitStep = async (io: Io44, now: number): Promise<void> => {
    const lockSt = await io.stat(`${h.root()}/.git/index.lock`)
    const pids = checkoutGitPids(h.probe(), h.root())
    g.gone = goneAfter(g.gone, parseGitTurn(await io.read(turnPath())), pids === null ? null : pids.length > 0 || lockSt !== null, now)
    const r = await turnNow(io, now)
    if (g.wait && r.kind !== 'held') h.push({ id: `git-turn:free:${g.wait.id8}:${g.wait.startedAt}`, text: `A5R · ${TURN_GATE} — ${turnFreeText(g.wait)}`, isActionable: true })
    if (r.kind !== 'held') g.wait = null
    const act = staleLockAct({ lockAgeMs: lockSt ? now - lockSt.mtimeMs : null, gitPids: pids, isTurnHeld: r.kind === 'held' || r.kind === 'mine' })
    g.look = act === 'unread' ? LOCK_UNREAD_LOOK : null
    if (act === 'move') await moveStaleLock(io, now)
    const moved = parseLockMoved(await io.read(`${h.dir()}/${STALE_LOCK_MOVED_FILE}`))
    const s = h.sync()
    const isHolder = s?.holder.id8 === h.me8() && isOpenPhase(h.phaseOf(s, now))
    if (moved && now - moved.at < 30 * 60_000 && ((g.lockFailAt > 0 && g.lockFailAt <= moved.at) || isHolder)) h.push({ id: `index-lock-moved:${moved.at}`, text: `A5R · Git — ${lockMovedText(moved)}`, isActionable: true })
  }
  /** A130: every condition read again, fresh (the processes, the lock, the turn), by one session (the alert claim): the
   * lock file is moved, never deleted; the move is logged and written for the others to read. */
  const moveStaleLock = async (io: Io44, now: number): Promise<void> => {
    const fresh = await io.gitBusy()
    const r = await turnNow(io, now)
    if (staleLockAct({ lockAgeMs: fresh.lockAgeMs, gitPids: fresh.gitPids, isTurnHeld: r.kind === 'held' || r.kind === 'mine' }) !== 'move' || !(await io.claimAlert(`stale-index-lock-${now - (fresh.lockAgeMs ?? 0)}`))) return
    const to = `${h.dir()}/${staleLockName(now)}`
    const ran = await io.run(moveLockArgv(`${h.root()}/.git/index.lock`, to), 30_000)
    if (ran?.exitCode !== 0 || !(await io.stat(to))) return
    const m = { at: now, to: `${DIR}/${staleLockName(now)}`, ageMin: Math.floor((fresh.lockAgeMs ?? 0) / 60_000) }
    await io.write(`${h.dir()}/${STALE_LOCK_MOVED_FILE}`, JSON.stringify(m))
    await io.log(`moved .git/index.lock (${m.ageMin} min old, no git of the checkout running, no git turn held) to ${m.to}`, now)
  }

  /** A133: the measured durations, read again every 5 min: UnrealBuildTool's own total time in each sync build log (each
   * read until it has one) and the merge and tests times the holders recorded; A131: the files the merge changed. */
  const timesStep = async (io: Io44, now: number): Promise<void> => {
    const s = h.sync()
    if (s?.mergeSha && s.preHead && g.changed.sha !== s.mergeSha) {
      const r = await io.run(['git', '-C', h.root(), 'diff', '--name-only', '-z', s.preHead, s.mergeSha], 30_000)
      if (r?.exitCode === 0) g.changed = { sha: s.mergeSha, paths: new Set(r.stdout.split('\0').filter(Boolean).map(p => p.toLowerCase())) }
    }
    if (now - g.timesAt < 5 * 60_000) return
    g.timesAt = now
    const logs = (await io.list(h.dir())).filter(f => /^sync-.*-build\.log$/.test(f.name)).sort((a, b) => a.mtimeMs - b.mtimeMs)
    for (const f of logs) if ((g.builds.get(f.name) ?? null) === null) g.builds.set(f.name, buildMsOf((await io.read(`${h.dir()}/${f.name}`)) ?? ''))
    g.times = parseSyncTimes(await io.read(`${h.dir()}/${SYNC_TIMES_FILE}`), logs.flatMap(f => g.builds.get(f.name) ?? []))
  }

  /** A134: Saved/A5R/status.json for outside viewers, written by the minute tick when what it says changed. */
  const statusStep = async (io: Io44, now: number): Promise<void> => {
    const x = h.grantInput(now)
    const view = queueView(x)
    const w = waitsNow(now)
    const claim = claimIn(x)
    const s = h.sync()
    const body = statusOf({ now, sync: s, phase: h.phaseOf(s, now), step: await stepNow(io, s, now), times: g.times, holder: view.holder && { lane: view.holder.lane, id8: view.holder.id8, end: view.holder.end }, queue: view.rows.map(r => ({ place: r.place, lane: r.lane, id8: r.id8, startsAt: w.starts.get(r.id8) ?? null, waitsFor: w.texts.get(r.id8) ?? '' })), focus: claim?.kind === 'focus' ? { lane: claim.lane, id8: claim.id8, end: claim.end } : null })
    const path = `${h.dir()}/${STATUS_FILE}`
    const cur = await io.read(path)
    if (cur !== JSON.stringify({ ...body, at: statusAtOf(cur) })) await io.write(path, JSON.stringify(body))
  }

  return {
    stepNow,
    lineNow,
    waitsNow,
    /** A128 / A133 / A130 / A134, at the minute (A128 first: a turn freed is told in the same minute). */
    tick: async (io: Io44, now: number): Promise<void> => {
      await gitStep(io, now)
      await timesStep(io, now)
      await statusStep(io, now)
    },
    /** A130: the NEEDS A LOOK row while a stale-looking lock cannot be judged (none otherwise). */
    looks: (): LookRow[] => (g.look ? [g.look] : []),
    /** A131: the files the merge changed (lower case), for the edits a build step holds. */
    changed: (): ReadonlySet<string> => g.changed.paths,
    /** A132: a need the freeze refused this session, for the step that frees it. */
    refused: (s: SyncFile, need: Need): void => {
      if (g.refused.id !== s.id) g.refused = { id: s.id, needs: new Set() }
      g.refused.needs.add(need)
    },
    wasRefused: (s: SyncFile): boolean => g.refused.id === s.id && g.refused.needs.size > 0,
    /** A130: this session's git failed on .git/index.lock. */
    lockFailed: (at: number): void => {
      g.lockFailAt = at
    },

    /** A128 / A129: before a git write in the shared checkout runs: a call that could cut it short is refused; the call
     * gets a long timeout; this session takes the git turn (read-compare-write), or is refused at once naming its holder.
     * Null: no such write. The sync holder's own merge commands in its freeze take no turn (its freeze covers them; its
     * worker is this session, never refused by its own turn). */
    turnStart: async (io: Io44, command: string, input: { timeout?: unknown; run_in_background?: unknown }): Promise<{ deny?: string; timeout?: number; isTaken: boolean } | null> => {
      const writes = gitWrites(command).filter(w => TURN_VERBS.has(w.verb))
      const me = h.me()
      if (!me || writes.length === 0 || !(await io.isSharedWrite(writes))) return null
      const segs = walkDeep(command, await io.cwd(), h.home()).segs
      const cut = cutProblem(command, segs, seg => seg.verb === 'git' && TURN_VERBS.has((gitPlace(seg).args[0] ?? '').toLowerCase()) && under(gitPlace(seg).dir, h.root()))
      if (cut) return { deny: `A5R · ${TURN_GATE} — ${cut.why} → ${cut.alt}`, isTaken: false }
      const timeout = raisedTimeout(input.timeout, input.run_in_background === true) ?? undefined
      if (isSyncCommandOnly(command) && (await io.isFrozenHolder())) return { timeout, isTaken: false }
      const now = await io.now()
      let r = await turnNow(io, now)
      if (r.kind === 'free' || r.kind === 'lapsed') {
        const text = JSON.stringify(turnOf(me, writes.map(w => w.verb), now))
        await io.write(turnPath(), text)
        r = (await io.read(turnPath())) === text ? { kind: 'mine' } : await turnNow(io, now)
      }
      if (r.kind === 'held') {
        g.wait = r.turn
        return { deny: `A5R · ${TURN_GATE} — ${busyText(r.turn)} → ${TURN_NEXT}`, isTaken: false }
      }
      if (r.kind === 'mine') g.turnUse += 1
      return { timeout, isTaken: r.kind === 'mine' }
    },
    /** A128: the call returned: the turn is given back once no other call of this session runs under it (a backgrounded
     * command keeps it until its git is seen gone: then it lapses). */
    turnEnd: async (io: Io44, isBackground: boolean): Promise<void> => {
      g.turnUse = Math.max(0, g.turnUse - 1)
      if (g.turnUse === 0 && !isBackground && parseGitTurn(await io.read(turnPath()))?.id8 === h.me8()) await io.write(turnPath(), 'null')
    },

    /** A131 / A132: each step of the freeze told once to the sessions it concerns (refused in it, queued, with dirty
     * paths), with what is allowed again and the timeline; one refused what the step frees is woken; the lift estimate is
     * told again once when it moves by 15 min or more. */
    stepTell: async (io: Io44, s: SyncFile, isConcerned: boolean, now: number): Promise<void> => {
      const refused = g.refused.id === s.id ? g.refused.needs : new Set<Need>()
      const step = isConcerned || refused.size > 0 ? await stepNow(io, s, now) : null
      if (!step || step === 'cutoff') return
      const told = g.told.get(s.id)
      const lift = aheadOf(s, step, g.times, now).lift
      if (told?.step !== step && (told || step !== 'merging')) h.push({ id: `sync:${s.id}:${s.at}:step:${step}`, text: stepNotice(s, step, told?.step ?? 'merging', lineNow(s, now)), isActionable: freesAny(step, refused) })
      if (told?.step !== step) g.told.set(s.id, { step, lift, moved: false })
      else if (!told.moved && isMoved(told.lift, lift)) {
        h.push({ id: `sync:${s.id}:${s.at}:eta-moved`, text: `A5R · Sync main — the estimate moved by 15 min or more: ${lineNow(s, now)}`, isActionable: false })
        g.told.set(s.id, { ...told, lift, moved: true })
      }
    },
    /** A133: the holder records a step's measured length (merge, tests) for every session's estimates. */
    noteTime: async (io: Io44, id: string, step: 'merge' | 'tests', ms: number, now: number): Promise<void> => {
      const path = `${h.dir()}/${SYNC_TIMES_FILE}`
      await io.write(path, appendCapped((await io.read(path)) ?? '', timesLine(id, step, ms, now), 50))
    },
    /** A133: what this session's Editor use waits for, as a refusal says it ('' when it waits for nothing known). */
    myWait: (now: number): string => {
      const t = queueView(h.grantInput(now)).holder?.id8 === h.me8() ? undefined : waitsNow(now, true).texts.get(h.me8())
      return t ? ` · this session's turn comes ${t}` : ''
    },
    /** A133: the compact line's few words for the sync. */
    shortNow: (s: SyncFile, now: number): string => shortLine(s, h.phaseOf(s, now), stepCached(s, now), g.times, now),
    /** A134: the band's line above the prompt in the sync's cutoff or freeze ('' otherwise). */
    band: (now: number): string => {
      const s = h.sync()
      const step = stepCached(s, now)
      return s && step ? bandLine(s, step, g.times, now) : ''
    },
    /** A134: a person's prompt in the sync's cutoff or freeze: one context line for the model, a toast once per sync. */
    prompt: async (io: Io44): Promise<string | null> => {
      const now = await io.now()
      const s = h.sync()
      const step = await stepNow(io, s, now)
      if (!s || !step) return null
      if (g.toasted !== s.id) io.toast(toastText(s, step, g.times, now))
      g.toasted = s.id
      return promptLine(s, step, g.times, now)
    },
  }
}
