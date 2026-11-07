// A142 (rev 46): the sync's merge runs as a script A5R writes, never as a `git merge` the worker types. MEASURED three
// times (2026-11-04 09:30, 11-06 07:00, 11-08 01:15): `git merge --no-edit origin/main` wrote 1.5–2k files into the shared
// tree, then died with `fatal: unable to write .git/index` before MERGE_HEAD existed (INFERRED: Windows refused the rename
// of index.lock over a ~100 MB index other processes had open), so HEAD and the index stayed old, the tree half-merged and
// `merge --abort` impossible. The script (scripts/sync-merge.ps1, behind the param block written here) follows the route
// sync-main proved by hand and leaves HEAD, index and tree as they were whenever it does not finish. A143: while it may
// run, A5R keeps out of the index. Pure: no `$`; synchost.ts writes the script and reads its log, register.ts gates reads.
import { psQuote, pathGlobSource } from './a5r.ts'
import { scriptAlive, win } from './buildscript.ts'
import type { SyncEnd } from './coord.ts'
import type { SyncRule } from './syncrules.ts'
import type { MergeRead } from './syncstage.ts'

/** The script beside the sync's build script and log, one per sync, written fresh before each worker start; its log is
 * written fresh by each run and its last line is the result (MERGE_END). */
export const MERGE_SUFFIX = '-merge.ps1'
export const syncMergeScript = (checkout: string, syncId: string): string => `${checkout}/Saved/A5R/${syncId}${MERGE_SUFFIX}`
export const syncMergeLog = (checkout: string, syncId: string): string => `${checkout}/Saved/A5R/${syncId}-merge.log`
/** The body's place in the plugin (A5R prepends the param block to it) and its first words, which mark it as the script. */
export const MERGE_BODY = 'scripts/sync-merge.ps1'
export const MERGE_MARK = '# A5R sync merge (A142'
/** The script's result, its log's last line: merged <sha>, up-to-date <sha>, or refused <kind>: <why> (one pattern for
 * A5R and the worker's wait command). */
const RESULT = 'A5R merge (merged|up-to-date|refused)'
export const MERGE_END = new RegExp(`^.*\\brule=sync-merge ${RESULT}\\b(?: ([0-9a-f]{7,64})\\b)?.*$`, 'mi')
/** Fable 3 (b): what the script writes into the .git/index.lock it takes, until it copies the new index in. */
export const LOCK_MARK = /^A5R sync merge \S+ pid (\d+)/
/** Fable 4: the line the worker's commands print when no script runs and its log holds no result. */
export const NO_RESULT = 'SYNC ABORT merge script ended without a result'

/** A142 / Fable 2: the merge as its script reports it, which alone ends the merge step: `running` (it runs, or its process
 * list is unread while its log has no result yet), `merged` (its result line's sha), `refused` (a refusal or up-to-date:
 * nothing written), `died` (no result line and no process: killed or crashed), `none` (no log: the worker never ran it). */
export type MergeOutcome =
  | { kind: 'running' | 'none' }
  | { kind: 'merged'; sha: string; note: string }
  | { kind: 'refused'; note: string; procs: string[] }
  | { kind: 'died'; procs: string[] }
export const mergeOutcome = (log: string | null, isAlive: boolean | null): MergeOutcome => {
  const m = MERGE_END.exec(log ?? '')
  const procs = [...(log ?? '').matchAll(/ rule=sync-merge process pid=\d+ parent=\d+ name=(\S+?)(?:\.exe)? cmd=/g)].map(p => p[1] ?? '')
  const note = m ? m[0].slice(m[0].indexOf('A5R merge ')) : ''
  const isShaless = m?.[1] === 'merged' && !m[2]
  if (m?.[1] === 'merged' && m[2]) return { kind: 'merged', sha: m[2].toLowerCase(), note }
  if (m) return { kind: 'refused', note: isShaless ? `${note} (a merged line without its sha: no merge recorded)` : note, procs }
  if (isAlive === true || (log && isAlive === null)) return { kind: 'running' }
  return log ? { kind: 'died', procs } : { kind: 'none' }
}
/** Fable 4: what a script that died leaves, for orchestrate.log and the hand-back: HEAD against the pre-merge HEAD, and
 * the index.lock left (its marker when it is the script's, else its size), so the holder knows what to recover. Short:
 * orchestrate.log keeps 160 characters of a note. */
export const diedNote = (head: MergeRead, preHead: string, lock: { text: string | null; size: number } | null): string =>
  `no result from the merge script: HEAD ${head.state === 'unknown' ? 'unread' : head.state === 'merged' ? `${head.sha.slice(0, 12)}, a merge on ${preHead.slice(0, 12)} (the branch moved)` : `still ${preHead.slice(0, 12)}`}; index.lock ${lock === null ? 'none' : LOCK_MARK.test(lock.text ?? '') ? "left, the script's own" : `left, ${lock.size} bytes`}`
/** Fable 2 / 4: the worker's end as the script's outcome (ended: not running) makes it: its sha for a merge (the worker's
 * build log kept), an abort for a refusal or a death (`died`: diedNote's words), the worker's own SYNC line only when it
 * never ran the script; what git says; and the orchestrate.log line for a refusal or a death. */
export type WorkerEnd = { end: SyncEnd | null; git: MergeRead; log: { note: string; procs: string[] } | null }
export const workerEndOf = (m: Exclude<MergeOutcome, { kind: 'running' }>, git: MergeRead, died: string, worker: SyncEnd | null): WorkerEnd => {
  const log = m.kind === 'refused' ? { note: m.note, procs: m.procs } : m.kind === 'died' ? { note: died, procs: m.procs } : null
  if (m.kind === 'merged') return { end: worker?.kind === 'merged' || worker?.kind === 'done' ? { ...worker, sha: m.sha } : { kind: 'merged', sha: m.sha, buildLog: '', note: `merged ${m.sha}` }, git, log }
  return { end: log ? { kind: 'abort', why: log.note, note: log.note.slice(0, 300) } : worker, git, log }
}

/** What A5R writes into the script: the checkout, the sync, the conflict rules (each glob as the regular expression rules
 * use, A99), and how long it waits for another git's index.lock and for a refused rename (WAIT_SEC each unless given: the
 * smoke test waits less). */
export type MergeConfig = { checkout: string; syncId: string; rules: readonly SyncRule[]; lockWaitSec?: number; renameWaitSec?: number }
export const WAIT_SEC = 180

/** The script: its param block (PowerShell literals; a rule is its side, its regular expression and its pattern for the
 * log) and the body from the plugin (null when the body read is not the script: then no script is written). CRLF, as
 * PowerShell 5 writes its own scripts. */
export const mergeScriptText = (body: string, c: MergeConfig): string | null => {
  if (!body.startsWith(MERGE_MARK)) return null
  const rules = c.rules.map(r => `@{ Side = ${psQuote(r.side)}; Re = ${psQuote(pathGlobSource(r.pattern))}; Pattern = ${psQuote(r.pattern)} }`)
  const params = [
    `[string]$Checkout = ${psQuote(win(c.checkout))}`,
    `[string]$Target = 'origin/main'`,
    `[string]$SyncId = ${psQuote(c.syncId)}`,
    `[string]$Log = ${psQuote(win(syncMergeLog(c.checkout, c.syncId)))}`,
    `[object[]]$Rules = @(${rules.join(', ')})`,
    `[int]$LockWaitSec = ${c.lockWaitSec ?? WAIT_SEC}`,
    `[int]$RenameWaitSec = ${c.renameWaitSec ?? WAIT_SEC}`,
  ]
  return `${['param(', ...params.map((p, i) => `  ${p}${i < params.length - 1 ? ',' : ''}`), ')', ...body.split(/\r?\n/)].join('\r\n').replace(/(\r\n)*$/, '')}\r\n`
}

/** A142: the sync's script (its path, its text, its start command) for the holder's rules now, or null when the body is
 * not the script. */
export const mergeFiles = (body: string, checkout: string, s: { id: string; rules: readonly SyncRule[] }): { path: string; text: string; run: string } | null => {
  const text = mergeScriptText(body, { checkout, syncId: s.id, rules: s.rules })
  const path = syncMergeScript(checkout, s.id)
  return text === null ? null : { path, text, run: mergeStartCommand(path, syncMergeLog(checkout, s.id)) }
}

/** The tail both of the worker's commands end with: wait up to 9 min for the PowerShell running this script by -File
 * (never the shell running the command, whose own text names the script too), print the log's last lines, and when no
 * such process runs and the log holds no result, one line that ends the worker (Fable 4). */
const waitTail = (script: string, log: string): string => {
  const mine = `Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like ${psQuote(`*-File*${win(script).split('\\').pop() ?? ''}*`)} }`
  const at = psQuote(win(log))
  return `${mine} | ForEach-Object { Wait-Process -Id $_.ProcessId -Timeout 540 -ErrorAction SilentlyContinue }; Get-Content -LiteralPath ${at} -Tail 25 -ErrorAction SilentlyContinue; if (-not @(${mine}).Count -and -not (Select-String -LiteralPath ${at} -Pattern ${psQuote(RESULT)} -Quiet -ErrorAction SilentlyContinue)) { ${psQuote(NO_RESULT)} }`
}
/** The worker's one command: the script started detached (a tool call that times out or is stopped cannot kill it halfway),
 * then the wait tail. */
export const mergeStartCommand = (script: string, log: string): string =>
  `$p = Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',${psQuote(`"${win(script)}"`)} -WindowStyle Hidden -PassThru; 'A5R merge script pid ' + $p.Id; ${waitTail(script, log)}`
/** The command that waits again for a script still running. */
export const mergeWaitCommand = (script: string, log: string): string => waitTail(script, log)

/** A143 / A130: a merge script runs now: a PowerShell running a `-merge.ps1` by -File (a shell whose command only names
 * one, as the start and wait commands do, is not one); null: the process list was not read. */
export const isMergeScriptAlive = (procs: readonly { name: string; cmd?: string }[] | null): boolean | null =>
  scriptAlive(procs, /^powershell$/i, cmd => BY_FILE.test(cmd))
const BY_FILE = new RegExp(`-file\\s+"?[^"']*${MERGE_SUFFIX.replace('.', '\\.')}`, 'i')
