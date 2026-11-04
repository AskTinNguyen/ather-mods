// Rev 44 (L-48), the host side of the sync freeze in steps and of what everyone waits for, on closures (no `$`:
// register.ts hands it this session's state once and the engine's file reads and writes per call). A131: the step the
// sync is in (its build log of this run read when it changes), the files the merge changed, the needs refused. A132: each
// step told once, an idle session woken for what it frees. A133: the measured times, the timeline line, what each Editor
// wait waits for. A134: the band, the prompt's line and toast, Saved/A5R/status.json. The rules are syncplan.ts's.
import { claimIn, type GrantInput, type Notice, type Phase, type SessionFile, type SyncFile } from './coord.ts'
import { STOPPED_WORDS, appendCapped, queueTimes, queueView } from './lease.ts'
import { STATUS_FILE, SYNC_TIMES_FILE, NO_TIMES, aheadOf, bandLine, buildMsOf, editorWaits, freesAny, freezeStepOf, isMoved, parseSyncTimes, promptLine, shortLine, statusAtOf, statusOf, stepNotice, timelineLine, timesLine, toastText, type FreezeStep, type Need } from './syncplan.ts'
import { readBuildLog, type BuildLogRead } from './syncstage.ts'
import type { FileIo } from './hostio.ts'
import type { WakeStatus } from './wake.ts'

/** This session's state as register.ts last read it. */
export type FreezeState = {
  push: (n: Notice) => void
  me: () => SessionFile | null
  me8: () => string
  sync: () => SyncFile | null
  phaseOf: (s: SyncFile | null, now: number) => Phase
  grantInput: (now: number) => GrantInput
  dir: () => string
  root: () => string
  /** Fable 11: whether this session writes status.json (one session: the first live one in the queue order, else by id) */
  isStatusWriter: (now: number) => boolean
  /** A139 / A141: what status.json says of stopped requests and the idle-with-work minutes */
  wakeStatus: (now: number) => WakeStatus
}

export const freezeSteps = (h: FreezeState) => {
  /** In this process: the build log of this run as read, the files the merge changed, the needs refused per sync, the
   * step and lift told per sync, the measured times and the build logs read, the sync whose toast was shown. */
  let log: { path: string; mtime: number; read: BuildLogRead | null } = { path: '', mtime: 0, read: null }
  let changed = { sha: '', paths: new Set<string>() }
  let refused = { id: '', needs: new Set<Need>() }
  const told = new Map<string, { step: FreezeStep; lift: number | null; moved: boolean }>()
  let times = NO_TIMES
  let timesAt = -Infinity
  const builds = new Map<string, { ms: number | null; mtime: number }>()
  let toasted = ''

  /** A131: the files the merge changed (`git diff --name-only <pre-merge HEAD> <merge>`), read once per merge. */
  const readChanged = async (io: FileIo, s: SyncFile): Promise<void> => {
    const r = await io.run(['git', '-C', h.root(), 'diff', '--name-only', '-z', s.preHead, s.mergeSha], 30_000)
    if (r?.exitCode === 0) changed = { sha: s.mergeSha, paths: new Set(r.stdout.split('\0').filter(Boolean).map(p => p.toLowerCase())) }
  }
  /** A131: the sync's step as last read, or read fresh with its build log of this run when that changed. */
  const stepCached = (s: SyncFile | null, now: number): FreezeStep | null => (s ? freezeStepOf(h.phaseOf(s, now), s.stage, log.path === s.buildLog ? log.read : null) : null)
  const stepNow = async (io: FileIo, s: SyncFile | null, now: number): Promise<FreezeStep | null> => {
    if (s?.mergeSha && s.preHead && changed.sha !== s.mergeSha) await readChanged(io, s) // Fable 10: no lag of a minute
    const st = s?.stage === 'building' && s.buildLog ? await io.stat(s.buildLog) : null
    if (s && st && st.mtimeMs >= (s.workerAt ?? s.stageAt) && (log.path !== s.buildLog || log.mtime !== st.mtimeMs)) log = { path: s.buildLog, mtime: st.mtimeMs, read: readBuildLog((await io.read(s.buildLog)) ?? '', st.mtimeMs).log }
    return stepCached(s, now)
  }
  const lineNow = (s: SyncFile, now: number): string => timelineLine(s, h.phaseOf(s, now), stepCached(s, now), times, now)

  /** A133: what each queued session waits for and when its turn is expected: the Editor comes back after the holder's end
   * and, in a sync's cutoff or freeze, after the sync's lift (unknown while the lift is). `withMe`: this session too when
   * it is not queued (an Editor refusal), its turn after the last queued one. A119: while a Focus runs the rows say their
   * start after it. */
  const waitsNow = (now: number, withMe = false): { texts: Map<string, string>; starts: Map<string, number> } => {
    const x = h.grantInput(now)
    const claim = claimIn(x)
    if (claim?.kind === 'focus') return { texts: new Map(), starts: new Map() }
    const view = queueView(x)
    const s = claim?.kind === 'sync' ? h.sync() : null
    const lift = s ? aheadOf(s, stepCached(s, now), times, now).lift : null
    const { starts, end } = queueTimes(x, Math.max(now, view.holder && !view.holder.isSyncSlot ? (view.holder.end ?? now) : now, lift ?? now))
    const me8 = h.me8()
    const isAdded = withMe && !view.rows.some(r => r.id8 === me8)
    if (isAdded) starts.set(me8, end)
    const rows = isAdded ? [...view.rows, { id8: me8, lane: h.me()?.lane ?? me8 }] : view.rows
    return { texts: editorWaits({ holder: view.holder, rows, sync: s && { lane: s.holder.lane, word: s.build ? 'build and tests' : 'merge and tests', at: lift }, starts, isKnown: !s || lift !== null }), starts }
  }

  /** A133: the measured durations, read again every 5 min (UnrealBuildTool's own total time in each sync build log, each
   * read again only when it changed; the merge and tests times the holders recorded). */
  const timesStep = async (io: FileIo, now: number): Promise<void> => {
    if (now - timesAt < 5 * 60_000) return
    timesAt = now
    const logs = (await io.list(h.dir())).filter(f => /^sync-.*-build\.log$/.test(f.name)).sort((a, b) => a.mtimeMs - b.mtimeMs)
    for (const f of logs) if (builds.get(f.name)?.mtime !== f.mtimeMs) builds.set(f.name, { ms: buildMsOf((await io.read(`${h.dir()}/${f.name}`)) ?? ''), mtime: f.mtimeMs }) // Fable 11: a log is read again only when it changed
    times = parseSyncTimes(await io.read(`${h.dir()}/${SYNC_TIMES_FILE}`), logs.flatMap(f => builds.get(f.name)?.ms ?? []))
  }

  /** A134: Saved/A5R/status.json for outside viewers, written when what it says changed. */
  const statusStep = async (io: FileIo, now: number): Promise<void> => {
    if (!h.isStatusWriter(now)) return
    const x = h.grantInput(now)
    const view = queueView(x)
    const w = waitsNow(now)
    const claim = claimIn(x)
    const s = h.sync()
    const body = statusOf({ now, sync: s, phase: h.phaseOf(s, now), step: await stepNow(io, s, now), times, holder: view.holder && { lane: view.holder.lane, id8: view.holder.id8, end: view.holder.end }, queue: view.rows.map(r => ({ place: r.place, lane: r.lane, id8: r.id8, startsAt: w.starts.get(r.id8) ?? null, waitsFor: (r.isStopped ? STOPPED_WORDS : w.texts.get(r.id8)) ?? '', ...(r.isStopped ? { stopped: true as const } : {}) })), focus: claim?.kind === 'focus' ? { lane: claim.lane, id8: claim.id8, end: claim.end } : null, wake: h.wakeStatus(now) })
    const path = `${h.dir()}/${STATUS_FILE}`
    const cur = await io.read(path)
    if (cur !== JSON.stringify({ ...body, at: statusAtOf(cur) })) await io.write(path, JSON.stringify(body))
  }

  return {
    stepNow,
    lineNow,
    waitsNow,
    /** A133: the compact line's few words for the sync. */
    shortNow: (s: SyncFile, now: number): string => shortLine(s, h.phaseOf(s, now), stepCached(s, now), times, now),
    /** A133 / A134, at the minute: the measured times, then status.json. */
    tick: async (io: FileIo, now: number): Promise<void> => {
      await timesStep(io, now)
      await statusStep(io, now)
    },
    /** A131: the files the merge changed (lower case), for the edits a build step holds. */
    changed: (): ReadonlySet<string> => changed.paths,
    /** A132: a need the freeze refused this session, for the step that frees it. */
    refused: (s: SyncFile, need: Need): void => {
      if (refused.id !== s.id) refused = { id: s.id, needs: new Set() }
      refused.needs.add(need)
    },
    wasRefused: (s: SyncFile): boolean => refused.id === s.id && refused.needs.size > 0,
    /** A131 / A132: each step of the freeze told once to the sessions it concerns (refused in it, queued, with dirty
     * paths), with what is allowed again and the timeline; one refused what the step frees is woken; the lift estimate is
     * told again once when it moves by 15 min or more. The freeze's start is the frozen notice's (register.ts). */
    stepTell: async (io: FileIo, s: SyncFile, isConcerned: boolean, now: number): Promise<void> => {
      const needs = refused.id === s.id ? refused.needs : new Set<Need>()
      const step = isConcerned || needs.size > 0 ? await stepNow(io, s, now) : null
      if (!step || step === 'cutoff') return
      const was = told.get(s.id)
      const lift = aheadOf(s, step, times, now).lift
      if (was?.step !== step && (was || step !== 'merging')) h.push({ id: `sync:${s.id}:${s.at}:step:${step}`, text: stepNotice(step, was?.step ?? 'merging', lineNow(s, now)), isActionable: freesAny(step, needs) })
      if (was?.step !== step) told.set(s.id, { step, lift, moved: false })
      else if (!was.moved && isMoved(was.lift, lift)) {
        h.push({ id: `sync:${s.id}:${s.at}:eta-moved`, text: `A5R · Sync main — the estimate moved by 15 min or more: ${lineNow(s, now)}`, isActionable: false })
        told.set(s.id, { ...was, lift, moved: true })
      }
    },
    /** A133: the holder records a step's measured length (merge, tests) for every session's estimates. */
    noteTime: async (io: FileIo, id: string, step: 'merge' | 'tests', ms: number, now: number): Promise<void> => {
      const path = `${h.dir()}/${SYNC_TIMES_FILE}`
      await io.write(path, appendCapped((await io.read(path)) ?? '', timesLine(id, step, ms, now), 50))
    },
    /** A133: what this session's Editor use waits for, as a refusal says it ('' when it holds the Editor or waits for
     * nothing known). */
    myWait: (now: number): string => {
      const t = queueView(h.grantInput(now)).holder?.id8 === h.me8() ? undefined : waitsNow(now, true).texts.get(h.me8())
      return t ? ` · this session's turn comes ${t}` : ''
    },
    /** A134: the band's line above the prompt in the sync's cutoff or freeze ('' otherwise). */
    band: (now: number): string => {
      const s = h.sync()
      const step = stepCached(s, now)
      return s && step ? bandLine(s, step, times, now) : ''
    },
    /** A134: during the sync's cutoff or freeze, the context line a person's prompt carries, and the toast to show (once
     * per sync; null after); null outside them. */
    prompt: async (io: FileIo): Promise<{ line: string; toast: string | null } | null> => {
      const now = await io.now()
      const s = h.sync()
      const step = await stepNow(io, s, now)
      if (!s || !step) return null
      const toast = toasted === s.id ? null : toastText(s, step, times, now)
      toasted = s.id
      return { line: promptLine(s, step, times, now), toast }
    },
  }
}
