// Rev 46, the host side of the sync's two scripts, on closures (no `$`: register.ts hands it the engine's reads and
// writes for one call). A109 / A110: the build script with the engine root A5R found. A142: the merge script with the
// holder's rules now, written before the worker starts and again when the holder changes the rules after a hand-back;
// its outcome read back from its log when the worker ends (Fable 2: only that ends the merge step; the worker's answer kept
// beside the sync while the script runs), and what a script that died left (Fable 4).
// Each is written fresh over any earlier one of its sync; the answer is the one command that starts it, or '' when it was
// not written (the worker's task then says to start no build, or not to merge).
import { buildScriptText, buildStartCommand, syncBuildScript } from './buildscript.ts'
import type { SyncEnd, SyncFile } from './coord.ts'
import { MERGE_BODY, diedNote, mergeFiles, mergeOutcome, syncMergeLog, workerEndOf, type WorkerEnd } from './mergescript.ts'
import type { MergeRead } from './syncstage.ts'
import { syncBuildLog } from './syncstage.ts'

export type ScriptIo = {
  pluginRoot: string
  read: (path: string) => Promise<string | null>
  stat: (path: string) => Promise<{ size: number } | null>
  write: (path: string, text: string) => Promise<void>
  log: (note: string) => void
}

export const syncScripts = (io: ScriptIo) => {
  /** Fable 4: the index.lock a dead script may have left: its first bytes when small (its marker), else its size. */
  const lockLeft = async (checkout: string): Promise<{ text: string | null; size: number } | null> => {
    const st = await io.stat(`${checkout}/.git/index.lock`)
    return st && { text: st.size < 1024 ? await io.read(`${checkout}/.git/index.lock`) : null, size: st.size }
  }
  /** Fable 2: the worker's answer kept beside the sync (the holder writes it), so a reload while the script runs loses nothing. */
  const answerFile = (checkout: string, s: SyncFile): string => `${checkout}/Saved/A5R/${s.id}-worker-end.txt`
  const wrote = (path: string, text: string): Promise<boolean> => io.write(path, text).then(() => true, err => (io.log(`${path} not written: ${String(err)}`), false))
  return {
    build: async (c: { root: string; uproject: string }, s: SyncFile, engineRoot: string): Promise<string> => {
      const path = syncBuildScript(c.root, s.id)
      return (await wrote(path, buildScriptText(c.root, c.uproject, syncBuildLog(c.root, s.id), engineRoot))) ? buildStartCommand(path) : ''
    },
    merge: async (checkout: string, s: SyncFile): Promise<string> => {
      const m = mergeFiles((await io.read(`${io.pluginRoot}/${MERGE_BODY}`)) ?? '', checkout, s)
      if (!m) io.log(`the plugin's ${MERGE_BODY} is not the merge script: no merge script written for ${s.id}`)
      return m && (await wrote(m.path, m.text)) ? m.run : ''
    },
    /** A142 / Fable 2 / Fable 4: the worker ended: null while its merge script still runs (only the script's result or its
     * death ends the merge step); else the end to record (mergescript.ts workerEndOf: the result line's sha), what git
     * says (that sha, else `readHead`), and the line for orchestrate.log (a refusal, or what a dead script left: HEAD
     * against the pre-merge HEAD and the index.lock, its marker when small). */
    workerEnd: async (checkout: string | null, s: SyncFile, isAlive: boolean | null, worker: SyncEnd | null, readHead: () => Promise<MergeRead>): Promise<WorkerEnd | null> => {
      const m = mergeOutcome(checkout ? await io.read(syncMergeLog(checkout, s.id)) : null, isAlive)
      if (m.kind === 'running') return null
      const git = m.kind === 'merged' ? { state: 'merged' as const, sha: m.sha } : await readHead()
      return workerEndOf(m, git, m.kind === 'died' && checkout ? diedNote(git, s.preHead, await lockLeft(checkout)) : '', worker)
    },
    keepAnswer: (checkout: string, s: SyncFile, answer: string): Promise<boolean> => wrote(answerFile(checkout, s), answer),
    /** The kept answer of this sync's worker (null: its worker has not ended, or the end was not kept). */
    keptAnswer: (checkout: string, s: SyncFile): Promise<string | null> => io.read(answerFile(checkout, s)),
  }
}
