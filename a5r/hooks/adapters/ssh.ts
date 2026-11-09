// a5r-hosts S-b: the `ssh` adapter. probe, readFile (1 MiB cap), writeFile (only under the host's lane root or its
// Saved/A5R), run (argv and cwd, written for the remote's OS and passed to the ssh client as ONE argument string, 30 s
// default timeout) and envInfo; no deliver (polling is the fallback, D6). Pure: the local process runner is a closure.
import type { ReachOptions } from '../hosts.ts'
import { DEFAULT_LINK, OP_TIMEOUT_MS, READ_CAP, errOf, okOf, type Adapter, type OpResult, type Probed, type Proc, type RemoteOs, type RemoteShell, type RunInit, type RunOut } from './types.ts'

/** cmd.exe: an argument with a space or a special character is double-quoted (`"` as `\"`); `%VAR%` still expands. */
export const winQuote = (a: string): string => (a !== '' && /^[\w@+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`)
/** sh: an argument with anything but plain characters is single-quoted (`'` as `'\''`). */
export const shQuote = (a: string): string => (a !== '' && /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)
/** The one command string the remote runs: the argv quoted for its OS, after a `cd` when a cwd is given. */
export const remoteLine = (os: RemoteOs, argv: readonly string[], cwd?: string): string => {
  const q = os === 'windows' ? winQuote : shQuote
  const line = argv.map(q).join(' ')
  return cwd ? `${os === 'windows' ? 'cd /d' : 'cd'} ${q(cwd)} && ${line}` : line
}

/** C1's OS reading from `echo a5r %OS%`: cmd expands it, sh prints it as is, a shell that splits echo's words (a
 * PowerShell default shell, S2) prints two lines. */
export const osOf = (stdout: string): { os: RemoteOs; shell: RemoteShell } | null => {
  const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.some(l => /^a5r\s+Windows_NT$/i.test(l))) return { os: 'windows', shell: 'cmd' }
  if (lines.length === 1 && lines[0] === 'a5r %OS%') return { os: 'posix', shell: 'sh' }
  if (lines[0] === 'a5r' && lines[1] === '%OS%') return { os: 'windows', shell: 'other' }
  return null
}

/** Whether a host path lies under one of the writable roots (no `..`; case-insensitive on Windows). */
export const isUnder = (path: string, roots: readonly string[], os: RemoteOs): boolean => {
  const norm = (p: string) => (os === 'windows' ? p.replace(/\\/g, '/').toLowerCase() : p).replace(/\/+$/, '')
  const p = norm(path)
  if (p.split('/').includes('..')) return false
  return roots.filter(Boolean).some(r => p.startsWith(`${norm(r)}/`))
}

export const sshAdapter = (target: string, o: ReachOptions, proc: Proc, known?: { os: RemoteOs; shell: RemoteShell }): Adapter => {
  let seen = known ?? null
  const client = [o.ssh || 'ssh', ...(o.config ? ['-F', o.config] : []), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10']
  /** One remote command string through the client; exit 255 is the link's own failure (ssh's rule). */
  const remote = async (line: string, init: { stdin?: string; timeoutMs?: number } = {}): Promise<OpResult<RunOut>> => {
    const r = await proc([...client, '--', target, line], { ...(init.stdin !== undefined ? { stdin: init.stdin } : {}), timeoutMs: init.timeoutMs ?? OP_TIMEOUT_MS })
    if (!r) return errOf('TIMEOUT', `ssh ${target} did not answer within ${Math.round((init.timeoutMs ?? OP_TIMEOUT_MS) / 1000)} s`)
    if (r.exitCode === 255) return errOf('LINK', `ssh ${target} failed: ${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-1)[0] ?? 'exit 255'}`)
    return okOf(r)
  }
  const probe = async (): Promise<OpResult<Probed>> => {
    const r = await remote('echo a5r %OS%')
    if (!r.ok) return r
    const got = osOf(r.value.stdout)
    if (!got) return errOf('LINK', `ssh ${target} answered, but not the probe's line (${JSON.stringify(r.value.stdout.slice(0, 60))})`)
    seen = got
    return okOf(got)
  }
  const osNow = async (): Promise<OpResult<{ os: RemoteOs; shell: RemoteShell }>> => {
    if (seen) return okOf(seen)
    return probe()
  }
  const run = async (argv: readonly string[], init: RunInit = {}): Promise<OpResult<RunOut>> => {
    const os = await osNow()
    if (!os.ok) return os
    return remote(remoteLine(os.value.os, argv, init.cwd), init)
  }
  const readFile = async (path: string): Promise<OpResult<string>> => {
    const os = await osNow()
    if (!os.ok) return os
    const win = os.value.os === 'windows'
    const size = await remote(win ? `for %I in (${winQuote(path)}) do @echo %~zI` : `wc -c < ${shQuote(path)}`)
    if (!size.ok) return size
    const bytes = Number(size.value.stdout.trim())
    if (size.value.exitCode !== 0 || !Number.isFinite(bytes) || size.value.stdout.trim() === '') return errOf('NOT_FOUND', `${path} could not be read on ${target}`)
    if (bytes > READ_CAP) return errOf('TOO_BIG', `${path} is ${bytes} bytes (cap ${READ_CAP})`)
    const r = await remote(win ? `type ${winQuote(path)}` : `cat ${shQuote(path)}`)
    if (!r.ok) return r
    return r.value.exitCode === 0 ? okOf(r.value.stdout) : errOf('NOT_FOUND', `${path} could not be read on ${target}`)
  }
  const writeFile = async (path: string, text: string): Promise<OpResult<null>> => {
    const os = await osNow()
    if (!os.ok) return os
    const win = os.value.os === 'windows'
    const roots = [o.laneRoot ?? '', o.a5rRoot ? `${o.a5rRoot.replace(/[\\/]+$/, '')}/Saved/A5R` : '']
    if (!isUnder(path, roots, os.value.os)) return errOf('PATH_NOT_ALLOWED', `${path} is not under the host's lane root or Saved/A5R (reach.options laneRoot, a5rRoot)`)
    const ps = `[Console]::InputEncoding=[Text.Encoding]::UTF8; [IO.File]::WriteAllText('${path.replace(/'/g, "''")}', [Console]::In.ReadToEnd())`
    const r = await remote(win ? remoteLine('windows', ['powershell', '-NoProfile', '-NonInteractive', '-Command', ps]) : `cat > ${shQuote(path)}`, { stdin: text })
    if (!r.ok) return r
    return r.value.exitCode === 0 ? okOf(null) : errOf('WRITE_FAILED', `${path} could not be written on ${target} (exit ${r.value.exitCode})`)
  }
  const envInfo = async () => {
    const os = await osNow()
    if (!os.ok) return os
    const r = await remote(os.value.os === 'windows' ? 'echo %USERNAME%' : 'id -un')
    if (!r.ok) return r
    return okOf({ ...os.value, user: r.value.stdout.trim() })
  }
  return { kind: 'ssh', link: DEFAULT_LINK, helpers: () => /^sshd(-session)?(\.exe)?$|^sshd:/i, probe, readFile, writeFile, run, envInfo }
}
