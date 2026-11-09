// a5r-hosts S-b: the declarations (prompt.md "Data structures" 1, D2). `hosts` (outbound: the machines this one sends
// to) and `asHost` (inbound: this machine when it serves others) hold declarations only, never state (D20). They are
// read from two places, merged per host id with the file winning: the plugin options (`pluginConfigs."a5r"`, JSON text,
// written by hand) and the machine-local file `<home>/.claude/a5r/hosts.json` (F-b1), which only `/a5r host …` and the
// host tool write (`writeHosts`). Every entry is validated on read; one the tool did not write (an option, or a file
// entry whose sum no longer matches) is flagged `edited-by-hand`. Pure: no `$`.
import { isObj, isStrs } from './shape.ts'
import { opsProblems, type CommandOps } from './adapters/command.ts'

/** `/a5r host …` (the command and the help line). */
export const HOST_USAGE = '/a5r host list · status · add <id> --reach ssh:<target>|herdr:<machine>|command:<target>|manual [--label "<text>"] [--owner <who>] [--ssh <client>] [--config <ssh config>] [--hc <client>] [--ops <json>] [--deliver-to <terminal>] [--a5r-root <path>] [--lane-root <path>] · check <id> [C1 C2 …] [--paste <file>] · pause <id> [reason] · resume <id> · remove <id> · suggest [--minutes N] [--pie] [--build] [--readonly] [--need-gb N] [--wants a,b] [--waited N]'
export const HOST_ID = /^[a-z0-9-]{1,32}$/
export const REACH_KINDS = ['ssh', 'herdr', 'command', 'manual'] as const
export type ReachKind = (typeof REACH_KINDS)[number]
export type Availability = { state: 'yes' | 'no'; reason?: string }
/** `reach.options`: the ssh client (an ssh executable) and its config file, the host's writable roots, and whether the
 * host must wake this machine (S6). S-d: the herdr client (`hc`) and the terminal its deliver rings (`deliverTo`); the
 * command adapter's argv templates (`ops`) and the remote OS they run on (`os`). */
export type ReachOptions = { ssh?: string; config?: string; laneRoot?: string; a5rRoot?: string; reverse?: boolean; hc?: string; deliverTo?: string; ops?: CommandOps; os?: 'windows' | 'posix' }
export type HostDecl = {
  label: string
  owner: string
  reach: { kind: ReachKind; target: string; options?: ReachOptions }
  /** `lfsProbe`: one small LFS file C3 fetches when the repo uses LFS. */
  repo?: { url: string; path?: string; lfsProbe?: string }
  engine?: { rule: 'same' | 'any' }
  diskEstimateGb?: number
  assumed?: { roles?: string[]; availability?: Availability }
  /** S-d (C11): the host's build, run in a lane; passes only by the literal success line in its log. */
  build?: { argv: string[]; log: string; success: string }
}
export type Window = { days: string[]; from: string; to: string; tz: string }
export type AsHost = {
  enabled: boolean
  coordinationRoot?: string
  laneRoot?: string
  capacity?: { ramGb: number; maxEditors: number; maxJobs: number; diskGb?: number }
  roles: string[]
  availability: Availability & { windows?: Window[]; until?: number }
  trust: string[]
  /** S-d (rev 5): how an accepted job gets a session: an argv template (`{packet}` the inbox file, `{id}` the job id), no
   * shell; absent: the job waits for `/a5r job take <id>`. */
  startCommand?: string[]
  ephemeral?: boolean
  account?: { shared: 'yes' | 'no' | 'unknown' }
}
export type HostsOptions = { staleCardMin: number; staleCheckDays: number; longMinutes: number; readOnlyWaitMin: number; needGbDefault: number; suggest: boolean; warnBeforeUntilMin: number }
export const HOSTS_OPTIONS: HostsOptions = { staleCardMin: 10, staleCheckDays: 7, longMinutes: 120, readOnlyWaitMin: 15, needGbDefault: 0, suggest: true, warnBeforeUntilMin: 15 }

/** One host as read: its declaration (null when invalid), the problems found, and whether a hand wrote it. */
export type HostEntry = { id: string; decl: HostDecl | null; problems: string[]; byHand: boolean; from: 'option' | 'file' }
export type Declared = { hosts: HostEntry[]; asHost: AsHost | null; asHostProblems: string[]; asHostByHand: boolean; options: HostsOptions }

/** The machine-local file (F-b1): the declarations plus, per entry, the sum of what the tool last wrote. */
export type HostsFile = { v: 1; hosts: Record<string, unknown>; asHost?: unknown; sums: { hosts: Record<string, string>; asHost?: string } }
export const HOSTS_FILE = '.claude/a5r/hosts.json'

const json = (raw: string | null | undefined): unknown => {
  if (!raw || !raw.trim()) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return null // present but not JSON: a problem, not "none"
  }
}

/** A stable text of a value (keys sorted), so a sum does not move when a hand reorders keys. */
export const canonical = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : isObj(v) ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v ?? null)
/** FNV-1a (32 bit) of the canonical text: enough to see that a hand changed an entry, not a security measure. */
export const sumOf = (v: unknown): string => {
  let h = 0x811c9dc5
  for (const ch of canonical(v)) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** The sum the checks ran against (state.json `declSum`): only what the checks depend on (reach, repo, engine), so a new
 * label, owner or assumption keeps the level (F-c4). */
export const checkedSumOf = (d: HostDecl): string => sumOf({ reach: d.reach, repo: d.repo, engine: d.engine })

const availProblems = (v: unknown, at: string): string[] =>
  !isObj(v) ? [`${at} must be { state: "yes" | "no", reason? }`] : [...(v.state === 'yes' || v.state === 'no' ? [] : [`${at}.state must be "yes" or "no"`]), ...(v.reason === undefined || typeof v.reason === 'string' ? [] : [`${at}.reason must be text`])]

export const idProblem = (id: string): string | null => (HOST_ID.test(id) ? null : `host id "${id}" must be 1-32 of a-z, 0-9 and -`)
/** The ssh client must be an ssh executable: a declaration never names another program to run. */
const SSH_CLIENT = /(^|[\\/])ssh(\.exe)?$/i
/** An ssh target: a host, an alias or user@host; never something the client would read as an option. */
const SSH_TARGET = /^(?!-)[\w.@:[\]-]+$/
/** The herdr client must be an hc executable. */
const HC_CLIENT = /(^|[\\/])hc(\.exe|\.cmd)?$/i
/** reach.options only the person's own `/a5r host add` may set: they choose what runs on this machine. */
export const PERSON_ONLY_OPTIONS = ['ssh', 'config', 'hc', 'ops'] as const
const OPTION_KEYS = ['ssh', 'config', 'laneRoot', 'a5rRoot', 'reverse', 'hc', 'deliverTo', 'ops', 'os']
const optionsProblems = (id: string, o: Record<string, unknown>): string[] => [
  ...Object.keys(o).filter(k => !OPTION_KEYS.includes(k)).map(k => `hosts.${id}.reach.options.${k} is not an option (${OPTION_KEYS.join(', ')})`),
  ...(['ssh', 'config', 'laneRoot', 'a5rRoot', 'hc', 'deliverTo'] as const).filter(k => o[k] !== undefined && typeof o[k] !== 'string').map(k => `hosts.${id}.reach.options.${k} must be text`),
  ...(typeof o.hc === 'string' && !HC_CLIENT.test(o.hc) ? [`hosts.${id}.reach.options.hc must be the herdr client (hc, hc.exe or hc.cmd)`] : []),
  ...(o.ops !== undefined ? opsProblems(o.ops).map(p => `hosts.${id}.${p}`) : []),
  ...(o.os !== undefined && o.os !== 'windows' && o.os !== 'posix' ? [`hosts.${id}.reach.options.os must be "windows" or "posix"`] : []),
  ...(typeof o.ssh === 'string' && !SSH_CLIENT.test(o.ssh) ? [`hosts.${id}.reach.options.ssh must be an ssh client (ssh or ssh.exe)`] : []),
  ...(o.reverse !== undefined && typeof o.reverse !== 'boolean' ? [`hosts.${id}.reach.options.reverse must be true or false`] : []),
]

/** Section 1's `hosts.<id>`: what is wrong with it (empty when it is valid). */
export const declProblems = (id: string, v: unknown): string[] => {
  const p: string[] = []
  const bad = idProblem(id)
  if (bad) p.push(bad)
  if (!isObj(v)) return [...p, `hosts.${id} must be an object`]
  if (typeof v.label !== 'string' || !v.label.trim()) p.push(`hosts.${id}.label must be text`)
  if (typeof v.owner !== 'string') p.push(`hosts.${id}.owner must be text`)
  const r = v.reach
  if (!isObj(r) || !(REACH_KINDS as readonly string[]).includes(String(r.kind))) p.push(`hosts.${id}.reach.kind must be one of ${REACH_KINDS.join(', ')}`)
  else {
    if (typeof r.target !== 'string' || (r.kind !== 'manual' && !r.target.trim())) p.push(`hosts.${id}.reach.target must name the machine for ${String(r.kind)}`)
    else if ((r.kind === 'ssh' || r.kind === 'herdr') && !SSH_TARGET.test(r.target)) p.push(`hosts.${id}.reach.target must be a host name, an ssh alias or user@host (no leading -, no spaces)`)
    if (r.options !== undefined) p.push(...(isObj(r.options) ? optionsProblems(id, r.options) : [`hosts.${id}.reach.options must be an object`]))
  }
  const repo = v.repo
  if (repo !== undefined && !(isObj(repo) && typeof repo.url === 'string' && ['path', 'lfsProbe'].every(k => repo[k] === undefined || typeof repo[k] === 'string'))) p.push(`hosts.${id}.repo must be { url, path?, lfsProbe? }`)
  if (v.build !== undefined && !(isObj(v.build) && isStrs(v.build.argv) && v.build.argv.length > 0 && typeof v.build.log === 'string' && typeof v.build.success === 'string' && v.build.success.trim() !== '')) p.push(`hosts.${id}.build must be { argv: [..], log: "<path>", success: "<line>" }`)
  if (v.engine !== undefined && !(isObj(v.engine) && (v.engine.rule === 'same' || v.engine.rule === 'any'))) p.push(`hosts.${id}.engine.rule must be "same" or "any"`)
  if (v.diskEstimateGb !== undefined && !(typeof v.diskEstimateGb === 'number' && v.diskEstimateGb > 0)) p.push(`hosts.${id}.diskEstimateGb must be a positive number`)
  if (v.assumed !== undefined) {
    if (!isObj(v.assumed)) p.push(`hosts.${id}.assumed must be an object`)
    else {
      if (v.assumed.roles !== undefined && !isStrs(v.assumed.roles)) p.push(`hosts.${id}.assumed.roles must be a list of text`)
      if (v.assumed.availability !== undefined) p.push(...availProblems(v.assumed.availability, `hosts.${id}.assumed.availability`))
    }
  }
  // D20: options hold no state.
  for (const k of ['checks', 'level', 'pausedUntil', 'link', 'card']) if (k in v) p.push(`hosts.${id}.${k} is state, kept in Saved/A5R/hosts/${id}/state.json, never in the options`)
  return p
}
/** A declaration checked: typed, or its problems. */
export const declOf = (id: string, v: unknown): { decl: HostDecl } | { problems: string[] } => {
  const problems = declProblems(id, v)
  return problems.length ? { problems } : { decl: v as HostDecl }
}

/** Section 1's `asHost` (the host owner's facts about this machine). */
export const asHostProblems = (v: unknown): string[] => {
  if (!isObj(v)) return ['asHost must be an object']
  const p: string[] = []
  if (typeof v.enabled !== 'boolean') p.push('asHost.enabled must be true or false')
  for (const k of ['coordinationRoot', 'laneRoot'] as const) if (v[k] !== undefined && typeof v[k] !== 'string') p.push(`asHost.${k} must be a path`)
  if (!isStrs(v.roles ?? [])) p.push('asHost.roles must be a list of text')
  if (!isStrs(v.trust ?? [])) p.push('asHost.trust must be a list of origin ids ("*" = any)')
  if (v.startCommand !== undefined && !(isStrs(v.startCommand) && v.startCommand.length > 0)) p.push('asHost.startCommand must be a non-empty argv list ({packet}, {id})')
  if (v.availability !== undefined) {
    p.push(...availProblems(v.availability, 'asHost.availability'))
    const w = isObj(v.availability) ? v.availability.windows : undefined
    if (w !== undefined && !(Array.isArray(w) && w.every(x => isObj(x) && isStrs(x.days) && /^[0-9]{2}:[0-9]{2}$/.test(String(x.from)) && /^[0-9]{2}:[0-9]{2}$/.test(String(x.to)) && typeof x.tz === 'string'))) p.push('asHost.availability.windows must be [{ days, from: "HH:MM", to: "HH:MM", tz }]')
  }
  if (v.capacity !== undefined && !(isObj(v.capacity) && ['ramGb', 'maxEditors', 'maxJobs'].every(k => typeof (v.capacity as Record<string, unknown>)[k] === 'number'))) p.push('asHost.capacity must be { ramGb, maxEditors, maxJobs, diskGb? }')
  if (v.account !== undefined && !(isObj(v.account) && ['yes', 'no', 'unknown'].includes(String(v.account.shared)))) p.push('asHost.account.shared must be yes, no or unknown')
  return p
}

/** A checked asHost (asHostProblems found nothing): its fields, with the defaults section 1 gives. */
const asHostOf = (v: Record<string, unknown>): AsHost => {
  const a = isObj(v.availability) ? v.availability : {}
  const text = (x: unknown) => (typeof x === 'string' ? x : undefined)
  return {
    enabled: v.enabled === true,
    ...(text(v.coordinationRoot) ? { coordinationRoot: text(v.coordinationRoot) } : {}),
    ...(text(v.laneRoot) ? { laneRoot: text(v.laneRoot) } : {}),
    ...(isObj(v.capacity) ? { capacity: v.capacity as AsHost['capacity'] } : {}),
    roles: isStrs(v.roles) ? v.roles : [],
    availability: { state: a.state === 'no' ? 'no' : 'yes', ...(text(a.reason) ? { reason: text(a.reason) } : {}), ...(Array.isArray(a.windows) ? { windows: a.windows as Window[] } : {}), ...(typeof a.until === 'number' ? { until: a.until } : {}) },
    trust: isStrs(v.trust) ? v.trust : [],
    ...(isStrs(v.startCommand) && v.startCommand.length ? { startCommand: v.startCommand } : {}),
    ...(typeof v.ephemeral === 'boolean' ? { ephemeral: v.ephemeral } : {}),
    ...(isObj(v.account) ? { account: { shared: v.account.shared as 'yes' | 'no' | 'unknown' } } : {}),
  }
}

/** The plugin options as register(on, options) hands them (strings): `hosts`, `asHost`, `hostsOptions` (`originId` goes to the hand-off desk). */
export type HostOptionText = { hosts?: string; asHost?: string; hostsOptions?: string }

export const parseHostsFile = (raw: string | null): HostsFile => {
  const v = json(raw)
  const sums = isObj(v) && isObj(v.sums) ? v.sums : {}
  return {
    v: 1,
    hosts: isObj(v) && isObj(v.hosts) ? v.hosts : {},
    ...(isObj(v) && v.asHost !== undefined ? { asHost: v.asHost } : {}),
    sums: { hosts: isObj(sums.hosts) ? (sums.hosts as Record<string, string>) : {}, ...(typeof sums.asHost === 'string' ? { asHost: sums.asHost } : {}) },
  }
}

/** A2: both sources read, validated and merged (the file wins per host id); hand-written entries flagged. */
export const readHosts = (o: HostOptionText, fileText: string | null): Declared => {
  const file = parseHostsFile(fileText)
  const opt = json(o.hosts)
  const optHosts = isObj(opt) ? opt : {}
  const entries = new Map<string, HostEntry>()
  const entry = (id: string, v: unknown, from: HostEntry['from']): HostEntry => {
    const d = declOf(id, v)
    return { id, decl: 'decl' in d ? d.decl : null, problems: 'problems' in d ? d.problems : [], byHand: from === 'option' || file.sums.hosts[id] !== sumOf(v), from }
  }
  for (const [id, v] of Object.entries(optHosts)) entries.set(id, entry(id, v, 'option'))
  for (const [id, v] of Object.entries(file.hosts)) entries.set(id, entry(id, v, 'file'))
  if (opt === null) entries.set('(option)', { id: '(option)', decl: null, problems: ['pluginConfigs."a5r".hosts is not JSON'], byHand: true, from: 'option' })
  const optAs = json(o.asHost)
  const asRaw = file.asHost !== undefined ? file.asHost : optAs
  const asProblems = optAs === null && file.asHost === undefined ? ['pluginConfigs."a5r".asHost is not JSON'] : asRaw === undefined ? [] : asHostProblems(asRaw)
  const optsRaw = json(o.hostsOptions)
  const options = { ...HOSTS_OPTIONS, ...(isObj(optsRaw) ? Object.fromEntries(Object.entries(optsRaw).filter(([k, x]) => k in HOSTS_OPTIONS && typeof x === typeof HOSTS_OPTIONS[k as keyof HostsOptions])) : {}) } as HostsOptions
  return {
    hosts: [...entries.values()].sort((a, b) => a.id.localeCompare(b.id)),
    asHost: asRaw !== undefined && isObj(asRaw) && asProblems.length === 0 ? asHostOf(asRaw) : null,
    asHostProblems: asProblems,
    asHostByHand: asRaw !== undefined && (file.asHost === undefined || file.sums.asHost !== sumOf(file.asHost)),
    options,
  }
}

/** A2: the one writer's change: the file with a host set (or removed: null), or why not. Validation runs first. */
export const writeHosts = (fileText: string | null, change: { id: string; decl: unknown } | { asHost: unknown }): { text: string } | { problems: string[] } => {
  const file = parseHostsFile(fileText)
  if ('asHost' in change) {
    const p = asHostProblems(change.asHost)
    if (p.length) return { problems: p }
    return { text: JSON.stringify({ ...file, asHost: change.asHost, sums: { ...file.sums, asHost: sumOf(change.asHost) } }, null, 2) }
  }
  const { [change.id]: _gone, ...hosts } = file.hosts
  const { [change.id]: _sum, ...sums } = file.sums.hosts
  if (change.decl === null) return { text: JSON.stringify({ ...file, hosts, sums: { ...file.sums, hosts: sums } }, null, 2) }
  const p = declProblems(change.id, change.decl)
  if (p.length) return { problems: p }
  return { text: JSON.stringify({ ...file, hosts: { ...hosts, [change.id]: change.decl }, sums: { ...file.sums, hosts: { ...sums, [change.id]: sumOf(change.decl) } } }, null, 2) }
}

/** `ssh:<target>` or `manual` (the command's `--reach`). */
export const reachOf = (text: string): HostDecl['reach'] | null => {
  const t = text.trim()
  if (t === 'manual') return { kind: 'manual', target: '' }
  const m = /^(ssh|herdr|command):(.+)$/.exec(t)
  return m ? { kind: m[1] as ReachKind, target: (m[2] ?? '').trim() } : null
}
export const reachText = (r: HostDecl['reach']): string => (r.kind === 'manual' ? 'manual' : `${r.kind}:${r.target}`)

/** D19, decision 7 (S-d): the tree a session coordinates through. A session whose own main tree lies under this
 * machine's `asHost.laneRoot` (a lane, even a separate clone) uses `asHost.coordinationRoot` (the machine-local hosts
 * file's) for its Editor holder, queue, RAM gate and sync freeze; any other tree is its own. A lane that is a worktree of
 * the coordination root already resolves to it (its main tree). */
export const coordinationFor = async <T>(found: T, read: (path: string) => Promise<string | null>, home: string): Promise<T | { tree: string }> => {
  if (!isObj(found) || typeof found.tree !== 'string' || !home) return found
  const slash = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const as = parseHostsFile(await read(`${slash(home)}/${HOSTS_FILE}`)).asHost
  if (!isObj(as) || asHostProblems(as).length || typeof as.laneRoot !== 'string' || typeof as.coordinationRoot !== 'string') return found
  return slash(found.tree).toLowerCase().startsWith(`${slash(as.laneRoot).toLowerCase()}/`) ? { tree: slash(as.coordinationRoot) } : found
}
