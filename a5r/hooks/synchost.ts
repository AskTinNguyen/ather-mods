// Rev 46, the host side of the sync's two scripts, on closures (no `$`: register.ts hands it the engine's reads and
// writes for one call). A109 / A110: the build script with the engine root A5R found. A142: the merge script with the
// holder's rules now, written before the worker starts and again when the holder changes the rules after a hand-back;
// its refusal read back from its log when the worker ends.
// Each is written fresh over any earlier one of its sync; the answer is the one command that starts it, or '' when it was
// not written (the worker's task then says to start no build, or not to merge).
import { buildScriptText, buildStartCommand, syncBuildScript } from './buildscript.ts'
import type { SyncFile } from './coord.ts'
import { MERGE_BODY, mergeFiles, mergeRefusal, syncMergeLog } from './mergescript.ts'
import { syncBuildLog } from './syncstage.ts'

export type ScriptIo = {
  pluginRoot: string
  read: (path: string) => Promise<string | null>
  write: (path: string, text: string) => Promise<void>
  log: (note: string) => void
}

export const syncScripts = (io: ScriptIo) => {
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
    /** A142: the merge script's refusal in its log of this sync, for orchestrate.log (null: none, or no log). */
    mergeEnd: async (checkout: string, s: SyncFile): Promise<{ note: string; procs: string[] } | null> => mergeRefusal((await io.read(syncMergeLog(checkout, s.id))) ?? ''),
  }
}
