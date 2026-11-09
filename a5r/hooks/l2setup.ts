// a5r-hosts S-d part 2: the L2 setup checks that read the host's repository and disk (prompt.md "Health checks",
// decision 9). C3 logon and credentials (a non-interactive ls-remote; one small LFS fetch into a scratch store it
// deletes), C7 repo and engine (the .uproject's EngineAssociation on the host against this machine's), C8 disk (the
// declared or cached lane size x 1.2), C9 lane reuse or creation (only as a background run), C11 the declared build read
// by its own success line. Pure: the adapter, the clock and the wait are closures.
import { callOp, type Adapter, type RemoteOs } from './adapters/types.ts'
import { lanesOf } from './hostcard.ts'
import type { HostDecl } from './hosts.ts'

export type SetupCtx = {
  hostId: string
  decl: HostDecl
  os: RemoteOs
  /** This machine's EngineAssociation (null: unread), for C7. */
  engineHere: string | null
  /** state.json's cached lane size (C8), when measured. */
  labSizeGb?: number
  now: () => Promise<number>
  sleep: (ms: number) => Promise<void>
  /** C11's longest wait for a background build (default 60 min). */
  buildWaitMs?: number
}
export type SetupOne = { status: 'pass' | 'fail' | 'skip'; value: string }

/** C3: prompts off, so a missing credential fails at once instead of waiting for a person. */
export const NO_PROMPT = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
const last = (s: string) => s.trim().split(/\r?\n/).slice(-1)[0] ?? ''
const fail = (value: string): SetupOne => ({ status: 'fail', value })
const slashed = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

/** C3 (S3): git and LFS credentials in the logon the adapter's commands run in. */
export const c3 = async (a: Adapter, x: SetupCtx): Promise<SetupOne> => {
  const repo = x.decl.repo
  if (!repo?.url) return { status: 'skip', value: `no repo.url declared for ${x.hostId}` }
  const ls = await callOp(a, 'run', ['git', 'ls-remote', repo.url, 'HEAD'], { env: NO_PROMPT })
  if (!ls.ok) return fail(`git ls-remote did not run: ${ls.error.text}`)
  if (ls.value.exitCode !== 0) return fail(`git ls-remote ${repo.url} failed in the adapter's logon (exit ${ls.value.exitCode}: ${last(ls.value.stderr || ls.value.stdout)})`)
  const attrs = repo.path ? await callOp(a, 'readFile', `${slashed(repo.path)}/.gitattributes`) : null
  if (!attrs?.ok || !/filter=lfs/.test(attrs.value)) return { status: 'pass', value: `ls-remote ${repo.url} answered with prompts off${repo.path ? '; no LFS' : ''}` }
  if (!repo.lfsProbe) return fail(`the repo uses LFS: declare hosts.${x.hostId}.repo.lfsProbe (one small LFS file) so C3 can fetch it`)
  const scratch = `${slashed(repo.path ?? '')}/.a5r-c3-${await x.now()}`
  const fetched = await callOp(a, 'run', ['git', '-C', repo.path ?? '', '-c', `lfs.storage=${scratch}`, 'lfs', 'fetch', 'origin', 'HEAD', `--include=${repo.lfsProbe}`], { env: NO_PROMPT, timeoutMs: 120_000 })
  await callOp(a, 'run', x.os === 'windows' ? ['cmd', '/c', 'rmdir', '/s', '/q', scratch.replace(/\//g, '\\')] : ['rm', '-rf', '--', scratch])
  if (!fetched.ok) return fail(`git lfs fetch did not run: ${fetched.error.text}`)
  if (fetched.value.exitCode !== 0) return fail(`git lfs fetch of ${repo.lfsProbe} failed in the adapter's logon (exit ${fetched.value.exitCode}: ${last(fetched.value.stderr || fetched.value.stdout)})`)
  return { status: 'pass', value: `ls-remote and an LFS fetch of ${repo.lfsProbe} worked with prompts off (scratch store removed)` }
}

/** The EngineAssociation of the first .uproject at a checkout's root, or null. */
export const engineOf = (uproject: string): string | null => {
  try {
    const v = (JSON.parse(uproject) as { EngineAssociation?: unknown }).EngineAssociation
    return typeof v === 'string' && v ? v : null
  } catch {
    return null
  }
}
/** C7: the repo at repo.path, and its engine against this machine's (engine.rule, `same` by default). */
export const c7 = async (a: Adapter, x: SetupCtx): Promise<SetupOne & { engine?: string }> => {
  const path = x.decl.repo?.path
  if (!path) return { status: 'skip', value: `no repo.path declared for ${x.hostId}` }
  const files = await callOp(a, 'run', ['git', '-C', path, 'ls-files', '--', ':(glob)*.uproject'])
  if (!files.ok || files.value.exitCode !== 0) return fail(`the repo at ${path} could not be read (${files.ok ? `exit ${files.value.exitCode}` : files.error.text})`)
  const first = files.value.stdout.split(/\r?\n/).map(l => l.trim()).find(Boolean)
  if (!first) return { status: 'pass', value: `repo at ${path}; no .uproject (no engine to compare)` }
  const text = await callOp(a, 'readFile', `${slashed(path)}/${first}`)
  const there = text.ok ? engineOf(text.value) : null
  if (!there) return fail(`the engine in ${first} could not be read on the host`)
  if (x.decl.engine?.rule === 'any') return { status: 'pass', value: `engine ${there} (rule any)`, engine: there }
  if (!x.engineHere) return fail(`engine ${there} on the host; this machine's could not be read`)
  return there === x.engineHere ? { status: 'pass', value: `engine ${there} on both`, engine: there } : { ...fail(`engine ${there} on the host, ${x.engineHere} here`), engine: there }
}

/** Free space (GB) at a host path: Windows through .NET's DriveInfo, POSIX through df -Pk. */
export const freeGbOf = async (a: Adapter, os: RemoteOs, path: string): Promise<number | null> => {
  const r = await callOp(a, 'run', os === 'windows' ? ['powershell', '-NoProfile', '-NonInteractive', '-Command', `[IO.DriveInfo]::new([IO.Path]::GetPathRoot('${path.replace(/'/g, "''")}')).AvailableFreeSpace`] : ['df', '-Pk', path])
  if (!r.ok || r.value.exitCode !== 0) return null
  const n = os === 'windows' ? Number(r.value.stdout.trim()) / 1024 ** 3 : Number(r.value.stdout.trim().split(/\r?\n/).slice(-1)[0]?.split(/\s+/)[3]) / 1024 ** 2
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null
}
/** C8 (S4): free disk where lanes go against ceil(lane size x 1.2): the declared estimate, else the cached measurement. */
export const c8 = async (a: Adapter, x: SetupCtx): Promise<SetupOne> => {
  const est = x.decl.diskEstimateGb ?? x.labSizeGb
  if (est === undefined) return fail(`no lane size known: declare hosts.${x.hostId}.diskEstimateGb (or measure the lane once)`)
  const where = x.decl.reach.options?.laneRoot ?? x.decl.repo?.path
  if (!where) return fail('no reach.options.laneRoot (or repo.path) to read free disk at')
  const free = await freeGbOf(a, x.os, where)
  if (free === null) return fail(`free disk at ${where} could not be read`)
  const need = Math.ceil(est * 1.2)
  return { status: free >= need ? 'pass' : 'fail', value: `free ${free} GB at ${where}, need ${need} GB (lane ${est} GB${x.decl.diskEstimateGb !== undefined ? ', declared' : ', measured'} x 1.2)` }
}

/** C9: a lane under laneRoot is reused; with none, one is created once, only as a background run (never in a short call),
 * and only after C8 passed (`c8Passed`). */
export const c9 = async (a: Adapter, x: SetupCtx, c8Passed: boolean): Promise<SetupOne> => {
  const root = x.decl.reach.options?.laneRoot
  const path = x.decl.repo?.path
  if (!root || !path) return fail(`declare reach.options.laneRoot and repo.path for ${x.hostId} (where lanes go, and the repo they come from)`)
  const listed = await callOp(a, 'run', ['git', '-C', path, 'worktree', 'list', '--porcelain'])
  if (!listed.ok || listed.value.exitCode !== 0) return fail(`the worktrees of ${path} could not be read`)
  const lanes = lanesOf(listed.value.stdout, root)
  if (lanes.length) return { status: 'pass', value: `reuses lane ${lanes[0]?.id} (${lanes.length} under ${root})` }
  if (!c8Passed) return fail('C8 has not passed: the lane is never created before the disk check passes')
  const target = `${slashed(root)}/lane-1`
  const there = await callOp(a, 'readFile', `${target}/.git`)
  if (there.ok) return fail(`a partial lane is at ${target} (not in git's list): resume it on the host; no second copy is started`)
  if (!a.canBg) return fail(`the ${a.kind} adapter cannot start a background run: create the lane on the host (git -C ${path} worktree add --detach ${target}), then check C9 again`)
  const started = await callOp(a, 'run', ['git', '-C', path, 'worktree', 'add', '--detach', '--progress', target, 'origin/HEAD'], { bg: true })
  if (!started.ok || started.value.exitCode !== 0) return fail(`the lane could not be started at ${target} (${started.ok ? `exit ${started.value.exitCode}` : started.error.text})`)
  return fail(`lane-1 is being created in the background at ${target} (progress: ${started.value.stdout || 'its terminal'}); check C9 again when it ends`)
}

/** C11: the declared build, run in the background where the adapter can (else as one long run), then its log read: only
 * the literal success line passes, whatever the exit code. */
export const c11 = async (a: Adapter, x: SetupCtx): Promise<SetupOne> => {
  const b = x.decl.build
  if (!b) return { status: 'skip', value: 'no build declared' }
  if (a.canBg && !a.status) return fail(`the ${a.kind} adapter starts the build in the background but has no status op: C11 cannot tell when it ended`)
  // The log's length before the run: only a success line written after it counts (an old log never passes).
  const before = await callOp(a, 'readFile', b.log)
  const mark = before.ok ? before.value.length : 0
  const cwd = x.decl.repo?.path
  const r = await callOp(a, 'run', b.argv, { ...(cwd ? { cwd } : {}), ...(a.canBg ? { bg: true } : { timeoutMs: 10 * 60_000 }) })
  if (!r.ok) return fail(`the build did not start: ${r.error.text}`)
  let exit: number | null = a.canBg ? null : r.value.exitCode
  if (a.canBg) {
    const wait = x.buildWaitMs ?? 60 * 60_000
    const t0 = await x.now()
    let ended = false
    while (!ended && (await x.now()) - t0 < wait) {
      await x.sleep(30_000)
      const s = await callOp(a, 'status', r.value.stdout)
      if (s.ok && !s.value.running) [ended, exit] = [true, s.value.exitCode]
    }
    if (!ended) return fail(`the build still runs after ${Math.round(wait / 60_000)} min (handle ${r.value.stdout}); check C11 again when it ends`)
  }
  const log = await callOp(a, 'readFile', b.log)
  if (!log.ok) return fail(`the build log ${b.log} could not be read (${log.error.text})`)
  const fresh = log.value.length >= mark ? log.value.slice(mark) : log.value // a shorter log was started anew
  const ok = fresh.split(/\r?\n/).some(l => l.includes(b.success))
  return ok ? { status: 'pass', value: `"${b.success}" in ${b.log}` } : fail(`no "${b.success}" line in ${b.log} (exit ${exit ?? 'unknown'}): exit code 0 is not proof`)
}
