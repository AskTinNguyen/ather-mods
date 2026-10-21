// A93-A95 (rev 32): after the merge, a sync goes on in stages until a real end: building (the merge is in, its build runs,
// often longer than a worker's tool calls) → testing (the build succeeded, or the sync does not build; the holder runs the
// post-merge headless tests) → done (with the test result line, A95) or aborted (the holder's abort). A96 (rev 33): a
// worker that aborts, or ends with no merge commit, hands the sync back to its holder in the manual stage (finish it by
// hand, or abort). Every other session stays frozen through every stage; the lift goes out only at done, abort or
// expiry. Pure: no `$`; register.ts gathers the facts (the worker's last line, git's HEAD, the build log, the build
// processes) and applies the moves decided here.
import { LOCK_WAIT, SCRIPT_END } from './buildscript.ts'
import type { SyncEnd, SyncFile } from './coord.ts'

export type SyncStage = 'building' | 'testing' | 'manual'

/** A93 / A96: the stages after a merge commit (a gone holder hands them to a live session); before the merge, and in the
 * manual stage, a gone holder expires the sync. */
export const isMergedStage = (stage: SyncStage | null): boolean => stage === 'building' || stage === 'testing'
/** The stage as the panel and status name what the holder does. */
export const stageWord = (stage: SyncStage | null): string => (stage === null ? 'merging' : stage === 'manual' ? 'finishing by hand' : stage)

/** A96: the time the holder has at least, from when the worker hands the sync back, to finish it by hand or abort. */
export const MANUAL_MIN_MS = 30 * 60_000

/** A93: how long the hard end is put back, once, while the build process still runs near it. */
export const BUILD_EXTEND_MS = 30 * 60_000
/** A93: how long after its stage began a build with no log and no process is reported as unknown (it may be starting). */
export const STAGE_GRACE_MS = 2 * 60_000

/** A95: the S2 standard's post-merge headless tests (the checkout's docs/skills/s2-build-test.md, "Run all Sipher
 * tests"); `<ENGINE>` is the engine root the sync's build used (its script's exit line names it, A110). */
export const POST_MERGE_TESTS = '"<ENGINE>\\Engine\\Binaries\\Win64\\UnrealEditor-Cmd.exe" "<PROJECT>\\S2.uproject" -ExecCmds="Automation RunTests Sipher" -TestExit="Automation Test Queue Empty" -unattended -NullRHI -NoSound -NoSplash -log (docs/skills/s2-build-test.md)'

/** A95: a test result line (the automation run's own exit line, or a count of passed or failed tests), or an explicit
 * "tests skipped: <why>": the `;`-separated part of the note that holds it, else null. */
const TEST_RESULT = /\bEXIT CODE:\s*-?\d+|\bTEST COMPLETE\b|\b\d+\s+(tests?\s+)?(passed|failed|succeeded)\b|\bResult=\{?(Success|Fail)/i
const TESTS_SKIPPED = /\btests skipped:\s*\S/i
export const testsOf = (note: string): string | null => {
  const m = TESTS_SKIPPED.exec(note) ?? TEST_RESULT.exec(note)
  if (!m) return null
  const to = note.indexOf(';', m.index)
  return note.slice(note.lastIndexOf(';', m.index) + 1, to < 0 ? undefined : to).trim()
}
/** A95: the tests as the done notice names them ("tests: …"), or null. */
export const testsLabel = (note: string): string | null => {
  const t = testsOf(note)
  return t === null ? null : /^tests\b/i.test(t) ? t : `tests: ${t}`
}

/** A93: the build's own last `Result:` line in its log (Build.bat exits 0 on failure, so only this line counts). The log is
 * the sync's own fresh file (named by A5R, written with `>`), and register.ts reads it only when written after the worker
 * started (A109: a quick build can end before the worker does), so an earlier run's Result cannot reach here. */
export const buildResultOf = (log: string): 'Succeeded' | 'Failed' | null => {
  let last: 'Succeeded' | 'Failed' | null = null
  for (const m of log.matchAll(/\bResult:\s*(Succeeded|Failed)\b/g)) last = m[1] === 'Succeeded' ? 'Succeeded' : 'Failed'
  return last
}

/** A109: the sync's build log as A5R reads it (null: no file of this run): absent; running (written, no end yet); queued
 * (its last line is Build.bat's wait for another Build.bat on the same engine: started, behind the lock); ended (the build
 * script's own exit or refusal line with no Result: line); or the build's own Result. */
export type BuildLogRead = 'absent' | 'running' | 'queued' | 'ended' | 'Succeeded' | 'Failed'
/** `mtime`: the log's write time (0: none); `isFinal`: the script's own exit or refusal line is in (the log no longer
 * changes); `tail`: its last three lines as a notice quotes them. */
export type BuildLog = { log: BuildLogRead; mtime: number; isFinal: boolean; tail: string }
const lastLines = (text: string, n: number): string[] => text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(-n)
/** The log of this run (`text` null: none). */
export const readBuildLog = (text: string | null, mtime: number): BuildLog => {
  if (text === null) return { log: 'absent', mtime: 0, isFinal: false, tail: '' }
  const last = lastLines(text, 3)
  const isFinal = SCRIPT_END.test(text)
  const log = buildResultOf(text) ?? (isFinal ? 'ended' : LOCK_WAIT.test(last[last.length - 1] ?? '') ? 'queued' : 'running')
  return { log, mtime, isFinal, tail: last.map(l => `"${l.slice(0, 160)}"`).join(' | ') }
}

/** A109: what a build log with no Result: line says by itself: `building` (written: the script writes it before Build.bat
 * starts) and `build-queued` (Build.bat's lock line last), both quiet; `build-ended` (the script ended with no Result:, read
 * why). With no log, or a Result:, nothing here: the entry and the watch decide (entryTell, stageNext). Another lane's
 * dotnet, cl or Live Coding never stands for this sync's build (review of rev 36). */
export type BuildTell = 'building' | 'build-queued' | 'build-unknown' | 'build-ended' | 'build-stopped'
export const logTell = (log: BuildLogRead): BuildTell | null => (log === 'ended' ? 'build-ended' : log === 'queued' ? 'build-queued' : log === 'running' ? 'building' : null)

/** A93: the sync's own build log, a fresh file per sync (Build.bat's output written with `>`, never appended to; A109: the
 * build script appends only its own exit line after it). */
export const syncBuildLog = (checkout: string, syncId: string): string => `${checkout}/Saved/A5R/${syncId}-build.log`

/** A93: what git says of the merge. `merged`: a merge commit on top of the pre-merge HEAD the holder's a5r recorded (no
 * record: any merge commit). `none`: POSITIVE evidence of no merge, HEAD readable and still the pre-merge HEAD. `unknown`:
 * anything else (git timed out or failed, HEAD moved some other way): never read as no merge (review of rev 32: a slow git
 * must not lift a freeze under a running build). */
export type MergeRead = { state: 'merged'; sha: string } | { state: 'none' } | { state: 'unknown' }
export const readMerge = (headLine: string | null, preHead: string): MergeRead => {
  if (headLine === null) return { state: 'unknown' }
  const [sha, first, second] = headLine.trim().toLowerCase().split(/\s+/)
  const pre = preHead.trim().toLowerCase()
  if (sha && first && second && (!pre || first === pre)) return { state: 'merged', sha }
  return sha && pre && sha === pre ? { state: 'none' } : { state: 'unknown' }
}

/** A93 / A96: what the worker's end makes of the sync: done (a SYNC DONE that carries the post-merge tests), or a stage:
 * git shows the merge (building when the sync builds and the worker did not report its build done, else testing), or the
 * worker gave up (its SYNC ABORT, or positive evidence of no merge commit): manual, the sync back in the holder's hands
 * with the worker's reason (`lastWords`: the first line of its answer, for an ending without a SYNC line). */
/** A109: `isBuildNone`: the worker of a build sync said `build-log=none` (it did not start the build). */
export type StageEntry = { stage: SyncStage; mergeSha: string; note: string; isBuildNone: boolean }
export type AfterWorker = { kind: 'done'; note: string } | ({ kind: 'stage' } & StageEntry)
export const afterWorker = (end: SyncEnd | null, git: MergeRead, isBuildSync: boolean, lastWords = ''): AfterWorker => {
  if (end?.kind === 'abort') return { kind: 'stage', stage: 'manual', mergeSha: '', note: `the sync worker aborted: ${end.note}`, isBuildNone: false }
  // A SYNC DONE line (the worker prompt before rev 32 asked for it) that carries the post-merge tests still ends the sync.
  if (end?.kind === 'done' && testsOf(end.note) !== null) return { kind: 'done', note: end.note }
  // Given up only on positive evidence of no merge, and never against the worker's own MERGED line.
  if (git.state === 'none' && end?.kind !== 'merged') return { kind: 'stage', stage: 'manual', mergeSha: '', note: `the sync worker ended without a SYNC line and no merge commit sits on top of the pre-merge HEAD${lastWords ? `: ${lastWords}` : ''}`, isBuildNone: false }
  const mergeSha = git.state === 'merged' ? git.sha : ''
  const buildLog = end?.kind === 'merged' ? end.buildLog : ''
  const stage = isBuildSync && end?.kind !== 'done' ? 'building' : 'testing'
  return { kind: 'stage', stage, mergeSha, note: `merged ${mergeSha || '(git did not answer yet)'}${buildLog ? `; build log ${buildLog}` : ''}${end ? '' : '; the worker ended without a SYNC line'}`, isBuildNone: stage === 'building' && end?.kind === 'merged' && !buildLog }
}

/** A93 / A96: the sync as it enters a stage (`buildLog`: the sync's own log when it builds); entering the manual stage puts
 * the hard end back so that at least MANUAL_MIN_MS remain. */
export const enterStage = (s: SyncFile, to: Omit<StageEntry, 'isBuildNone'>, buildLog: string, now: number): SyncFile => ({
  ...s,
  stage: to.stage,
  mergeSha: to.mergeSha,
  buildLog,
  note: to.note.slice(0, 300),
  hardEnd: to.stage === 'manual' ? Math.max(s.hardEnd, now + MANUAL_MIN_MS) : s.hardEnd,
  stageAt: now,
  updatedAt: now,
})

/** A93: the merge as a notice names it, or the step to read it while git has not answered. */
export const mergeLabel = (mergeSha: string): string => mergeSha || '(its sha not read yet: git -C <checkout> log -1 --format=%H)'

/** A93: one step of the holder's watch over a sync in a stage: the hard end put back once by 30 min, in any stage, while
 * a build, test or Editor process runs within `warnMs` of it, or the processes cannot be read (`isBusy`); then, by stage,
 * the next stage and what the holder is told (each said once, by its key). `stageAt`: when the stage began (the
 * build-unknown grace). The manual stage moves on only by the holder's own done or abort (A96: told once, at the hand-back). */
export type StageTell = 'testing' | 'build-failed' | BuildTell
/** A109: what the holder is told as the sync enters a stage: the stage's own notice; for a building stage what its log
 * says (logTell), and with no log yet: the worker's `build-log=none` → start the script now (`build-unknown`), else the
 * worker's report, quietly, until the log appears; a log that already holds the Result: is left to the watch's next step,
 * which moves the stage on (null: nothing told now). */
export type EntryTell = SyncStage | BuildTell | 'build-reported'
export const entryTell = (to: StageEntry, log: BuildLogRead): EntryTell | null =>
  to.stage !== 'building' ? to.stage : log === 'absent' ? (to.isBuildNone ? 'build-unknown' : 'build-reported') : logTell(log)
/** A109: the tells that wake nobody (the build runs or waits behind Build.bat's lock, or the worker reports it started it). */
export const isQuietTell = (t: StageTell | EntryTell): boolean => t === 'building' || t === 'build-queued' || t === 'build-reported'
/** A109 (review D4): a notice's key: a wake about the build's log is keyed by that log's write time too (told only once
 * the log no longer changes: build-failed waits for the script's exit line, stageNext), so a run the holder starts again
 * that fails again is told again; every other tell once per sync. */
export const tellKey = (t: StageTell | EntryTell, mtime: number): string => (mtime && (t === 'build-failed' || t === 'build-ended' || t === 'build-stopped') ? `${t}:${mtime}` : t)
export type StageMove = { extendTo: number | null; next: SyncStage | null; tell: StageTell | null }
/** A93 / A109: the watch over a build: its Result: (Succeeded → testing; Failed → revert, told once the script's exit line
 * is in, or its cmd.exe is seen gone, so the log no longer changes; an unread process list waits for the exit line, which
 * the script always appends, as C2 of the fixes' review reads null: never gone); no log past the grace → start the script; a log
 * that stopped with no Result: and no exit line while the script's cmd.exe is seen gone past the grace → `build-stopped`
 * (an unread process list, `isScript` null, never says gone); else what the log says. */
const buildWatch = (b: BuildLog, isScript: boolean | null, isGraceOver: boolean): StageTell | null => {
  if (b.log === 'Succeeded') return 'testing'
  if (b.log === 'Failed') return b.isFinal || isScript === false ? 'build-failed' : null
  if (b.log === 'absent') return isGraceOver ? 'build-unknown' : null
  if ((b.log === 'running' || b.log === 'queued') && isGraceOver && isScript === false) return 'build-stopped'
  return logTell(b.log)
}
export const stageNext = (s: { stage: SyncStage | null; extended: boolean; hardEnd: number; stageAt: number }, f: { log: BuildLog; isScript: boolean | null; isBusy: boolean; now: number }, warnMs: number): StageMove => {
  const extendTo = s.stage !== null && f.isBusy && !s.extended && f.now >= s.hardEnd - warnMs ? s.hardEnd + BUILD_EXTEND_MS : null
  switch (s.stage) {
    case 'building': {
      const tell = buildWatch(f.log, f.isScript, f.now - s.stageAt >= STAGE_GRACE_MS)
      return { extendTo, next: tell === 'testing' ? 'testing' : null, tell }
    }
    case 'testing':
      return { extendTo, next: null, tell: 'testing' }
    default:
      return { extendTo, next: null, tell: null }
  }
}
