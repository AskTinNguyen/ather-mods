// A142 (rev 46): the sync's merge runs as a script A5R writes, never as a `git merge` the worker types. MEASURED three
// times (2026-11-04 09:30, 11-06 07:00, 11-08 01:15): `git merge --no-edit origin/main` wrote 1.5–2k files into the shared
// tree, then died with `fatal: unable to write .git/index` before MERGE_HEAD existed (INFERRED: Windows refused the rename
// of index.lock over a ~100 MB index other processes had open), so HEAD and the index stayed old, the tree half-merged and
// `merge --abort` impossible. The script (scripts/sync-merge.ps1, behind the param block written here) follows the route
// sync-main proved by hand and leaves HEAD, index and tree as they were whenever it does not finish. A143: while it may
// run, A5R keeps out of the index. Pure: no `$`; synchost.ts writes the script, register.ts gates the reads.
import { psQuote, pathGlobSource } from './a5r.ts'
import { scriptAlive, win } from './buildscript.ts'
import type { SyncRule } from './syncrules.ts'

/** The script beside the sync's build script and log, one per sync, written fresh before each worker start; its log is
 * written fresh by each run and its last line is the result (MERGE_END). */
export const MERGE_SUFFIX = '-merge.ps1'
export const syncMergeScript = (checkout: string, syncId: string): string => `${checkout}/Saved/A5R/${syncId}${MERGE_SUFFIX}`
export const syncMergeLog = (checkout: string, syncId: string): string => `${checkout}/Saved/A5R/${syncId}-merge.log`
/** The body's place in the plugin (A5R prepends the param block to it) and its first words, which mark it as the script. */
export const MERGE_BODY = 'scripts/sync-merge.ps1'
export const MERGE_MARK = '# A5R sync merge (A142'
/** The script's result, its log's last line: merged <sha>, up-to-date <sha>, or refused <kind>: <why>. */
export const MERGE_END = /^.*\brule=sync-merge A5R merge (merged|up-to-date|refused)\b.*$/m
/** A142: a refusal in the script's log, as the holder's A5R records it in orchestrate.log when the worker ends: the result
 * line (from `A5R merge`) and the git processes the script saw (null: no refusal in this log). */
export const mergeRefusal = (log: string): { note: string; procs: string[] } | null => {
  const m = MERGE_END.exec(log)
  if (m?.[1] !== 'refused') return null
  const procs = [...log.matchAll(/ rule=sync-merge process pid=\d+ parent=\d+ name=(\S+?)(?:\.exe)? cmd=/g)].map(p => p[1] ?? '')
  return { note: m[0].slice(m[0].indexOf('A5R merge ')), procs }
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

/** The worker's one command: the script started detached (a tool call that times out or is stopped cannot kill it halfway),
 * then waited for up to 9 min, then the log's last lines. */
const tail = (log: string): string => `Get-Content -LiteralPath ${psQuote(win(log))} -Tail 25`
export const mergeStartCommand = (script: string, log: string): string =>
  `$p = Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',${psQuote(`"${win(script)}"`)} -WindowStyle Hidden -PassThru; 'A5R merge script pid ' + $p.Id; Wait-Process -Id $p.Id -Timeout 540 -ErrorAction SilentlyContinue; ${tail(log)}`
/** The command that waits again for a script still running (the PowerShell that runs it by -File, never the one running
 * this command, whose own text names the script too), then shows the log's last lines. */
export const mergeWaitCommand = (script: string, log: string): string =>
  `Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like ${psQuote(`*-File*${win(script).split('\\').pop() ?? ''}*`)} } | ForEach-Object { Wait-Process -Id $_.ProcessId -Timeout 540 -ErrorAction SilentlyContinue }; ${tail(log)}`

/** A143 / A130: a merge script runs now: a PowerShell running a `-merge.ps1` by -File (a shell whose command only names
 * one, as the start and wait commands do, is not one); null: the process list was not read. */
export const isMergeScriptAlive = (procs: readonly { name: string; cmd?: string }[] | null): boolean | null =>
  scriptAlive(procs, /^powershell$/i, cmd => BY_FILE.test(cmd))
const BY_FILE = new RegExp(`-file\\s+"?[^"']*${MERGE_SUFFIX.replace('.', '\\.')}`, 'i')
