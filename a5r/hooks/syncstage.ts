// A93-A95 (rev 32): after the merge, a sync goes on in stages until a real end: building (the merge is in, its build runs,
// often longer than a worker's tool calls) → testing (the build succeeded, or the sync does not build; the holder runs the
// post-merge headless tests) → done (with the test result line, A95) or aborted (an abort, or no merge commit). Every
// other session stays frozen through every stage; the lift goes out only at done, abort or expiry. Pure: no `$`;
// register.ts gathers the facts (the worker's last line, git's HEAD, the build log, the build processes) and applies the
// moves decided here.
import type { SyncEnd } from './coord.ts'

export type SyncStage = 'building' | 'testing'

/** A93: how long the hard end is put back, once, while the build process still runs near it. */
export const BUILD_EXTEND_MS = 30 * 60_000
/** A93: how long after its stage began a build with no log and no process is reported as unknown (it may be starting). */
export const STAGE_GRACE_MS = 2 * 60_000

/** A95: the S2 standard's post-merge headless tests (E:/Projects/s2 docs/skills/s2-build-test.md, "Run all Sipher
 * tests"); `<ENGINE>` is the engine root from the machine profile. */
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

/** A93: the build's own last `Result:` line in its log (Build.bat exits 0 on failure, so only this line counts). */
export const buildResultOf = (log: string): 'Succeeded' | 'Failed' | null => {
  let last: 'Succeeded' | 'Failed' | null = null
  for (const m of log.matchAll(/\bResult:\s*(Succeeded|Failed)\b/g)) last = m[1] === 'Succeeded' ? 'Succeeded' : 'Failed'
  return last
}

/** A93: the merge commit `git log -1 --format="%H %P" HEAD` shows on top of the pre-merge HEAD the holder's a5r recorded,
 * else null. Git, not the worker's word, says whether the merge happened. With no record (its rev-parse failed) any merge
 * commit counts: wrongly keeping the freeze until the holder looks is the safe side of wrongly lifting it under a build.
 * (The shared branch always carries its own commits, so origin/main never fast-forwards it.) */
export const mergeOnTop = (headLine: string, preHead: string): string | null => {
  const [sha, first, second] = headLine.trim().toLowerCase().split(/\s+/)
  if (!sha || !first || !second) return null
  return !preHead || first === preHead.trim().toLowerCase() ? sha : null
}

/** A93: what the worker's end makes of the sync: an end (an abort; a done that carries the post-merge tests), a stage
 * (git shows the merge: building when the sync builds and the worker did not report its build done, else testing), or
 * an abort for want of a merge commit. */
export type AfterWorker =
  | { kind: 'end'; state: 'done' | 'aborted'; note: string }
  | { kind: 'stage'; stage: SyncStage; mergeSha: string; buildLog: string; note: string }
  | { kind: 'no-merge' }
export const afterWorker = (end: SyncEnd | null, mergeSha: string | null, isBuildSync: boolean): AfterWorker => {
  if (end?.kind === 'abort') return { kind: 'end', state: 'aborted', note: end.note }
  // A SYNC DONE line (the worker prompt before rev 32 asked for it) that carries the post-merge tests still ends the sync.
  if (end?.kind === 'done' && testsOf(end.note) !== null) return { kind: 'end', state: 'done', note: end.note }
  if (mergeSha === null) return { kind: 'no-merge' }
  const buildLog = end?.kind === 'merged' ? end.buildLog : ''
  return { kind: 'stage', stage: isBuildSync && end?.kind !== 'done' ? 'building' : 'testing', mergeSha, buildLog, note: `merged ${mergeSha}${buildLog ? `; build log ${buildLog}` : ''}${end ? '' : '; the worker ended without a SYNC line'}` }
}

/** A93: one step of the holder's watch over a sync in a stage: the hard end put back once by 30 min while the build runs
 * within `warnMs` of it; the next stage; what the holder is told (each said once, by its key). */
export type StageMove = { extendTo: number | null; next: SyncStage | null; tell: 'testing' | 'build-failed' | 'build-unknown' | null }
export const stageNext = (s: { stage: SyncStage | null; extended: boolean; hardEnd: number; updatedAt: number }, f: { result: 'Succeeded' | 'Failed' | null; isBuilding: boolean; now: number }, warnMs: number): StageMove => {
  const extendTo = s.stage === 'building' && f.isBuilding && !s.extended && f.now >= s.hardEnd - warnMs ? s.hardEnd + BUILD_EXTEND_MS : null
  if (s.stage === 'testing') return { extendTo, next: null, tell: 'testing' }
  if (f.result === 'Succeeded') return { extendTo, next: 'testing', tell: 'testing' }
  if (f.result === 'Failed') return { extendTo, next: null, tell: 'build-failed' }
  return { extendTo, next: null, tell: !f.isBuilding && f.now - s.updatedAt >= STAGE_GRACE_MS ? 'build-unknown' : null }
}
