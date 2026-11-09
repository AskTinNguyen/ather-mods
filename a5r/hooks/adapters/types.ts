// a5r-hosts S-b: the adapter interface (prompt.md "Adapter interface"). Every op answers `{ ok, value }` or
// `{ ok: false, error: { code, text } }` and may be absent: `callOp` answers NO_ADAPTER_OP for a missing op, never a
// throw. Pure: no `$`; the local process runner comes in as a closure (register.ts builds it over `$.process.run`).

export type OpError = { code: string; text: string }
export type OpResult<T> = { ok: true; value: T } | { ok: false; error: OpError }
export const okOf = <T>(value: T): OpResult<T> => ({ ok: true, value })
export const errOf = <T>(code: string, text: string): OpResult<T> => ({ ok: false, error: { code, text } })

/** The remote's operating system, read in C1: every remote command is written for it. */
export type RemoteOs = 'windows' | 'posix'
/** The shell the remote runs our one command string in (`other`: a default shell that is neither, S2). */
export type RemoteShell = 'cmd' | 'sh' | 'other'
export type Probed = { os: RemoteOs; shell: RemoteShell }
export type RunOut = { exitCode: number; stdout: string; stderr: string }
/** `bg`: start it and come back at once (S-d: a lane's creation, a job's start); its answer carries a `handle`. */
export type RunInit = { cwd?: string; stdin?: string; timeoutMs?: number; bg?: boolean; env?: Record<string, string> }
/** A background run's state, read by `status` (S-d). */
export type RunState = { running: boolean; exitCode: number | null }

/** A local process run (no shell): its result, or null when it could not start or ran past its timeout. */
export type Proc = (argv: readonly string[], init: { stdin?: string; timeoutMs: number }) => Promise<RunOut | null>

/** D16: how an adapter backs off after a failed link and how many failures an hour it takes before the host pauses. */
export type LinkPolicy = { minMs: number; maxMs: number; factor: number; maxReconnectsPerHour: number }
export const DEFAULT_LINK: LinkPolicy = { minMs: 5_000, maxMs: 15 * 60_000, factor: 2, maxReconnectsPerHour: 30 }

export type Adapter = {
  kind: string
  link: LinkPolicy
  /** S-d: whether `run` honours `bg` (C9 and C11 never start a long run in a short call). */
  canBg?: boolean
  /** C5: the process names of this transport's server-side helpers, per remote OS. */
  helpers: (os: RemoteOs) => RegExp | null
  probe?: () => Promise<OpResult<Probed>>
  readFile?: (path: string) => Promise<OpResult<string>>
  writeFile?: (path: string, text: string) => Promise<OpResult<null>>
  run?: (argv: readonly string[], init?: RunInit) => Promise<OpResult<RunOut>>
  envInfo?: () => Promise<OpResult<{ os: RemoteOs; shell: RemoteShell; user: string }>>
  /** S-d: a background run's state by the handle `run` answered with `bg` (its stdout). */
  status?: (handle: string) => Promise<OpResult<RunState>>
  /** S-d: ring the other side's session (optional; polling is the fallback, D6). */
  deliver?: (message: string) => Promise<OpResult<null>>
}
export type OpName = 'probe' | 'readFile' | 'writeFile' | 'run' | 'envInfo' | 'status' | 'deliver'
/** Every op an adapter may have, in the interface's order (the contract suite and D16's guard go over them). */
export const OP_NAMES: readonly OpName[] = ['probe', 'readFile', 'writeFile', 'run', 'envInfo', 'status', 'deliver']

/** The one way ops are called: a missing op is NO_ADAPTER_OP, a throw inside one is ADAPTER_ERROR. */
export const callOp = async <K extends OpName>(a: Adapter, op: K, ...args: Parameters<NonNullable<Adapter[K]>>): Promise<Awaited<ReturnType<NonNullable<Adapter[K]>>>> => {
  const f = a[op] as ((...xs: unknown[]) => Promise<unknown>) | undefined
  type R = Awaited<ReturnType<NonNullable<Adapter[K]>>>
  if (!f) return errOf('NO_ADAPTER_OP', `the ${a.kind} adapter has no ${op}`) as R
  try {
    return (await f(...args)) as R
  } catch (err) {
    return errOf('ADAPTER_ERROR', String(err)) as R
  }
}

/** Codes that mean the link itself failed (counted in link.jsonl, D16), not the remote command. */
export const LINK_CODES: ReadonlySet<string> = new Set(['LINK', 'TIMEOUT'])

/** Every adapter call's default timeout (prompt.md: 30 s, a build-class run excepted). */
export const OP_TIMEOUT_MS = 30_000
/** readFile's cap (1 MiB). */
export const READ_CAP = 1024 * 1024
