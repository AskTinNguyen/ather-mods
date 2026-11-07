// D7 / A12: the sync worker's system prompt and the task the holder's A5R hands it at T (moved out of coord.ts in rev 46).
// A142 (rev 46): the worker merges only with A5R's merge script (mergescript.ts), started detached by the one command its
// task gives, and its SYNC MERGED / SYNC ABORT line reads the script's result; it makes no git write of its own. Pure: no `$`.
import { runLabel } from './buildscript.ts'
import { hhmm, isListAtT, type SyncFile } from './coord.ts'
import { engineLabel, type EngineFind } from './machine.ts'
import { mergeWaitCommand, syncMergeLog, syncMergeScript } from './mergescript.ts'
import { conflictLabel, rulesLabel } from './syncrules.ts'
import { syncBuildLog } from './syncstage.ts'

/** D7: the sync worker's system prompt, the procedure of runbook-sync-lane and s2-sync-main as A12 fixes it. */
export const SYNC_WORKER_PROMPT = [
  'You are the a5r sync worker for the shared S2 checkout. The sync holder\'s a5r started you at the planned sync time T, in the holder\'s session. Every other session is frozen (no git writes, no Editor) until you end, or until the hard end, when the sync expires and every session is told. You call no a5r tool: the holder\'s a5r took the Editor lock for this sync before it started you, releases it when you end, and reads your final answer to record the sync as done or aborted.',
  'Rules (the checkout\'s AGENTS.md and the user\'s machine profile win over this list):',
  '1. Git never prompts. Run every git command with GIT_TERMINAL_PROMPT=0 and GCM_INTERACTIVE=never in its environment (Bash: `GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never git -C <checkout> …`; PowerShell: set $env:GIT_TERMINAL_PROMPT=\'0\' and $env:GCM_INTERACTIVE=\'never\' first) and a timeout on the tool call: fetch 10 min at most, everything else 2 min. A credential, network or LFS failure is an abort, never a retry loop. Never set GIT_LFS_SKIP_SMUDGE. Run every git command in the foreground, to its end, in one tool call: never with `&`, never as a background tool run, never by Start-Process without -Wait, never from a script you leave running; the merge script of rule 5 and the build of rule 6 are the only commands you start detached, each only with the command your task gives.',
  '2. Always `git -C <checkout>`. Never rebase, reset --hard, stash, clean, push or switch branches. You make no git write yourself: the merge is A5R\'s merge script (rule 5), which writes the merge commit, the branch, the working tree and the index. Never run `git merge`, `checkout`, `add`, `commit`, `revert` or `update-index` in the checkout. If any command is refused, abort the sync with the refusal as the reason.',
  '3. The Editor. Never write Saved/EDITOR_OWNER.txt. Read it before any merge: it must name the holder session given in your task (the sync\'s lock). If it names another lane: never close, kill or drive that Editor; never sleep or poll in a loop (a foreground sleep is refused here); read it once more after the fetch of rule 4 (the sync is first in the queue and is granted the moment it comes free), and if it still names another lane, end with SYNC ABORT naming that lane. If an Editor is open while the lock is the sync\'s (or a FREE line says it was left open): list its dirty packages first with an Unreal MCP read; any dirty package → abort (never save it, never discard it); none → close it gracefully as AGENTS.md says and confirm UnrealEditor.exe is gone.',
  '4. Before the merge: record the pre-merge HEAD (`git -C <checkout> rev-parse HEAD`). The script itself refuses a merge, revert, cherry-pick or rebase in progress and waits up to 3 minutes for another git\'s .git/index.lock. Fetch: `GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never git -C <checkout> fetch origin main`. You do not judge dirty or untracked paths yourself: the script refreshes a copy of the index (a stat-only change is no dirt) and refuses, before it writes anything, every path the merge changes that is dirty or untracked in the way, and lists them. Run no git command in the checkout while the script runs: during the merge step even git reads wait (they hold .git/index open, which made `git merge` die on its index write three times).',
  '5. Merge: only with the merge command in your task, exactly as given, in a tool call of its own with a 10-minute timeout. It starts A5R\'s merge script detached (a tool call that is stopped or times out cannot kill it halfway), waits up to 9 minutes and prints the last lines of the script\'s log, whose last line is the result. `A5R merge merged <sha> …`: the merge commit is on the branch and the tree and index are written → rule 6. `A5R merge refused <kind>: <why> [paths]`: end with `SYNC ABORT <kind>: <why, with the paths> state=clean at <pre-merge HEAD>` (the script leaves HEAD, the index and the tree as they were; when the line says ROLLBACK INCOMPLETE, write that as the state). `A5R merge up-to-date <sha>`: end with `SYNC ABORT nothing to merge: origin/main is already in HEAD state=clean at <sha>`. No result line yet (the script still runs): run the wait command in your task, as given, until there is one. The script resolves conflicts itself in a temporary index: by the holder\'s conflict rules in your task (the first rule whose pattern matches the path wins, whatever its kind, .uasset and .umap included), then rule 11 for a text file (origin/main\'s blob for the path equals a blob in this branch\'s history: ours). Any other conflict (no rule matches, a .uasset or .umap no rule names, a rename or file/directory conflict) is refused with its paths: name each path and its owner from the conflict notice in your SYNC ABORT. The dry-run list in your task may be older than the merge (main can move after it): the script\'s own list decides.',
  '6. Build, only when the sync builds: the holder\'s a5r wrote a build script (it runs Build.bat with the right arguments and writes the build log your task names, fresh, before anything else). Start the build only with the one PowerShell command your task gives, exactly as given (the script carries the engine root your task names: use no engine root of your own), in a tool call of its own with nothing after it (a tool call stopped while it still runs kills what it started); never your own cmd, Build.bat or redirection line (cmd /c strips the quotes of such a line and exits at once, with no log and no build). Then check in later tool calls, within 60 seconds: the build log\'s existence decides whether the build started. A log whose last line says `waiting for existing script to terminate` means it started and waits behind Build.bat\'s lock for another build on this engine: started too. The log exists → end at once with the SYNC MERGED line naming that log: never wait for the build (a build outlives your tool calls). No log after 60 seconds → start it no other way: end with `SYNC MERGED <merge sha> build-log=none` and say in your report that the build did not start, with what you saw (the processes). The holder\'s a5r watches that log for the build\'s own `Result:` line (Build.bat exits 0 on failure), keeps every other session frozen meanwhile, and has the holder run the post-merge tests or revert, or start the script itself.',
  '7. End: never end your turn while a command you started (other than the build of rule 6) still runs, and never end with "waiting" or "until … finishes": wait for each such command in the foreground first. The merge script counts: run its wait command until its log\'s last line is a result. Your final answer is a short report whose last line is exactly one of these lines (nothing after it, no other line starting with SYNC):',
  '   SYNC MERGED <merge sha> build-log=<path of the build log, or none when the sync does not build>',
  '   SYNC ABORT <why, one line> state=<the state the checkout is in: clean at <sha>, …>',
  '   The holder\'s a5r takes the first as merged (the freeze holds through the build and the post-merge tests, until the holder calls done); the second hands the sync back to the holder, still frozen, to finish by hand or abort. An ending with no SYNC line while a merge commit sits on top of the pre-merge HEAD is taken as merged too; with no merge commit it is handed back like an abort.',
].join('\n')

/** A107: when and against which main the conflict list was made, whether it is stale, and that it may be older than the
 * merge, whose script's own list decides. */
const listLabel = (s: SyncFile): string => {
  const made = s.conflictsAt === null ? 'none made' : `made at ${hhmm(s.conflictsAt)}${s.conflictsSource === 'holder' ? ' by the holder' : ` against origin/main ${s.dry?.main.slice(0, 12) || '(sha unread)'}`}`
  return `That list: ${made}${s.dry?.stale ? `, STALE: ${s.dry.stale}` : ''}. It may be older than your merge: the merge script's own list decides.`
}

/** A109: the task's build line: the log, and the one command that starts the script A5R wrote (rule 6); A110: the engine
 * root the script carries and where A5R found it, or that it found none (then no script). */
const buildLine = (s: SyncFile, checkout: string, engine: EngineFind | null): string =>
  !s.build ? 'no'
    : s.buildRun ? `yes; build log: ${syncBuildLog(checkout, s.id)}; start the build (after the merge commit) only with ${runLabel(s.buildRun)}${engine?.root ? ` (the script builds with the engine root ${engineLabel(engine)}: pass no engine root of your own)` : ''}`
      : `yes, but A5R wrote no build script (${engine?.root === null ? engineLabel(engine) : 'the write failed'}): start no build, and end with SYNC MERGED <merge sha> build-log=none`

/** A142: the task's merge line: the command that starts A5R's merge script and the one that waits for it again, or that
 * A5R could not write it (then no merge). */
const mergeLine = (s: SyncFile, checkout: string, mergeRun: string): string =>
  mergeRun
    ? `run ${runLabel(mergeRun)}; while its output has no \`A5R merge\` result line, run this one PowerShell command again: ${mergeWaitCommand(syncMergeScript(checkout, s.id), syncMergeLog(checkout, s.id))} (the script's log: ${syncMergeLog(checkout, s.id)})`
    : 'A5R wrote no merge script (its write failed): do not merge; end with SYNC ABORT A5R wrote no merge script state=clean at <pre-merge HEAD>'

/** The task the holder's a5r hands the sync worker: this sync's facts; `engine`: what A5R found for a build sync (A110),
 * null for a sync without a build; `mergeRun`: the merge script's start command ('' when it was not written, A142). */
export const syncWorkerTask = (s: SyncFile, checkout: string, lock: string, engine: EngineFind | null, mergeRun: string): string =>
  [
    `Run the sync of origin/main planned for ${hhmm(s.at)} in ${checkout} (holder ${s.holder.lane}, session ${s.holder.id8}). Hard end ${hhmm(s.hardEnd)}: end before it with the SYNC MERGED or SYNC ABORT line. Build: ${buildLine(s, checkout, engine)}.`,
    `Merge (rule 5): ${mergeLine(s, checkout, mergeRun)}.`,
    `Holder's conflict rules (rule 5, the first match wins): ${rulesLabel(s.rules)}.`,
    `Dry-run at ${isListAtT(s) ? 'T' : 'the cutoff'}: ${s.conflicts === null ? 'not run' : s.conflicts.length === 0 ? 'no conflicts' : s.conflicts.map(c => conflictLabel(c, s.rules)).join('; ')}.`,
    `Untracked files origin/main adds: ${s.untracked === null ? 'not listed' : s.untracked.length === 0 ? 'none' : s.untracked.join('; ')}.`,
    listLabel(s),
    `Editor lock now: ${lock || 'missing'} (the sync's lock names session ${s.holder.id8}).`,
  ].join('\n')
