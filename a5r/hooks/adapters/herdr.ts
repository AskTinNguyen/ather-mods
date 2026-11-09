// a5r-hosts S-d: the `herdr` adapter, every op through the local `hc` client (herdr-core) with `--on <target>`: probe and
// run through `hc exec` (argv as given, no shell, its own --timeout), a background run through `hc run --bg
// --outlive-parent` (its terminal is the handle), status through `hc get`, readFile/writeFile through `hc file`, and
// deliver through `hc send <deliverTo>` (absent without `reach.options.deliverTo`). The client's path is the person's
// choice (`reach.options.hc`, default `hc`). Pure: the local process runner is a closure.
import type { ReachOptions } from '../hosts.ts'
import { isUnder, osOf, writableRoots } from './ssh.ts'
import { DEFAULT_LINK, OP_TIMEOUT_MS, READ_CAP, errOf, okOf, type Adapter, type OpResult, type Probed, type Proc, type RemoteOs, type RunInit, type RunOut, type RunState } from './types.ts'

/** The fix for a client that would not start (C1 shows it with its own fix line). */
export const noHcText = (hc: string): string => `hc could not be started (reach.options.hc = "${hc}"): install herdr-core on this machine, or set reach.options.hc to its path`

/** The terminal id `hc run --bg --json` printed (`{"id":"t7"}`, or `machine/t7`), else its first word. */
export const handleOf = (stdout: string): string => {
  try {
    const v = JSON.parse(stdout) as { id?: unknown; terminal?: unknown; address?: unknown }
    const id = v.address ?? v.terminal ?? v.id
    if (typeof id === 'string' && id) return id
  } catch {
    // not JSON: the plain line
  }
  return stdout.trim().split(/\s+/)[0] ?? ''
}
/** `hc get --json <t>`: running while its status is not exited/finished; the exit code when it ended. */
export const runStateOf = (stdout: string): RunState | null => {
  try {
    const v = JSON.parse(stdout) as { status?: unknown; state?: unknown; exit_code?: unknown; exitCode?: unknown }
    const st = String(v.status ?? v.state ?? '')
    const code = v.exit_code ?? v.exitCode
    const ended = /exit|finish|done|dead|gone/i.test(st) || typeof code === 'number'
    return { running: !ended, exitCode: typeof code === 'number' ? code : null }
  } catch {
    return null
  }
}

export const herdrAdapter = (target: string, o: ReachOptions, proc: Proc, known?: Probed): Adapter => {
  const hc = o.hc || 'hc'
  let seen = known ?? null
  /** One local hc call; null from the runner is a client that did not start or ran past its time. */
  const call = async (args: readonly string[], init: { stdin?: string; timeoutMs?: number } = {}): Promise<OpResult<RunOut>> => {
    const ms = init.timeoutMs ?? OP_TIMEOUT_MS
    const r = await proc([hc, ...args], { ...(init.stdin !== undefined ? { stdin: init.stdin } : {}), timeoutMs: ms + 5_000 })
    if (!r) return errOf('TIMEOUT', `${hc} ${args[0] ?? ''} --on ${target} did not answer within ${Math.round(ms / 1000)} s (or ${noHcText(hc)})`)
    return okOf(r)
  }
  const secs = (ms?: number) => String(Math.max(1, Math.min(600, Math.round((ms ?? OP_TIMEOUT_MS) / 1000))))
  const exec = (argv: readonly string[], init: RunInit = {}) =>
    call(['exec', '--on', target, '--timeout', secs(init.timeoutMs), ...(init.cwd ? ['--cwd', init.cwd] : []), ...Object.entries(init.env ?? {}).flatMap(([k, v]) => ['--env', `${k}=${v}`]), ...(init.stdin !== undefined ? ['-i'] : []), '--', ...argv], init)
  const probe = async (): Promise<OpResult<Probed>> => {
    const win = await exec(['cmd', '/c', 'echo', 'a5r', '%OS%'])
    if (!win.ok) return errOf('LINK', win.error.text)
    if (win.value.exitCode === 0 && osOf(win.value.stdout)?.os === 'windows') return okOf((seen = { os: 'windows', shell: 'cmd' }))
    const nix = await exec(['uname', '-s'])
    if (!nix.ok) return errOf('LINK', nix.error.text)
    if (nix.value.exitCode === 0 && nix.value.stdout.trim()) return okOf((seen = { os: 'posix', shell: 'sh' }))
    return errOf('LINK', `${hc} exec --on ${target} answered neither cmd nor uname (${(win.value.stderr || nix.value.stderr).trim().split(/\r?\n/).slice(-1)[0] ?? ''})`)
  }
  const osNow = async (): Promise<OpResult<Probed>> => (seen ? okOf(seen) : probe())
  const run = async (argv: readonly string[], init: RunInit = {}): Promise<OpResult<RunOut>> => {
    if (!init.bg) return exec(argv, init)
    const r = await call(['run', '--bg', '--outlive-parent', '--no-parent', '--no-notify', '--json', '--on', target, ...(init.cwd ? ['--cwd', init.cwd] : []), '--', ...argv])
    if (!r.ok || r.value.exitCode !== 0) return r
    return okOf({ ...r.value, stdout: handleOf(r.value.stdout) })
  }
  const readFile = async (path: string): Promise<OpResult<string>> => {
    const r = await call(['file', 'read', '--on', target, path])
    if (!r.ok) return r
    if (r.value.exitCode !== 0) return errOf('NOT_FOUND', `${path} could not be read on ${target}`)
    return r.value.stdout.length > READ_CAP ? errOf('TOO_BIG', `${path} is over ${READ_CAP} bytes`) : okOf(r.value.stdout)
  }
  const writeFile = async (path: string, text: string): Promise<OpResult<null>> => {
    const os = await osNow()
    if (!os.ok) return os
    const roots = writableRoots(o)
    if (!isUnder(path, roots, os.value.os)) return errOf('PATH_NOT_ALLOWED', `${path} is not under the host's lane root or Saved/A5R (reach.options laneRoot, a5rRoot)`)
    const r = await call(['file', 'write', '--on', target, path], { stdin: text })
    if (!r.ok) return r
    return r.value.exitCode === 0 ? okOf(null) : errOf('WRITE_FAILED', `${path} could not be written on ${target} (exit ${r.value.exitCode})`)
  }
  const status = async (handle: string): Promise<OpResult<RunState>> => {
    const r = await call(['get', '--json', handle])
    if (!r.ok) return r
    const st = r.value.exitCode === 0 ? runStateOf(r.value.stdout) : null
    return st ? okOf(st) : errOf('NOT_FOUND', `terminal ${handle} is not known on ${target}`)
  }
  const envInfo = async () => {
    const os = await osNow()
    if (!os.ok) return os
    const r = await exec(os.value.os === 'windows' ? ['cmd', '/c', 'echo', '%USERNAME%'] : ['id', '-un'])
    if (!r.ok) return r
    return okOf({ ...os.value, user: r.value.stdout.trim() })
  }
  const deliverTo = o.deliverTo
  const deliver = deliverTo
    ? async (message: string): Promise<OpResult<null>> => {
        const r = await call(['send', deliverTo, message])
        if (!r.ok) return r
        return r.value.exitCode === 0 ? okOf(null) : errOf('NOT_DELIVERED', `${hc} send ${deliverTo} exited ${r.value.exitCode}`)
      }
    : undefined
  return { kind: 'herdr', link: DEFAULT_LINK, canBg: true, helpers: (r: RemoteOs) => (r === 'windows' ? /^herdr-core(\.exe)?$/i : /^herdr-core$/), probe, readFile, writeFile, run, status, envInfo, ...(deliver ? { deliver } : {}) }
}
