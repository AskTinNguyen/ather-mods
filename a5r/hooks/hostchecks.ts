// a5r-hosts S-b: the health checks that are the setup (prompt.md "Health checks", D14), run through an adapter: C1 reach
// and the remote OS, C2 byte-clean stdin and stdout, C4 clock skew, C5 orphan helpers, C10 RAM. The others answer
// `skip: not in this version`. Checks run in order; the first failure stops the run (later ones `skip`), and a run with
// no checks named resumes at the first check that has not passed (A13). Pure: the adapter and the local runner are
// closures; the results go to state.json through the host tool.
import { callOp, type Adapter, type Proc, type RemoteOs, type RemoteShell } from './adapters/types.ts'
import type { Pasted } from './adapters/manual.ts'
import { CHECK_IDS, passed, type CheckId, type CheckResult, type Checks } from './hoststate.ts'
import { c12, c13, type L2Ctx } from './l2checks.ts'

/** The checks this version runs; the rest answer NOT_YET. */
/** L1's checks (S-b): a manual host's pasted lines fill them. */
export const L1_CHECKS: readonly CheckId[] = ['C1', 'C2', 'C4', 'C5', 'C10']
export const BUILT: readonly CheckId[] = [...L1_CHECKS, 'C12', 'C13']
/** The checks a run with none named takes (A13's resume): C12 waits up to C12_WAIT_MS for the host's minute, so it runs
 * only when named (`/a5r host check <id> C12`; F-d3). */
export const AUTO: readonly CheckId[] = BUILT.filter(id => id !== 'C12')
export const NOT_YET = 'not in this version'

/** The fix line of each check (prompt.md's table), shown with a failure. */
export const FIX: Record<CheckId, string> = {
  C1: 'name which direction failed; look for policy blocks on the failing side (S1: a group allow list on the SSH server); ask the host owner/IT; polling stays available',
  C2: "the link changes bytes; a possible cause is the host's SSH default shell (S2, e.g. a PowerShell default shell): set the server's default shell to the plain command shell, retest; never use that link for adapters until pass",
  C3: 'S3: the credential is stored for a different logon; run the one-time interactive login in the logon the adapter uses, or switch the adapter to the logon that has it; never copy secrets through A5R',
  C4: 'sync time on the host; windows and heartbeats rely on it',
  C5: 'S2: kill leaked pairs (may need elevation: report to the host owner); do not declare until stable',
  C6: 'none needed: mark source: probe; offer to install the plugin',
  C7: 'install or select the matching engine; set engine.rule: any only if the task kinds do not need a build',
  C8: 'S4: free space, use a cloning volume if available, or use readOnly-only roles; never create the lane before this passes',
  C9: 'resume a partial lane; do not start a second full copy',
  C10: 'record measured value; adjust maxEditors',
  C11: 'fix the build; exit code 0 is not proof',
  C12: 'read which file or transition stalled; usually C2/C3',
  C13: 'add it host-side (host owner)',
}

export const SKEW_LIMIT_MS = 120_000
/** C2 (c): printed by a plain echo on either OS; only characters neither cmd nor sh interprets or quotes. */
export const STDOUT_SEQ = 'A5R-BYTES-0123456789-abcxyz-ABCXYZ-@+=:,./_'
/** C2 (a): "b a c" with the line ending the remote's `sort` reads: Windows sort.exe reads LF-only input as UTF-16 and
 * prints `???` with no shell involved (F-b4), so a Windows remote gets CRLF. */
export const SORT_INPUT: Record<RemoteOs, string> = { windows: 'b\r\na\r\nc\r\n', posix: 'b\na\nc\n' }
/** C2 (b): every value 0..255 as one character each (the engine's stdin is text: sent as UTF-8, F-b2). */
export const ALL_BYTES = Array.from({ length: 256 }, (_, i) => String.fromCharCode(i)).join('')

export type Ram = { totalGb: number; freeGb: number | null }
export type CheckCtx = {
  adapter: Adapter
  /** This machine's process runner (C2 (b) hashes the same bytes locally). */
  local: Proc
  now: () => Promise<number>
  prior: Checks
  os?: { os: RemoteOs; shell: RemoteShell }
  /** `reach.options.reverse`: the host must wake the origin (S6); not testable without deliver, so it only lowers deliver. */
  reverse?: boolean
  /** S-d: what C12 and C13 read (absent: they skip). */
  l2?: L2Ctx
}
export type RunReport = { checks: Checks; ran: CheckId[]; failed: CheckId | null; os?: { os: RemoteOs; shell: RemoteShell }; ram?: Ram }
type One = { status: CheckResult['status']; value: string; ms?: number; os?: { os: RemoteOs; shell: RemoteShell }; ram?: Ram }

const gb = (kb: number) => Math.round((kb / 1024 / 1024) * 10) / 10
const lines = (s: string) => s.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
const fail = (value: string): One => ({ status: 'fail', value })

const c1 = async (x: CheckCtx): Promise<One> => {
  const t0 = await x.now()
  const p = await callOp(x.adapter, 'probe')
  const ms = (await x.now()) - t0
  if (!p.ok) return p.error.code === 'NO_ADAPTER_OP' ? { status: 'skip', value: `the ${x.adapter.kind} adapter has no probe` } : fail(`origin to host: ${p.error.text}`)
  const shell = p.value.shell === 'other' ? 'a default shell that is neither cmd nor sh' : p.value.shell
  return { status: 'pass', value: `${p.value.os} (${shell}), ${ms} ms${x.reverse ? '; host to origin: not tested in this version (deliver stays off, polling works)' : ''}`, os: { os: p.value.os, shell: p.value.shell } }
}

const c2 = async (x: CheckCtx, os: RemoteOs): Promise<One> => {
  const sorted = await callOp(x.adapter, 'run', ['sort'], { stdin: SORT_INPUT[os] })
  if (!sorted.ok) return fail(`sort did not run: ${sorted.error.text}`)
  const got = lines(sorted.value.stdout)
  if (got.join(' ') !== 'a b c') return fail(`sort returned ${JSON.stringify(got.join(' '))} for "b a c": the lines did not arrive as sent (possibly a default shell that is not the plain command shell, e.g. PowerShell)`)
  const [there, here] = await Promise.all([callOp(x.adapter, 'run', ['git', 'hash-object', '--stdin'], { stdin: ALL_BYTES }), x.local(['git', 'hash-object', '--stdin'], { stdin: ALL_BYTES, timeoutMs: 30_000 })])
  if (!there.ok || there.value.exitCode !== 0) return fail(`git hash-object did not run on the host (${there.ok ? `exit ${there.value.exitCode}` : there.error.text})`)
  if (!here || here.exitCode !== 0) return { status: 'skip', value: 'git hash-object did not run on this machine; stdin bytes not compared' }
  if (there.value.stdout.trim() !== here.stdout.trim()) return fail(`the 256 values 0-255 hashed ${there.value.stdout.trim().slice(0, 12)} on the host, ${here.stdout.trim().slice(0, 12)} here: stdin bytes changed on the way (possibly a default shell that is not the plain command shell, e.g. PowerShell)`)
  const echoed = await callOp(x.adapter, 'run', ['echo', STDOUT_SEQ])
  if (!echoed.ok) return fail(`echo did not run: ${echoed.error.text}`)
  if (echoed.value.stdout.replace(/\r?\n$/, '').trimEnd() !== STDOUT_SEQ) return fail(`stdout changed on the way: ${JSON.stringify(echoed.value.stdout.slice(0, 60))} for ${STDOUT_SEQ} (possibly a default shell that is not the plain command shell, e.g. PowerShell)`)
  return { status: 'pass', value: 'sort a b c; 256 bytes in, same hash; stdout as sent' }
}

const c4 = async (x: CheckCtx, os: RemoteOs): Promise<One> => {
  const t0 = await x.now()
  const r = await callOp(x.adapter, 'run', os === 'windows' ? ['powershell', '-NoProfile', '-NonInteractive', '-Command', '[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()'] : ['date', '+%s'])
  const t1 = await x.now()
  if (!r.ok) return fail(`the host's clock could not be read: ${r.error.text}`)
  const n = Number(lines(r.value.stdout)[0])
  if (!Number.isFinite(n) || n <= 0) return fail(`the host's clock could not be read: ${JSON.stringify(r.value.stdout.slice(0, 40))}`)
  return skewOne((os === 'windows' ? n : n * 1000) - (t0 + t1) / 2)
}
/** C4's result: the skew (host minus here) as its number `ms` and as text. */
const skewOne = (skew: number): One => ({ status: Math.abs(skew) < SKEW_LIMIT_MS ? 'pass' : 'fail', value: `skew ${skew >= 0 ? '+' : '-'}${(Math.abs(skew) / 1000).toFixed(1)} s (limit 120 s)`, ms: Math.round(skew) })

/** C5: the helper processes the remote user owns, counted over 3 probe cycles. */
export const helperCount = (stdout: string, os: RemoteOs, pattern: RegExp): number =>
  lines(stdout).map(l => (os === 'windows' ? (/^"([^"]*)"/.exec(l)?.[1] ?? l.split(',')[0] ?? '') : l)).filter(n => pattern.test(n)).length
const c5 = async (x: CheckCtx, os: RemoteOs): Promise<One> => {
  const pattern = x.adapter.helpers(os)
  if (!pattern) return { status: 'skip', value: `the ${x.adapter.kind} adapter declares no helper processes` }
  const counts: number[] = []
  for (let i = 0; i < 3; i++) {
    const p = await callOp(x.adapter, 'probe')
    if (!p.ok) return fail(`probe cycle ${i + 1} failed: ${p.error.text}`)
    const r = await callOp(x.adapter, 'run', os === 'windows' ? ['tasklist', '/fo', 'csv', '/nh', '/fi', 'USERNAME eq %USERNAME%'] : ['ps', '-x', '-o', 'comm='])
    if (!r.ok) return fail(`the process list could not be read: ${r.error.text}`)
    counts.push(helperCount(r.value.stdout, os, pattern))
  }
  const rising = counts.every((c, i) => i === 0 || c > (counts[i - 1] ?? 0))
  return { status: rising ? 'fail' : 'pass', value: `helpers ${counts.join(', ')} over 3 probe cycles${rising ? ': rising (a leak)' : ''}` }
}

/** C10's reading (and the probe card's): total and free RAM, Windows through one CIM call, POSIX from /proc/meminfo or
 * sysctl; null when it cannot be read. */
export const ramOf = async (a: Adapter, os: RemoteOs): Promise<Ram | null> => {
  const r = await callOp(a, 'run', os === 'windows' ? ['powershell', '-NoProfile', '-NonInteractive', '-Command', '$o=Get-CimInstance Win32_OperatingSystem; Write-Output ([string]$o.TotalVisibleMemorySize + [char]32 + [string]$o.FreePhysicalMemory)'] : ['cat', '/proc/meminfo'])
  if (r.ok && os === 'windows') {
    const [t, f] = (lines(r.value.stdout)[0] ?? '').split(/\s+/).map(Number)
    if (t && Number.isFinite(t)) return { totalGb: gb(t), freeGb: f !== undefined && Number.isFinite(f) ? gb(f) : null }
  } else if (r.ok) {
    const kb = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(r.value.stdout)?.[1])
    if (kb('MemTotal')) return { totalGb: gb(kb('MemTotal')), freeGb: kb('MemAvailable') ? gb(kb('MemAvailable')) : null }
  }
  if (os !== 'posix') return null
  const s = await callOp(a, 'run', ['sysctl', '-n', 'hw.memsize'])
  const bytes = s.ok ? Number(s.value.stdout.trim()) : NaN
  return bytes > 0 ? { totalGb: gb(bytes / 1024), freeGb: null } : null
}

const c10 = async (x: CheckCtx, os: RemoteOs): Promise<One> => {
  const ram = await ramOf(x.adapter, os)
  if (!ram) return fail('total RAM could not be read')
  return { status: 'pass', value: `total ${ram.totalGb} GB, free ${ram.freeGb ?? 'unknown'} GB`, ram }
}

/** The checks this version runs after C1 (which reads the OS), by id. */
const noL2: One = { status: 'skip', value: 'no host context for the L2 checks' }
const RUN = {
  C2: c2,
  C4: c4,
  C5: c5,
  C10: c10,
  C12: async (x: CheckCtx): Promise<One> => (x.l2 ? c12(x.adapter, x.l2, x.now) : noL2),
  C13: async (x: CheckCtx): Promise<One> => (x.l2 ? c13(x.l2) : noL2),
} satisfies Partial<Record<CheckId, (x: CheckCtx, os: RemoteOs) => Promise<One>>>

/** Which checks a run takes: the named ones, or (none named) from the first built check not standing as passed (A13). */
export const planOf = (named: readonly CheckId[], prior: Checks, now: number, staleMs: number): CheckId[] => {
  if (named.length) return CHECK_IDS.filter(id => named.includes(id))
  const from = AUTO.findIndex(id => !passed(prior, id, now, staleMs))
  return from < 0 ? [...AUTO] : AUTO.slice(from)
}

/** Runs the planned checks in order through the adapter: the first failure stops the run; a check whose C1 has not
 * passed (now or before) is skipped as `needs C1`. */
export const runChecks = async (x: CheckCtx, plan: readonly CheckId[], staleMs: number): Promise<RunReport> => {
  const checks: Checks = { ...x.prior }
  const ran: CheckId[] = []
  let failed: CheckId | null = null
  let os = x.os
  let ram: Ram | undefined
  for (const id of plan) {
    const at = await x.now()
    ran.push(id)
    const set = (o: One) => (checks[id] = { status: o.status, value: o.value, checkedAt: at, ...(o.ms !== undefined ? { ms: o.ms } : {}) })
    if (failed) {
      set({ status: 'skip', value: `not run: ${failed} failed` })
      continue
    }
    if (!BUILT.includes(id)) {
      set({ status: 'skip', value: NOT_YET })
      continue
    }
    if (id !== 'C1' && (!os || !passed(checks, 'C1', at, staleMs))) {
      set({ status: 'skip', value: 'needs C1' })
      continue
    }
    const o = id === 'C1' ? await c1(x) : await RUN[id as keyof typeof RUN](x, os!.os)
    if (o.os) os = o.os
    if (o.ram) ram = o.ram
    set(o)
    if (o.status === 'fail') failed = id
  }
  return { checks, ran, failed, ...(os ? { os } : {}), ...(ram ? { ram } : {}) }
}

/** Scenario 7: a manual host's pasted lines fill C1, C4 and C10; C2 and C5 need a link (skip). `pastedAt` is when the
 * pasted file was saved (its clock reading is compared with it). */
export const pastedChecks = (p: Pasted, now: number, pastedAt: number): RunReport => {
  const r = (status: CheckResult['status'], value: string): CheckResult => ({ status, value, checkedAt: now })
  const ram = p.ramKb ? { totalGb: gb(p.ramKb.total), freeGb: p.ramKb.free === null ? null : gb(p.ramKb.free) } : null
  const skew = p.epochMs === null ? null : skewOne(p.epochMs - pastedAt)
  const checks: Checks = {
    C1: p.os ? r('pass', `${p.os} (pasted: ${p.osText})`) : r('fail', 'no a5r-os line in the pasted file'),
    C2: r('skip', 'manual: no link to test'),
    C4: skew ? { ...r(skew.status, `${skew.value}, against the pasted file's time`), ms: skew.ms } : r('skip', 'no a5r-epoch line in the pasted file'),
    C5: r('skip', 'manual: no link to test'),
    C10: ram ? r('pass', `total ${ram.totalGb} GB, free ${ram.freeGb ?? 'unknown'} GB (pasted)`) : r('fail', 'no a5r-ram line in the pasted file'),
  }
  const failed = (['C1', 'C4', 'C10'] as const).find(id => checks[id]?.status === 'fail') ?? null
  return { checks, ran: [...L1_CHECKS], failed, ...(p.os ? { os: { os: p.os, shell: p.os === 'windows' ? ('cmd' as const) : ('sh' as const) } } : {}), ...(ram ? { ram } : {}) }
}

/** One check as a line: `C2 fail · <value> → <fix>` (the fix only with a failure). */
export const checkLine = (id: CheckId, c: CheckResult | undefined): string => (c ? `${id} ${c.status}${c.value ? ` · ${c.value}` : ''}${c.status === 'fail' ? ` → ${FIX[id]}` : ''}` : `${id} not run`)
