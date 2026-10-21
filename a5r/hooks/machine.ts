// A110-A111 (rev 37, L-41: "the plugin must work on many machines; a hard path breaks the others"): nothing of one machine
// in the plugin. The shared Unreal checkout and the engine root that builds it are found on the machine A5R runs on, from
// facts there; the options `editorLock` and `engineRoot` are per-machine overrides in each user's own settings, never
// defaults here.
// - The checkout (A111): with `editorLock` unset, the main working tree of the session's own git repository (the parent of
//   `git rev-parse --path-format=absolute --git-common-dir`, so a linked worktree leads to its main tree), counted only
//   when that tree holds a .uproject at its root; its lock is `<checkout>/Saved/EDITOR_OWNER.txt`.
// - The engine root (A110): the option, else the engine the checkout's Editor last ran with (its newest log's
//   `LogInit: Base Directory:` line), else the .uproject's EngineAssociation in Epic's registry entries; the first whose
//   Engine/Build/BatchFiles/Build.bat exists. The log comes before the registry: a source build's GUID there may not be the
//   one the .uproject names (MEASURED on one machine, 2026-09-25), while the log names the engine that actually ran.
// Pure: no `$`; register.ts runs git and reg, lists and reads the files.
import { norm } from './a5r.ts'

// ---------- the checkout (A111) ----------
/** The shared checkout a session coordinates on: its folder, its lock file, its .uproject's file name ('' when the option
 * names a folder without one, or one not on this machine: readers of `uproject` check it, register.ts `holdsProject`). */
export type Checkout = { root: string; lock: string; uproject: string }
/** The lock file inside a checkout (AGENTS.md of the S2 standard). */
export const LOCK_REL = 'Saved/EDITOR_OWNER.txt'
export const lockIn = (checkout: string): string => `${checkout}/${LOCK_REL}`
/** The checkout's folder from its lock path. */
export const rootOfLock = (lock: string): string => norm(lock).split('/').slice(0, -2).join('/')
/** The checkout: the editorLock option's, wherever it points (`root` from its lock); else the main working tree git named
 * (`root`), when its listing holds a .uproject at its root; null: none found. */
export const checkoutOf = (givenLock: string, root: string, listing: readonly { name: string; kind: string }[]): Checkout | null => {
  const uproject = uprojectIn(listing)
  if (givenLock) return { root, lock: givenLock, uproject }
  return root && uproject ? { root, lock: lockIn(root), uproject } : null
}
/** How long the one git call that finds the checkout may take (a session start waits on it). */
export const FIND_GIT_MS = 5_000
export const commonDirArgv = (cwd: string): string[] => ['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir']
/** The main working tree from git's common dir (`<main>/.git` for the main tree and for each of its linked worktrees); ''
 * when it is not a `.git` folder (a bare repository, a separate git dir, a submodule's), whose parent is no working tree. */
export const mainTreeOf = (commonDir: string): string => {
  const dir = norm(commonDir.trim()).replace(/\/$/, '')
  return /\/\.git$/i.test(dir) ? dir.slice(0, -'/.git'.length) : ''
}
export const isUproject = (name: string): boolean => /\.uproject$/i.test(name)
/** The .uproject at a folder's root (its listing), or '' (only the root counts: a project in a subfolder is not the checkout). */
export const uprojectIn = (entries: readonly { name: string; kind: string }[]): string => entries.find(e => e.kind === 'file' && isUproject(e.name))?.name ?? ''
/** What A5R's coordination says where no checkout was found (why, and what to do): it stays idle, the five rules still apply. */
export const NO_CHECKOUT = {
  why: 'no Unreal checkout found for this session (its git repository\'s main working tree holds no .uproject at its root)',
  next: `set the a5r option editorLock to <checkout>/${LOCK_REL}`,
} as const

// ---------- the engine root (A110) ----------
export const buildBatOf = (root: string): string => `${norm(root).replace(/\/$/, '')}/Engine/Build/BatchFiles/Build.bat`

/** The Editor's own logs in Saved/Logs, newest first: `<project>.log` and its rotated `<project>-backup-<time>.log` (never a
 * tool's or a test run's own log there). */
export const editorLogs = (entries: readonly { name: string; kind: string; mtimeMs: number }[], uproject: string): string[] => {
  const project = uproject.replace(/\.uproject$/i, '').toLowerCase()
  if (!project) return []
  return entries
    .filter(e => e.kind === 'file' && (e.name.toLowerCase() === `${project}.log` || (e.name.toLowerCase().startsWith(`${project}-backup-`) && /\.log$/i.test(e.name))))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map(e => e.name)
}
/** How many of the newest Editor logs are read for the line (each 1-2 MB; the line is near the top of each). */
export const LOGS_READ = 3
const BASE_DIR = /LogInit: Base Directory: (.+?)[\\/]Engine[\\/]Binaries[\\/][^\\/\r\n]+[\\/]?[ \t\r]*$/gm
/** The engine root the Editor ran with, from the last `LogInit: Base Directory: <root>/Engine/Binaries/<platform>/` line of
 * its log (any platform folder), or null. */
export const engineOfLog = (text: string): string | null => {
  const last = [...text.matchAll(BASE_DIR)].pop()?.[1]?.trim()
  return last ? norm(last) : null
}

/** The .uproject's EngineAssociation: a source build's GUID, an installed version (`5.7`), or '' (unreadable, none). */
export const engineAssociation = (uprojectText: string): string => {
  try {
    const v = (JSON.parse(uprojectText) as { EngineAssociation?: unknown }).EngineAssociation
    return typeof v === 'string' ? v.trim() : ''
  } catch {
    return ''
  }
}
const GUID = /^\{?[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\}?$/i
const bare = (guid: string): string => guid.replace(/[{}]/g, '').toLowerCase()
/** How long one reg query may take. */
export const REG_MS = 5_000
/** The reg queries for an association: a GUID among the source builds (the user's first, then the machine's), an installed
 * version's InstalledDirectory; none for anything else. */
export const registryQueries = (assoc: string): string[][] =>
  GUID.test(assoc) ? ['HKCU', 'HKLM'].map(hive => ['reg', 'query', `${hive}\\Software\\Epic Games\\Unreal Engine\\Builds`])
    : /^\d+\.\d+$/.test(assoc) ? [['reg', 'query', `HKLM\\SOFTWARE\\EpicGames\\Unreal Engine\\${assoc}`, '/v', 'InstalledDirectory']]
      : []
/** The engine root reg's output gives for the association (the first matching `<name> REG_SZ <value>` line), or null. */
export const registryRoot = (assoc: string, stdout: string): string | null => {
  const want = GUID.test(assoc) ? bare(assoc) : 'installeddirectory'
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*(\S+)\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/.exec(line)
    if (m && bare(m[1] ?? '') === want && m[2]) return norm(m[2])
  }
  return null
}

/** One source of the engine root, as read in A110's order: where it comes from, the root it names (null: none), whether its
 * Build.bat exists. register.ts reads them one by one and stops at the first with a Build.bat. */
export type EngineSource = { from: string; root: string | null; hasBat: boolean }
/** The engine root found and where it came from, with the sources passed over before it for want of a Build.bat; or none
 * (`root: null`), with what each source said. */
export type EngineFind = { root: string; from: string; tried: string[] } | { root: null; tried: string[] }
const said = (s: EngineSource): string => (s.root === null ? `${s.from}: none` : `${s.from} names ${s.root}, which has no Engine/Build/BatchFiles/Build.bat`)
/** The first source whose Build.bat exists, with the ones before it that named a root; or none, with what each said. */
export const pickEngine = (sources: readonly EngineSource[]): EngineFind => {
  const i = sources.findIndex(s => s.root !== null && s.hasBat)
  const hit = sources[i]
  return hit?.root ? { root: hit.root, from: hit.from, tried: sources.slice(0, i).filter(s => s.root !== null).map(said) } : { root: null, tried: sources.map(said) }
}
/** The engine as the worker's task names it, or why there is none. */
export const engineLabel = (e: EngineFind): string =>
  e.root !== null ? `${e.root} (from ${e.from}${e.tried.length ? `; passed over: ${e.tried.join('; ')}` : ''})` : `no engine root found: ${e.tried.join('; ')}`
