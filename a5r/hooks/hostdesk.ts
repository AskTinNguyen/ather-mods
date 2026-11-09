// a5r-hosts S-b, S-c (L1): the hosts on closures (no `$`: register.ts hands it this session's facts once and the engine
// per call, as handoffhost.ts does). One action table serves the host tool and `/a5r host …` (handoff goes on to the
// hand-off desk); D16's guard around every adapter op; the minute tick's cards (an A5R host's own, the hosts' copies);
// suggest and its hint; status.json's `hosts`; the Hosts tile's rows.
import { CUTOFF_MS, DIR, isOpenPhase, noticeText, unrealPids, type Phase, type Notice, type Probe, type SessionFile, type SyncFile } from './coord.ts'
import { manualAdapter, manualPacket, parsePaste } from './adapters/manual.ts'
import { commandAdapter } from './adapters/command.ts'
import { herdrAdapter } from './adapters/herdr.ts'
import { sshAdapter } from './adapters/ssh.ts'
import { LINK_CODES, OP_NAMES, errOf, type Adapter, type OpResult, type Proc } from './adapters/types.ts'
import { HANDOFF_GATE, fieldsOf, needsOf, parseHandoffCommand, words, type Handoff } from './handoff.ts'
import { HOST_TOOL, handoffDesk, type DeskIo, type DeskState } from './handoffhost.ts'
import { handoffLink, packetText, type LinkHost, type LinkIo } from './handofflink.ts'
import { jobsDesk, type JobIo } from './jobdesk.ts'
import { INBOX_DIR, JOBS_DIR, JOB_GATE, JOB_USAGE, jobCounts } from './jobs.ts'
import { hostsBox, type HostRow } from './hostbox.ts'
import { a5rCard, editorRunning, isStale, lanesOf, parseCard, probeCard, sameCard, type HostCard, type LocalTruth } from './hostcard.ts'
import { BUILT, checkLine, pastedChecks, planOf, ramOf, runChecks, type RunReport } from './hostchecks.ts'
import { HOSTS_FILE, HOSTS_OPTIONS, HOST_USAGE, PERSON_ONLY_OPTIONS, checkedSumOf, idProblem, reachOf, reachText, readHosts, sumOf, writeHosts, type AsHost, type Declared, type HostDecl, type HostEntry, type HostOptionText } from './hosts.ts'
import { CHECK_IDS, UNTIL_RESUMED, cardPath, hostPhase, levelOf, linkNow, linkPath, linkText, parseLink, parseState, statePath, stormed, type CheckId, type HostState, type LinkLine } from './hoststate.ts'
import type { FileIo } from './hostio.ts'
import { isObj } from './shape.ts'
import { askFields, fitsText, suggest, type Picked, type SuggestHost, type SuggestLocal, type SuggestRequest } from './suggest.ts'
import { liveWaitMin } from './truth.ts'
import type { StatusHost } from './syncplan.ts'

export { HOST_TOOL }
/** register.ts's checkout finder (D19); re-exported so register.ts keeps one import line (it may not grow). */
export { coordinationFor } from './hosts.ts'
export type { ClaimTouch, DeskIo } from './handoffhost.ts'
/** A call's io for hosts: the hand-off io, the local process runner (with stdin), the plugin's host options, a debug log. */
export type HostIo = DeskIo & LinkIo & Pick<JobIo, 'start'> & { proc: Proc; hostOpts: HostOptionText; log: (note: string) => void; sleep: (ms: number) => Promise<void> }
/** This session's facts: the hand-off desk's, the home folder, whether this session writes the shared files now, and
 * this machine's local truth (S-c: its card as a host, and suggest's local side). */
export type HostDeskState = DeskState & { home: () => string; isWriter: (now: number) => boolean; local: (now: number) => LocalTruth; alive: (id8: string, now: number) => boolean }
/** An A5R host's own card, beside its Saved/A5R files (prompt.md section 2). */
export const CARD_FILE = 'card.json'
/** register.ts's facts as the desk's local truth: the shared probe (free RAM and disk, an Unreal Editor running), the
 * lock's holder and the live queue (A16: the coordination root's), the gates, and an open sync with its phase. */
export const localTruthOf = (x: { isWindows: boolean; probe: Probe | null; holder: LocalTruth['holder']; queue: number; gates: LocalTruth['gates']; sync: SyncFile | null; phase: Phase }): LocalTruth => ({
  os: x.isWindows ? 'windows' : 'posix',
  freeGb: x.probe?.freeGb ?? null,
  diskGb: x.probe?.diskGb ?? null,
  running: x.probe ? unrealPids(x.probe).length > 0 : 'unknown',
  holder: x.holder && { id8: x.holder.id8, lane: x.holder.lane, end: x.holder.end },
  queue: x.queue,
  gates: { pieGb: x.gates.pieGb, nopieGb: x.gates.nopieGb },
  sync: x.sync && isOpenPhase(x.phase) ? { at: x.sync.at, hardEnd: x.sync.hardEnd, isFrozen: x.phase !== 'planned' } : null,
})
export const HOST_GATE = 'host'
type El = Parameters<typeof hostsBox>[0]

/** One call's input, from the tool or the command, typed once at the boundary. `byPerson`: the person's own command
 * (only it may choose the local ssh client). */
export type HostInput = { action: string; id: string; reach?: string; label?: string; owner?: string; options: Record<string, unknown>; assumed?: unknown; asHost?: unknown; checks: CheckId[]; paste?: string; reason: string; byPerson: boolean; ask: SuggestRequest }
const checkIds = (xs: readonly unknown[]): CheckId[] => xs.map(x => String(x).toUpperCase()).filter((x): x is CheckId => (CHECK_IDS as readonly string[]).includes(x))
const textOf = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const numOf = (v: unknown): number | undefined => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v))
const yes = (v: unknown): boolean => v === true || v === 'true'
/** suggest's inputs (the tool's fields, or the command's flags as text); the fields an Editor request shares, as it reads them. */
const askOf = (e: Record<string, unknown>): SuggestRequest => {
  const waitedMin = numOf(e.waitedMin)
  return { minutes: numOf(e.minutes) ?? 30, pie: yes(e.pie), build: yes(e.build), ...askFields(e), ...(waitedMin !== undefined ? { waitedMin } : {}) }
}
export const inputOf = (e: Record<string, unknown>, byPerson: boolean): HostInput => ({
  action: textOf(e.action) ?? 'list',
  id: (textOf(e.id) ?? '').trim(),
  ...(textOf(e.reach) !== undefined ? { reach: textOf(e.reach) } : {}),
  ...(textOf(e.label) !== undefined ? { label: textOf(e.label) } : {}),
  ...(textOf(e.owner) !== undefined ? { owner: textOf(e.owner) } : {}),
  options: isObj(e.options) ? e.options : {},
  ...(e.assumed !== undefined ? { assumed: e.assumed } : {}),
  ...(e.asHost !== undefined ? { asHost: e.asHost } : {}),
  checks: Array.isArray(e.checks) ? checkIds(e.checks) : [],
  ...(textOf(e.paste) !== undefined ? { paste: textOf(e.paste) } : {}),
  reason: textOf(e.reason) ?? '',
  byPerson,
  ask: askOf(e),
})
/** `/a5r host <action> <id> [words] [--flag value]` as the same input (quotes keep spaces). */
export const commandInput = (args: string): HostInput => {
  const toks = [...args.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(m => m[1] ?? m[2] ?? m[3] ?? '')
  const pos: string[] = []
  const f: Record<string, string> = {}
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i] ?? ''
    if (t.startsWith('--')) f[t.slice(2).toLowerCase()] = toks[i + 1] !== undefined && !toks[i + 1]?.startsWith('--') ? (toks[++i] ?? '') : 'true'
    else pos.push(t)
  }
  const [action = 'list', id = '', ...rest] = pos
  const ops = (() => {
    try {
      return f.ops ? (JSON.parse(f.ops) as unknown) : undefined
    } catch {
      return f.ops // not JSON: the declaration's check names it
    }
  })()
  const options = { ssh: f.ssh, config: f.config, hc: f.hc, ops, deliverTo: f['deliver-to'], a5rRoot: f['a5r-root'], laneRoot: f['lane-root'] }
  return inputOf({ action, id, reach: f.reach, label: f.label, owner: f.owner, options: Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)), checks: rest, paste: f.paste, reason: rest.join(' '), minutes: f.minutes, pie: f.pie, build: f.build, readOnly: f.readonly, needGb: f['need-gb'], wants: f.wants, waitedMin: f.waited }, true)
}

/** One host as last read: its declaration, state, link lines, card and adapter (D16's guard around it). */
type Seen = { entry: HostEntry; state: HostState; link: LinkLine[]; card: HostCard | null; adapter: Adapter }

export const hostsDesk = (h: HostDeskState) => {
  const handoffs = handoffDesk(h)
  const jobs = jobsDesk({ coord: () => coord(), coordRoot: () => coordRoot(), me8: h.me8 })
  const link = handoffLink({ dir: h.dir, coord: () => coord(), me8: h.me8 }, handoffs)
  let declared: Declared | null = null
  let seen: Seen[] = []
  let probing = false
  let originId: string | null = null // this machine's origin id as last read (suggest's NO_TRUST)
  let tickAt = 0 // the last minute's time, for status.json (written by the freeze steps after the tick)
  let states = new Map<string, string>() // S-d: each open L2 hand-off's effective state, as the last minute read it
  const filePath = () => `${h.home().replace(/[\\/]+$/, '')}/${HOSTS_FILE}`
  /** D19: the coordination root's Saved/A5R (asHost.coordinationRoot, else this checkout's). */
  const coordRoot = () => (declared?.asHost?.coordinationRoot ?? h.root()).replace(/[\\/]+$/, '')
  const coord = () => (declared?.asHost?.coordinationRoot ? `${coordRoot()}/${DIR}` : h.dir())
  const opts = () => declared?.options ?? HOSTS_OPTIONS
  const staleMs = () => opts().staleCheckDays * 24 * 60 * 60_000
  const phaseOf = (s: Seen, now: number) => hostPhase(s.entry.id, s.state, s.link, now, s.adapter.link)
  /** The level, the one rule for state.json and every reader: the checks, against the declaration they ran on. */
  const levelFor = (st: HostState, decl: HostDecl | null, now: number): 0 | 1 | 2 => (decl ? levelOf(st.checks, { now, staleMs: staleMs(), fresh: st.declSum === checkedSumOf(decl) }) : 0)
  const writeState = async (io: HostIo, s: Omit<Seen, 'adapter'>, st: HostState) => {
    s.state = st
    await io.write(statePath(coord(), s.entry.id), JSON.stringify(st))
  }

  /** D16 around an adapter: a paused or storming host answers every op with its refusal; a link failure (and the first
   * success after one) is added to link.jsonl (read again just before: the engine has no append); past the cap the
   * storm is kept in state.json and holds until a resume. */
  const guarded = (io: HostIo, s: Omit<Seen, 'adapter'>, a: Adapter): Adapter => {
    const wrap =
      <A extends unknown[], T>(op: string, f?: (...xs: A) => Promise<OpResult<T>>) =>
      f &&
      (async (...xs: A): Promise<OpResult<T>> => {
        const phase = hostPhase(s.entry.id, s.state, s.link, await io.now(), a.link)
        if (phase.kind !== 'ok') return errOf(phase.kind === 'storm' ? 'LINK_STORM' : 'PAUSED', phase.text)
        const r = await f(...xs)
        const failed = !r.ok && LINK_CODES.has(r.error.code)
        if (!failed && s.link[s.link.length - 1]?.ok !== false) return r
        const now = await io.now()
        const path = linkPath(coord(), s.entry.id)
        const line: LinkLine = { at: now, ok: !failed, op, ...(!r.ok && failed ? { code: r.error.code } : {}) }
        s.link = parseLink(await io.read(path))
        await io.write(path, linkText(s.link, line))
        s.link = [...s.link, line].slice(-200)
        const storm = failed ? linkNow(s.link, now, s.state.link.windowStart, a.link).storm : null
        if (storm) await writeState(io, s, stormed(s.state, storm))
        return r
      })
    const out: Adapter = { ...a }
    for (const op of OP_NAMES) Object.assign(out, { [op]: wrap(op, a[op] as ((...xs: unknown[]) => Promise<OpResult<unknown>>) | undefined) })
    return out
  }
  const rawAdapter = (io: HostIo, entry: HostEntry, st: HostState): Adapter => {
    const r = entry.decl?.reach
    if (r?.kind === 'ssh') return sshAdapter(r.target, r.options ?? {}, io.proc, st.os)
    if (r?.kind === 'herdr') return herdrAdapter(r.target, r.options ?? {}, io.proc, st.os)
    if (r?.kind === 'command') return commandAdapter(r.target, r.options ?? {}, io.proc)
    return manualAdapter()
  }

  const readAll = async (io: HostIo): Promise<Seen[]> => {
    declared = readHosts(io.hostOpts, await io.read(filePath()))
    seen = await Promise.all(
      declared.hosts.map(async entry => {
        const state = parseState(await io.read(statePath(coord(), entry.id)))
        const base = { entry, state, link: parseLink(await io.read(linkPath(coord(), entry.id))), card: parseCard(await io.read(cardPath(coord(), entry.id))) }
        return Object.assign(base, { adapter: guarded(io, base, rawAdapter(io, entry, state)) })
      }),
    )
    return seen
  }
  const find = async (io: HostIo, id: string): Promise<Seen | null> => (await readAll(io)).find(s => s.entry.id === id) ?? null
  const missing = (id: string) => noticeText(HOST_GATE, `no host ${id || '(no id)'} is declared here`, 'list them (/a5r host list), or add one: /a5r host add <id> --reach ssh:<target>')
  const invalid = (s: Seen) => noticeText(HOST_GATE, `host ${s.entry.id} is not valid: ${s.entry.problems.join('; ')}`, `fix it with /a5r host add ${s.entry.id} … (it rewrites the declaration), or in pluginConfigs."a5r".hosts`)

  /** Saves a run's checks with the declaration they ran against; the level is derived by levelFor. */
  const save = async (io: HostIo, s: Seen, rep: RunReport): Promise<HostState> => {
    const now = await io.now()
    const next: HostState = { ...s.state, checks: rep.checks, ...(s.entry.decl ? { declSum: checkedSumOf(s.entry.decl) } : {}), ...(rep.os ? { os: rep.os } : {}) }
    next.level = levelFor(next, s.entry.decl, now)
    await writeState(io, s, next)
    if (rep.ram && s.entry.decl) {
      s.card = probeCard(s.entry.id, s.entry.decl, now, { os: rep.os?.os ?? null, totalRamGb: rep.ram.totalGb, freeRamGb: rep.ram.freeGb, running: s.card?.editor.running ?? 'unknown' })
      await io.write(cardPath(coord(), s.entry.id), JSON.stringify(s.card))
    }
    return next
  }
  const report = (s: Seen, rep: RunReport, head: string): string =>
    [head, ...rep.ran.map(id => checkLine(id, rep.checks[id])), ...(rep.failed ? [`Next: fix ${rep.failed} (above), then /a5r host check ${s.entry.id}: it resumes at ${rep.failed}.`] : [])].join('\n')

  /** `check`: the named checks, or a resume at the first one not passed (A13); a manual host takes a pasted file. */
  const check = async (io: HostIo, x: HostInput): Promise<string> => {
    const s = await find(io, x.id)
    if (!s) return missing(x.id)
    if (!s.entry.decl) return invalid(s)
    const now = await io.now()
    const phase = phaseOf(s, now)
    if (phase.kind !== 'ok') return phase.text
    if (x.paste !== undefined) {
      const text = await io.read(x.paste)
      if (text === null) return noticeText(HOST_GATE, `${x.paste} could not be read`, 'save the lines the host printed to a file here and name it')
      const rep = pastedChecks(parsePaste(text), now, (await io.stat(x.paste))?.mtimeMs ?? now)
      return report(s, rep, `A5R · host ${s.entry.id}: pasted lines read; level L${(await save(io, s, rep)).level}.`)
    }
    if (s.entry.decl.reach.kind === 'manual') return `A5R · host ${s.entry.id} is manual: nothing runs from here.\n${manualPacket(s.entry.id, s.entry.decl.label)}`
    const a5rRoot = s.entry.decl.reach.options?.a5rRoot
    const l2 = { hostId: s.entry.id, ...(a5rRoot ? { a5rRoot } : {}), originId: await handoffs.originId(io), card: s.card, sleep: io.sleep }
    const rep = await runChecks({ adapter: s.adapter, local: io.proc, now: io.now, prior: s.state.checks, ...(s.state.os ? { os: s.state.os } : {}), reverse: s.entry.decl.reach.options?.reverse === true, l2 }, planOf(x.checks, s.state.checks, now, staleMs()), staleMs())
    const st = await save(io, s, rep)
    const after = phaseOf(s, await io.now())
    return [report(s, rep, `A5R · host ${s.entry.id}: ${rep.ran.length} check${rep.ran.length === 1 ? '' : 's'} run; level L${st.level}.`), ...(after.kind === 'storm' ? [after.text] : [])].join('\n')
  }

  const writeDecl = async (io: HostIo, id: string, decl: unknown): Promise<string | null> => {
    const w = writeHosts(await io.read(filePath()), { id, decl })
    if ('problems' in w) return noticeText(HOST_GATE, w.problems.join('; '), HOST_USAGE)
    await io.write(filePath(), w.text)
    return null
  }

  /** `add`: writes the declaration (its other fields kept), then runs the checks; a second add resumes them (A13). */
  const add = async (io: HostIo, x: HostInput): Promise<string> => {
    const badId = idProblem(x.id)
    if (badId) return noticeText(HOST_GATE, badId, HOST_USAGE)
    if (!x.byPerson && PERSON_ONLY_OPTIONS.some(k => x.options[k] !== undefined)) return noticeText(HOST_GATE, "the local ssh client and its config are the person's choice", `/a5r host add ${x.id} --reach ssh:<target> --ssh <client> --config <ssh config>`)
    const prev = (await readAll(io)).find(s => s.entry.id === x.id)?.entry.decl ?? null
    const reach = x.reach !== undefined ? reachOf(x.reach) : prev?.reach ?? null
    if (!reach) return noticeText(HOST_GATE, `"${x.reach ?? ''}" is not a reach`, 'give --reach ssh:<target> (an ssh host or alias) or --reach manual')
    const options = { ...(reach.options ?? {}), ...x.options }
    const decl = { ...prev, label: x.label || prev?.label || x.id, owner: x.owner ?? prev?.owner ?? '', reach: { kind: reach.kind, target: reach.target, ...(Object.keys(options).length ? { options } : {}) } }
    const same = prev !== null && sumOf(prev) === sumOf(decl)
    if (!same) {
      const bad = await writeDecl(io, x.id, decl)
      if (bad) return bad
    }
    const said = await check(io, { ...x, checks: [] })
    return same ? said : said.replace(/^A5R · host (\S+): /, `A5R · host $1 ${prev ? 'changed' : 'added'} (${reachText(decl.reach)}): `)
  }

  /** `set`: label, owner or assumed (no check needed); reach or options (re-checked, through add); or asHost. */
  const set = async (io: HostIo, x: HostInput): Promise<string> => {
    if (x.asHost !== undefined) {
      const w = writeHosts(await io.read(filePath()), { asHost: x.asHost })
      if ('problems' in w) return noticeText(HOST_GATE, w.problems.join('; '), 'give asHost as section 1 of the design describes it (enabled, roles, availability, trust, coordinationRoot)')
      await io.write(filePath(), w.text)
      return 'A5R · asHost written (this machine when it serves others).'
    }
    const s = await find(io, x.id)
    if (!s?.entry.decl) return s ? invalid(s) : missing(x.id)
    if (x.reach !== undefined || Object.keys(x.options).length) return add(io, x)
    const next = { ...s.entry.decl, ...(x.label !== undefined ? { label: x.label } : {}), ...(x.owner !== undefined ? { owner: x.owner } : {}), ...(x.assumed !== undefined ? { assumed: x.assumed } : {}) }
    return (await writeDecl(io, s.entry.id, next)) ?? `A5R · host ${s.entry.id} changed (no check needed).`
  }

  const pause = async (io: HostIo, x: HostInput): Promise<string> => {
    const s = await find(io, x.id)
    if (!s) return missing(x.id)
    await writeState(io, s, { ...s.state, pausedUntil: UNTIL_RESUMED, pauseReason: x.reason })
    return `A5R · host ${s.entry.id} paused${x.reason ? ` (${x.reason})` : ''}: no check or probe uses it until /a5r host resume ${s.entry.id}.`
  }
  const resume = async (io: HostIo, x: HostInput): Promise<string> => {
    const s = await find(io, x.id)
    if (!s) return missing(x.id)
    const { pausedUntil: _p, pauseReason: _r, ...rest } = s.state
    await writeState(io, s, { ...rest, link: { failures: 0, windowStart: await io.now() } })
    return `A5R · host ${s.entry.id} resumed: the link count starts again; run /a5r host check ${s.entry.id} to see it work.`
  }
  const remove = async (io: HostIo, x: HostInput): Promise<string> => {
    const s = await find(io, x.id)
    if (!s) return missing(x.id)
    if (s.entry.from === 'option') return noticeText(HOST_GATE, `host ${x.id} is declared in pluginConfigs."a5r".hosts (by hand)`, 'remove it there; a5r writes only its own file')
    return (await writeDecl(io, s.entry.id, null)) ?? `A5R · host ${s.entry.id} removed (its state and card stay in ${coord()}/hosts/${s.entry.id}/ until deleted by hand).`
  }

  const flags = (s: Seen, now: number): string[] => {
    const phase = phaseOf(s, now).kind
    return [
      ...(s.entry.byHand ? ['edited-by-hand'] : []),
      ...(s.entry.decl && s.state.declSum !== undefined && s.state.declSum !== checkedSumOf(s.entry.decl) ? [`declaration changed since the checks: /a5r host check ${s.entry.id}`] : []),
      ...(phase === 'storm' ? ['link-storm'] : phase === 'paused' ? ['paused'] : []),
    ]
  }
  const hostLine = (s: Seen, now: number): string => {
    const at = Math.max(0, ...CHECK_IDS.map(id => s.state.checks[id]?.checkedAt ?? 0))
    return [s.entry.id, s.entry.decl?.label ?? 'invalid', `L${levelFor(s.state, s.entry.decl, now)}`, s.entry.decl ? reachText(s.entry.decl.reach) : s.entry.problems.join('; '), at ? `checked ${Math.round((now - at) / 60_000)}m ago` : 'never checked', ...flags(s, now)].join(' · ')
  }
  /** One availability rule for status.json and the tile: the host's own A5R card first, else the declared assumption. */
  const availabilityOf = (s: Seen): StatusHost['availability'] => {
    const c = s.card
    if (c?.source === 'a5r' && c.availability.state !== 'unknown') return { state: c.availability.state, ...(c.availability.reason ? { reason: c.availability.reason } : {}) }
    const a = s.entry.decl?.assumed?.availability
    return a ? { state: a.state, ...(a.reason ? { reason: a.reason } : {}), assumed: true } : { state: 'unknown' }
  }

  const list = async (io: HostIo): Promise<string> => {
    const xs = await readAll(io)
    const now = await io.now()
    return xs.length ? ['Hosts declared here:', ...xs.map(s => `- ${hostLine(s, now)}`)].join('\n') : `No hosts declared here (L0). Add one: ${HOST_USAGE.split(' · ')[2]}`
  }
  /** D1: this machine's level and what the next level needs. */
  const status = async (io: HostIo): Promise<string> => {
    const xs = await readAll(io)
    const now = await io.now()
    const level = Math.max(0, ...xs.map(s => levelFor(s.state, s.entry.decl, now)))
    const next =
      level > 0
        ? 'L2 needs an adapter that can write the host inbox (ssh, herdr or command with reach.options.a5rRoot) and C3, C7, C8, C9, C12 passing: /a5r host check <id>.'
        : xs.some(s => s.entry.decl?.reach.kind === 'ssh')
          ? 'L1 needs a host whose C1 and C2 pass: run /a5r host check <id> and fix the first failure it names.'
          : 'L1 needs a declared host with a probe-capable adapter whose C1 and C2 pass: /a5r host add <id> --reach ssh:<target>.'
    const as = declared?.asHost
    const asLine = as ? `asHost: ${as.enabled ? 'enabled' : 'off'}; roles ${as.roles.join(', ') || 'none'}; availability ${as.availability.state}${declared?.asHostByHand ? ' · edited-by-hand' : ''}` : declared?.asHostProblems.length ? `asHost: not valid: ${declared.asHostProblems.join('; ')}` : 'asHost: not declared (this machine serves no one)'
    return [
      `This machine: L${level}. Origin id ${(await handoffs.origin(io)) ?? 'not made yet (made at the first hand-off)'}; coordination root ${coord()}.`,
      `Next: ${next}`,
      ...xs.flatMap(s => [`- ${hostLine(s, now)}`, ...BUILT.filter(id => s.state.checks[id]).map(id => `  ${checkLine(id, s.state.checks[id])}`)]),
      asLine,
      `Declarations: ${filePath()} (written by a5r) and pluginConfigs."a5r".hosts (by hand).`,
    ].join('\n')
  }

  /** S-c: a host's own A5R card through the adapter (its `a5rRoot`), with the skew C4 measured; null when absent, not an
   * A5R card, or stale. */
  const hostsOwnCard = async (s: Seen, now: number): Promise<HostCard | null> => {
    const root = s.entry.decl?.reach.options?.a5rRoot
    if (!root || !s.adapter.readFile) return null
    const r = await s.adapter.readFile(`${root.replace(/[\\/]+$/, '')}/${DIR}/${CARD_FILE}`)
    const got = r.ok ? parseCard(r.value) : null
    const card: HostCard | null = got?.source === 'a5r' ? { ...got, hostId: s.entry.id, skew: { ms: s.state.checks.C4?.ms ?? null } } : null
    return card && !isStale(card, now, opts().staleCardMin) ? card : null
  }
  /** The tick's cards (one writer: the status writer), in the background: a dead host never holds the tick. Each minute a
   * host's own A5R card is read when it names its root; else, and when that is absent or stale, a probe card replaces a
   * stale copy. */
  const probeCards = async (io: HostIo, xs: readonly Seen[], now: number): Promise<void> => {
    for (const s of xs) {
      const a = s.adapter
      // A hand-written entry that names the local ssh client or config is never run unasked: `/a5r host add <id>` first.
      if (s.entry.byHand && PERSON_ONLY_OPTIONS.some(k => s.entry.decl?.reach.options?.[k] !== undefined)) continue
      if (!s.entry.decl || phaseOf(s, now).kind !== 'ok') continue
      if (linkNow(s.link, now, s.state.link.windowStart, a.link).retryAt > now) continue // D16: back off after a failure
      const own = await hostsOwnCard(s, now)
      if (own) {
        if (s.card?.at !== own.at || !sameCard(s.card, own)) await io.write(cardPath(coord(), s.entry.id), JSON.stringify(own))
        s.card = own
        continue
      }
      if (!a.probe || !a.run || !isStale(s.card, now, opts().staleCardMin)) continue
      const p = await a.probe()
      const os = p.ok ? p.value.os : null
      const ram = os ? await ramOf(a, os) : null
      const card = probeCard(s.entry.id, s.entry.decl, now, { os, totalRamGb: ram?.totalGb ?? null, freeRamGb: ram?.freeGb ?? null, running: os ? await editorRunning(a, os) : 'unknown' })
      await io.write(cardPath(coord(), s.entry.id), JSON.stringify(card))
      s.card = card
    }
  }

  /** S-c: this machine's own card as an A5R host (asHost.enabled), by the status writer: written on a change, or past half
   * of staleCardMin with none (a heartbeat, so a quiet host's card stays fresh for its origins). */
  const publish = async (io: HostIo, as: AsHost, now: number): Promise<void> => {
    const path = `${coord()}/${CARD_FILE}`
    const prev = parseCard(await io.read(path))
    const listed = as.laneRoot ? await io.run(['git', '-C', coordRoot(), 'worktree', 'list', '--porcelain'], 30_000) : null
    const lanes = !as.laneRoot ? [] : listed?.exitCode === 0 ? lanesOf(listed.stdout, as.laneRoot) : (prev?.lanes ?? []) // unread (a sync's merge): as before
    const card = a5rCard(now, as, h.local(now), lanes, jobCounts(await jobs.read(io)))
    if (prev && sameCard(prev, card) && now - prev.at < opts().staleCardMin * 30_000) return
    await io.write(path, JSON.stringify(card))
  }

  /** suggest's view now, read once per answer: this machine's facts (local truth) and the declared hosts (levels from the
   * checks; a paused or storming link holds a host, D16). */
  const viewNow = (now: number) => {
    const t = h.local(now)
    const local: SuggestLocal = { now, freeGb: t.freeGb, gates: t.gates, freeze: t.sync && { from: t.sync.at - CUTOFF_MS, to: t.sync.hardEnd }, originId }
    const hosts = seen.flatMap((s): SuggestHost[] => (s.entry.decl ? [{ id: s.entry.id, label: s.entry.decl.label, level: levelFor(s.state, s.entry.decl, now), card: s.card, isHeld: phaseOf(s, now).kind !== 'ok' }] : []))
    return { holder: t.holder, local, hosts }
  }
  type View = ReturnType<typeof viewNow>
  /** The declared hosts as the hand-off link sees them. */
  const linkHosts = (): LinkHost[] =>
    seen.flatMap(s => {
      const d = s.entry.decl
      if (!d) return []
      const a5rRoot = d.reach.options?.a5rRoot
      return [{ id: s.entry.id, label: d.label, manual: d.reach.kind === 'manual', ...(a5rRoot ? { a5rRoot } : {}), ...(d.repo?.path ?? a5rRoot ? { lockRoot: d.repo?.path ?? a5rRoot } : {}), adapter: s.adapter, card: s.card }]
    })
  /** This machine as a host now (decision 1's facts): its asHost, own freeze, lanes (its card's) and session liveness. */
  const hostNow = async (io: HostIo, as: AsHost, now: number) => {
    const card = parseCard(await io.read(`${coord()}/${CARD_FILE}`))
    return { asHost: as, now, frozen: Boolean(h.local(now).sync?.isFrozen), lanes: card?.lanes ?? [], alive: (id8: string) => h.alive(id8, now) }
  }
  const lists = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',').map(x => x.trim()) : []).filter(Boolean)
  /** A hand-off to a declared host (L2): the plain record's checks (fields, D7), then the host's own (decision 7). */
  const toHost = async (io: HostIo, x: LinkHost, e: Record<string, unknown>): Promise<string> => {
    const prepared = await handoffs.prepare(io, fieldsOf({ ...e, label: x.label }))
    if (typeof prepared === 'string') return prepared
    const ho: Handoff = { ...prepared, host: x.id, wants: lists(e.wants), needs: needsOf(e.needs), proof: typeof e.proof === 'string' ? e.proof : '' }
    return link.create(io, ho, x)
  }
  /** The hand-off actions an L2 hand-off adds, each answered whole: create with an explicit `host` (a declared one),
   * packet, merged, and a manual hand-off's result. null: the plain desk answers (an L0 record, its result, the rest). */
  const l2 = async (io: HostIo, op: string, id: string, e: Record<string, unknown>): Promise<string | null> => {
    if (op === 'create') {
      if (typeof e.host !== 'string' || !e.host) return null
      await readAll(io)
      const x = linkHosts().find(s => s.id === e.host)
      return x ? toHost(io, x, e) : missing(e.host)
    }
    if (op !== 'packet' && op !== 'merged' && op !== 'result') return null
    const ho = await handoffs.find(io, id)
    if (!ho?.via) return null
    if (op === 'merged') return link.merged(io, ho)
    if (op === 'result' && ho.via === 'manual' && !String(e.ref ?? '').trim()) return noticeText(HANDOFF_GATE, 'a result names where the work landed', `/a5r handoff result ${ho.id} <PR url | #N | branch | report path>`)
    if (op === 'result') return ho.via === 'manual' ? link.pasteResult(io, ho, String(e.ref).trim()) : null
    if (ho.via !== 'manual') return noticeText(HANDOFF_GATE, `hand-off ${ho.id} was delivered through its adapter`, 'a packet is for a manual host')
    await readAll(io)
    return packetText(ho, linkHosts().find(s => s.id === ho.host)?.label ?? ho.host)
  }
  /** `/a5r handoff …` with an L2 hand-off's actions first: `record host=<id>` is the tool's create to that host; the
   * command's needs are typed here (its words are text). */
  const handoffCommand = async (io: HostIo, args: string): Promise<string> => {
    const c = parseHandoffCommand(args)
    const { keys } = words(args)
    const flag = (k: string) => keys[k] === 'true'
    const needs = { ...(numOf(keys.ramgb) !== undefined ? { ramGb: numOf(keys.ramgb) } : {}), ...(numOf(keys.minutes) !== undefined ? { minutes: numOf(keys.minutes) } : {}), pie: flag('pie'), build: flag('build'), readOnly: flag('readonly') }
    const e: Record<string, unknown> = c?.op === 'record' ? { ...c.fields, op: 'create', host: keys.host, wants: keys.wants, needs, proof: keys.proof } : c?.op === 'result' ? { ref: c.ref } : {}
    const said = c ? await l2(io, c.op === 'record' ? 'create' : c.op, 'id' in c ? c.id : '', e) : null
    return said ?? handoffs.command(io, args)
  }
  /** The job tool and `/a5r job …` (host side). */
  const jobAct = async (io: HostIo, e: { op: string; id: string; text: string; ref: string; code: string }): Promise<string> => {
    await readAll(io)
    const as = declared?.asHost
    if (!as?.enabled) return noticeText(JOB_GATE, 'this machine serves no one (asHost is not enabled)', 'jobs live on a host: /a5r host set --asHost …')
    return jobs.act(io, await hostNow(io, as, await io.now()), e)
  }
  const jobInput = (args: string) => {
    const { pos } = words(args)
    const [op = 'list', id = '', ...rest] = pos
    return { op, id, text: rest.join(' '), ref: rest[0] ?? '', code: rest[0] ?? '', ...(op === 'fail' || op === 'return' ? { text: rest.slice(1).join(' ') } : {}) }
  }
  /** The hint is on (the option) and has a host to name: checked before suggest's view is read. */
  const isSuggesting = (): boolean => opts().suggest && seen.some(s => s.entry.decl)
  /** READONLY_WAIT's "the Editor is held by another session" (than `id8`). */
  const heldByOther = (v: View, id8: string): boolean => v.holder !== null && v.holder.id8 !== id8
  /** D17: a session's waiting Editor request as suggest's input (its live wait, A125), and the pick; none for a session
   * that holds the Editor (one rule for the reply, status and the row). */
  const pickFor = (v: View, f: SessionFile | null | undefined, now: number): Picked | null => {
    const w = f?.want
    if (!f || !w || f.holding) return null
    const { suggestion } = suggest({ minutes: w.minutes, pie: w.pie, build: w.build, needGb: w.needGb, readOnly: w.readOnly, wants: w.wants, waitedMin: liveWaitMin(w, now), editorHeldByOther: heldByOther(v, f.id8) }, v.local, v.hosts, opts())
    return suggestion === 'none' ? null : suggestion
  }

  const ACTIONS: Record<string, (io: HostIo, x: HostInput) => Promise<string>> = {
    list: io => list(io),
    status: io => status(io),
    add,
    set,
    check,
    pause,
    resume,
    remove,
    suggest: async (io, x) => {
      await readAll(io)
      originId = await handoffs.origin(io)
      const v = viewNow(await io.now())
      return JSON.stringify(suggest({ ...x.ask, editorHeldByOther: heldByOther(v, h.me8()) }, v.local, v.hosts, opts()), null, 1)
    },
  }
  const act = (io: HostIo, x: HostInput): Promise<string> => (ACTIONS[x.action] ?? (async () => noticeText(HOST_GATE, `"${x.action}" is not a host action`, `use ${Object.keys(ACTIONS).join(', ')} or handoff (${HOST_USAGE})`)))(io, x)

  return {
    handoffs,
    /** The minute: the hand-offs and the hosts read for the pane and status.json; stale probe cards refreshed. */
    tick: async (io: HostIo, now: number): Promise<Notice[]> => {
      tickAt = now
      await handoffs.read(io)
      const xs = await readAll(io)
      originId = await handoffs.origin(io)
      const as = declared?.asHost
      if (as?.enabled && h.isWriter(now)) {
        await jobs.tick(io, await hostNow(io, as, now)).catch(err => io.log(`a5r: host jobs: ${String(err)}`))
        await publish(io, as, now).catch(err => io.log(`a5r: host card: ${String(err)}`))
      }
      const followed = await link.follow(io, linkHosts(), now, h.isWriter(now)).catch(err => (io.log(`a5r: hand-offs: ${String(err)}`), { notices: [] as Notice[], states }))
      const notices = followed.notices
      states = followed.states
      if (probing || !xs.length || !h.isWriter(now)) return notices
      probing = true
      void probeCards(io, xs, now)
        .catch(err => io.log(`a5r: host probe cards: ${String(err)}`)) // tried again on a later minute
        .finally(() => (probing = false))
      return notices
    },
    /** `/a5r host …` and `/a5r handoff …` (the words after /a5r). */
    command: (io: HostIo, args: string): Promise<string> =>
      /^handoff\b/i.test(args) ? handoffCommand(io, args.slice(7)) : /^job\b/i.test(args) ? jobAct(io, jobInput(args.slice(3))) : act(io, commandInput(args.replace(/^host\b/i, ''))),
    /** D17: the Editor request's and status's line when this session's waiting request fits a host better ('' without). */
    hint: (f: SessionFile | null, now: number): string => {
      const p = isSuggesting() ? pickFor(viewNow(now), f, now) : null
      return p ? `${fitsText(p)} → /a5r handoff record label="${p.label}" branch=<branch> task="<one line>" to run it there, or hand it off later` : ''
    },
    /** D17: the Editor list's queued rows with `fits <label> (<reasons>)` added when suggest has one for them. */
    hinted: (waits: ReadonlyMap<string, string>, files: readonly SessionFile[], now: number): ReadonlyMap<string, string> => {
      if (!isSuggesting()) return waits
      const v = viewNow(now)
      const out = new Map(waits)
      for (const f of files) {
        const p = pickFor(v, f, now)
        if (p) out.set(f.id8, [waits.get(f.id8), fitsText(p)].filter(Boolean).join(' · '))
      }
      return out
    },
    /** The model tool `host`. */
    tool: async (io: HostIo, e: Record<string, unknown>): Promise<string> => {
      if (e.action === 'job') return jobAct(io, { op: String(e.op ?? 'list'), id: String(e.id ?? ''), text: String(e.text ?? ''), ref: String(e.ref ?? ''), code: String(e.code ?? '') })
      if (e.action !== 'handoff') return act(io, inputOf(e, false))
      return (await l2(io, String(e.op ?? 'list'), String(e.id ?? ''), e)) ?? handoffs.tool(io, e)
    },
    /** D9 and D20 at the edit: the hosts' state files are a5r's (one writer); then the hand-offs' claims. The edit check
     * sees the shared checkout's paths, so a coordination root outside it is guarded only by its own a5r. */
    touch: async (io: FileIo, rels: readonly string[]) => {
      const root = h.root().replace(/[\\/]+$/, '')
      const hostsRel = `${coord().startsWith(`${root}/`) ? coord().slice(root.length + 1) : DIR}/hosts/`.toLowerCase()
      if (rels.some(r => r.toLowerCase().startsWith(hostsRel))) return { deny: noticeText(HOST_GATE, `${DIR}/hosts is written by a5r alone (one writer)`, 'use /a5r host or the host tool'), shared: [] }
      const jobRels = [INBOX_DIR, JOBS_DIR].map(d => `${hostsRel.slice(0, -'hosts/'.length)}${d}/`)
      if (rels.some(r => jobRels.some(j => r.toLowerCase().startsWith(j)))) return { deny: noticeText(JOB_GATE, `${DIR}/${INBOX_DIR} and ${DIR}/${JOBS_DIR} are written by a5r alone (the origin's delivery, this host's answer)`, JOB_USAGE), shared: [] }
      return handoffs.touch(io, rels)
    },
    /** status.json's `hosts` (D17): only while one is declared; a card is copied without its lanes' branches (F6). */
    status: (): StatusHost[] | undefined => {
      const xs = seen.filter(s => s.entry.decl)
      if (!xs.length) return undefined
      return xs.map(s => ({ id: s.entry.id, label: s.entry.decl?.label ?? s.entry.id, level: levelFor(s.state, s.entry.decl, tickAt), availability: availabilityOf(s), ...(s.card ? { card: { ...s.card, lanes: s.card.lanes.map(({ branch: _b, ...l }) => l) } } : {}) }))
    },
    /** D17 / A12: the Hosts tile, only with a host declared or a hand-off open. */
    boxes: (el: El, now: number, look: { ink: string; quiet: string }): unknown[] => {
      const xs = seen.filter(s => s.entry.decl || s.entry.problems.length)
      const open = handoffs.open()
      if (!xs.length && !open.length) return []
      const staleMin = opts().staleCardMin
      const rows = xs.map((s): HostRow => {
        const c = s.card
        const level = levelFor(s.state, s.entry.decl, now)
        const avail = availabilityOf(s)
        const storm = phaseOf(s, now).kind === 'storm'
        const editor = c?.editor.running === true ? 'running' : c?.editor.running === false ? 'idle' : 'unknown'
        const parts = [s.entry.decl?.label ?? `${s.entry.id} (invalid)`, `L${level}`, c?.machine.freeRamGb != null ? `${c.machine.freeRamGb} GB free` : 'RAM unknown', `Editor ${editor}`, ...(c && isStale(c, now, staleMin) ? ['stale'] : []), ...(avail.state === 'no' ? [avail.reason || 'unavailable'] : []), ...(storm ? ['link-storm'] : [])]
        return { id: s.entry.id, text: parts.join(' · '), dot: storm || !s.entry.decl ? 'bad' : level >= 1 ? 'ok' : 'warn' }
      })
      return [hostsBox(el, rows, open, now, look, states, jobs.waiting())]
    },
  }
}
