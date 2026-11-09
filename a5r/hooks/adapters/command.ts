// a5r-hosts S-d: the `command` adapter (D4): any transport (a cloud CLI, a queue client) as one argv template per op in
// `reach.options.ops.<op>`. Placeholders are replaced inside one argv element each and never joined into a shell string:
// `{target}`, `{path}`, `{message}`, `{handle}`, `{cwd}`; an element that is exactly `{argv}` becomes the run's argv
// (each its own element), and `{argv}` inside a longer element is refused. writeFile's text and run's stdin go through
// stdin. A missing op is NO_ADAPTER_OP. The templates are the person's choice (they name what runs on this machine).
// Pure: the local process runner is a closure.
import { isUnder, osOf, writableRoots } from './ssh.ts'
import { DEFAULT_LINK, OP_TIMEOUT_MS, READ_CAP, errOf, okOf, type Adapter, type OpResult, type Probed, type Proc, type RemoteOs, type RunInit, type RunOut, type RunState } from './types.ts'

/** The ops a template may name (`runBg`: run with bg; its stdout's first word is the handle). */
export const COMMAND_OPS = ['probe', 'readFile', 'writeFile', 'run', 'runBg', 'status', 'deliver', 'envInfo'] as const
export type CommandOp = (typeof COMMAND_OPS)[number]
export type CommandOps = Partial<Record<CommandOp, string[]>>
export type CommandOptions = { ops?: CommandOps; os?: RemoteOs; laneRoot?: string; a5rRoot?: string }

/** What is wrong with a template set (empty when every template is usable). */
export const opsProblems = (ops: unknown): string[] => {
  if (typeof ops !== 'object' || ops === null || Array.isArray(ops)) return ['reach.options.ops must be { <op>: [argv template] }']
  return Object.entries(ops).flatMap(([op, t]) => [
    ...((COMMAND_OPS as readonly string[]).includes(op) ? [] : [`reach.options.ops.${op} is not an op (${COMMAND_OPS.join(', ')})`]),
    ...(Array.isArray(t) && t.length > 0 && t.every(x => typeof x === 'string') ? [] : [`reach.options.ops.${op} must be a non-empty list of argv strings`]),
    ...(Array.isArray(t) && t.some(x => typeof x === 'string' && x !== '{argv}' && x.includes('{argv}')) ? [`reach.options.ops.${op}: {argv} must be a whole element (it is never joined into one string)`] : []),
  ])
}

/** A template filled: each placeholder inside its own element; `{argv}` (a whole element) spliced in. */
export const fill = (template: readonly string[], v: { target: string; path?: string; message?: string; handle?: string; cwd?: string; argv?: readonly string[] }): string[] =>
  template.flatMap(el =>
    el === '{argv}'
      ? [...(v.argv ?? [])]
      : [el.replace(/\{(target|path|message|handle|cwd)\}/g, (_, k: 'target' | 'path' | 'message' | 'handle' | 'cwd') => v[k] ?? '')],
  )

export const commandAdapter = (target: string, o: CommandOptions, proc: Proc): Adapter => {
  const ops = o.ops ?? {}
  let seenOs: RemoteOs | null = o.os ?? null // the probe's reading wins once it ran
  const call = async (op: CommandOp, v: Parameters<typeof fill>[1], init: { stdin?: string; timeoutMs?: number } = {}): Promise<OpResult<RunOut>> => {
    const t = ops[op]
    if (!t) return errOf('NO_ADAPTER_OP', `the command adapter has no ${op} template (reach.options.ops.${op})`)
    const argv = fill(t, v)
    const ms = init.timeoutMs ?? OP_TIMEOUT_MS
    const r = await proc(argv, { ...(init.stdin !== undefined ? { stdin: init.stdin } : {}), timeoutMs: ms })
    return r ? okOf(r) : errOf('TIMEOUT', `${argv[0] ?? op} (${op}) did not answer within ${Math.round(ms / 1000)} s, or could not start`)
  }
  const exitErr = (op: string, r: RunOut) => errOf<never>(op === 'probe' ? 'LINK' : 'FAILED', `${op} exited ${r.exitCode}: ${(r.stderr || r.stdout).trim().split(/\r?\n/).slice(-1)[0] ?? ''}`)
  const has = (op: CommandOp) => ops[op] !== undefined
  const probe = async (): Promise<OpResult<Probed>> => {
    const r = await call('probe', { target })
    if (!r.ok) return r.error.code === 'TIMEOUT' ? errOf('LINK', r.error.text) : r
    if (r.value.exitCode !== 0) return exitErr('probe', r.value)
    const got = osOf(r.value.stdout) ?? { os: o.os ?? 'posix', shell: (o.os ?? 'posix') === 'windows' ? 'cmd' : 'sh' }
    seenOs = got.os
    return okOf(got)
  }
  const run = async (argv: readonly string[], init: RunInit = {}): Promise<OpResult<RunOut>> => {
    const r = await call(init.bg ? 'runBg' : 'run', { target, argv, ...(init.cwd ? { cwd: init.cwd } : {}) }, init)
    if (!r.ok || !init.bg) return r
    return r.value.exitCode === 0 ? okOf({ ...r.value, stdout: r.value.stdout.trim().split(/\s+/)[0] ?? '' }) : exitErr('runBg', r.value)
  }
  const readFile = async (path: string): Promise<OpResult<string>> => {
    const r = await call('readFile', { target, path })
    if (!r.ok) return r
    if (r.value.exitCode !== 0) return errOf('NOT_FOUND', `${path} could not be read through the command adapter`)
    return r.value.stdout.length > READ_CAP ? errOf('TOO_BIG', `${path} is over ${READ_CAP} bytes`) : okOf(r.value.stdout)
  }
  const writeFile = async (path: string, text: string): Promise<OpResult<null>> => {
    const roots = writableRoots(o)
    if (!isUnder(path, roots, seenOs ?? 'posix')) return errOf('PATH_NOT_ALLOWED', `${path} is not under the host's lane root or Saved/A5R (reach.options laneRoot, a5rRoot)`)
    const r = await call('writeFile', { target, path }, { stdin: text })
    if (!r.ok) return r
    return r.value.exitCode === 0 ? okOf(null) : errOf('WRITE_FAILED', `${path} could not be written (exit ${r.value.exitCode})`)
  }
  const status = async (handle: string): Promise<OpResult<RunState>> => {
    const r = await call('status', { target, handle })
    if (!r.ok) return r
    // The template prints "running", or the exit code once it ended.
    const word = r.value.stdout.trim().split(/\s+/)[0] ?? ''
    return r.value.exitCode !== 0 ? exitErr('status', r.value) : /^running$/i.test(word) ? okOf({ running: true, exitCode: null }) : okOf({ running: false, exitCode: Number.isFinite(Number(word)) && word !== '' ? Number(word) : null })
  }
  const deliver = async (message: string): Promise<OpResult<null>> => {
    const r = await call('deliver', { target, message })
    if (!r.ok) return r
    return r.value.exitCode === 0 ? okOf(null) : errOf('NOT_DELIVERED', `deliver exited ${r.value.exitCode}`)
  }
  const envInfo = async () => {
    const r = await call('envInfo', { target })
    if (!r.ok) return r
    const p = await probe()
    if (!p.ok) return p
    return okOf({ ...p.value, user: r.value.stdout.trim() })
  }
  return {
    kind: 'command',
    link: DEFAULT_LINK,
    helpers: () => null,
    ...(has('probe') ? { probe } : {}),
    ...(has('readFile') ? { readFile } : {}),
    ...(has('writeFile') ? { writeFile } : {}),
    ...(has('run') || has('runBg') ? { run } : {}),
    ...(has('status') ? { status } : {}),
    ...(has('deliver') ? { deliver } : {}),
    ...(has('envInfo') ? { envInfo } : {}),
  }
}
