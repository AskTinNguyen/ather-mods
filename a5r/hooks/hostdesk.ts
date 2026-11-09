// a5r-hosts S-b (L1): the hosts on closures (no `$`: register.ts hands it this session's facts once and the engine per
// call, as handoffhost.ts does). One action table serves the host tool and `/a5r host …` (handoff goes on to the hand-off
// desk); D16's guard around every adapter op; the minute tick's probe cards; status.json's `hosts`; the Hosts tile's rows.
import { DIR, noticeText } from './coord.ts'
import { manualAdapter, manualPacket, parsePaste } from './adapters/manual.ts'
import { sshAdapter } from './adapters/ssh.ts'
import { DEFAULT_LINK, LINK_CODES, errOf, type Adapter, type OpResult, type Proc } from './adapters/types.ts'
import { HOST_TOOL, handoffDesk, type DeskIo, type DeskState } from './handoffhost.ts'
import { hostsBox, type HostRow } from './hostbox.ts'
import { editorRunning, isStale, parseCard, probeCard, type HostCard } from './hostcard.ts'
import { BUILT, checkLine, pastedChecks, planOf, ramOf, runChecks, type RunReport } from './hostchecks.ts'
import { HOSTS_FILE, HOST_USAGE, PERSON_ONLY_OPTIONS, idProblem, reachOf, reachText, readHosts, sumOf, writeHosts, type Declared, type HostDecl, type HostEntry, type HostOptionText } from './hosts.ts'
import { CHECK_IDS, UNTIL_RESUMED, cardPath, hostPhase, levelOf, linkNow, linkPath, linkText, parseLink, parseState, statePath, stormed, type CheckId, type HostState, type LinkLine } from './hoststate.ts'
import type { FileIo } from './hostio.ts'
import { isObj } from './shape.ts'
import type { StatusHost } from './syncplan.ts'

export { HOST_TOOL }
export type { ClaimTouch, DeskIo } from './handoffhost.ts'
/** A call's io for hosts: the hand-off io, the local process runner (with stdin), the plugin's host options, a debug log. */
export type HostIo = DeskIo & { proc: Proc; hostOpts: HostOptionText; log: (note: string) => void }
/** This session's facts: the hand-off desk's, the home folder and whether this session writes the shared files now. */
export type HostDeskState = DeskState & { home: () => string; isWriter: (now: number) => boolean }
export const HOST_GATE = 'host'
type El = Parameters<typeof hostsBox>[0]

/** One call's input, from the tool or the command, typed once at the boundary. `byPerson`: the person's own command
 * (only it may choose the local ssh client). */
export type HostInput = { action: string; id: string; reach?: string; label?: string; owner?: string; options: Record<string, unknown>; assumed?: unknown; asHost?: unknown; checks: CheckId[]; paste?: string; reason: string; byPerson: boolean }
const checkIds = (xs: readonly unknown[]): CheckId[] => xs.map(x => String(x).toUpperCase()).filter((x): x is CheckId => (CHECK_IDS as readonly string[]).includes(x))
const textOf = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
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
  return inputOf({ action, id, reach: f.reach, label: f.label, owner: f.owner, options: { ...(f.ssh ? { ssh: f.ssh } : {}), ...(f.config ? { config: f.config } : {}) }, checks: rest, paste: f.paste, reason: rest.join(' ') }, true)
}

/** One host as last read: its declaration, state, link lines, card and adapter (D16's guard around it). */
type Seen = { entry: HostEntry; state: HostState; link: LinkLine[]; card: HostCard | null; adapter: Adapter }

export const hostsDesk = (h: HostDeskState) => {
  const handoffs = handoffDesk(h)
  let declared: Declared | null = null
  let seen: Seen[] = []
  let probing = false
  let tickAt = 0 // the last minute's time, for status.json (written by the freeze steps after the tick)
  const filePath = () => `${h.home().replace(/[\\/]+$/, '')}/${HOSTS_FILE}`
  /** D19: the coordination root's Saved/A5R (asHost.coordinationRoot, else this checkout's). */
  const coord = () => (declared?.asHost?.coordinationRoot ? `${declared.asHost.coordinationRoot.replace(/[\\/]+$/, '')}/${DIR}` : h.dir())
  const staleMs = () => (declared?.options.staleCheckDays ?? 7) * 24 * 60 * 60_000
  const phaseOf = (s: Seen, now: number) => hostPhase(s.entry.id, s.state, s.link, now, s.adapter.link)
  /** The level, the one rule for state.json and every reader: the checks, against the declaration they ran on. */
  const levelFor = (st: HostState, decl: HostDecl | null, now: number): 0 | 1 | 2 => (decl ? levelOf(st.checks, { now, staleMs: staleMs(), fresh: st.declSum === sumOf(decl) }) : 0)
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
    return { ...a, probe: wrap('probe', a.probe), readFile: wrap('readFile', a.readFile), writeFile: wrap('writeFile', a.writeFile), run: wrap('run', a.run), envInfo: wrap('envInfo', a.envInfo) }
  }
  const rawAdapter = (io: HostIo, entry: HostEntry, st: HostState): Adapter => {
    const r = entry.decl?.reach
    if (r?.kind === 'ssh') return sshAdapter(r.target, r.options ?? {}, io.proc, st.os)
    return r && r.kind !== 'manual' ? { kind: r.kind, link: DEFAULT_LINK, helpers: () => null } : manualAdapter() // herdr, command: slice S-d
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
    const next: HostState = { ...s.state, checks: rep.checks, ...(s.entry.decl ? { declSum: sumOf(s.entry.decl) } : {}), ...(rep.os ? { os: rep.os } : {}) }
    next.level = levelFor(next, s.entry.decl, now)
    await writeState(io, s, next)
    if (rep.ram && s.entry.decl) await io.write(cardPath(coord(), s.entry.id), JSON.stringify(probeCard(s.entry.id, s.entry.decl, now, { os: rep.os?.os ?? null, totalRamGb: rep.ram.totalGb, freeRamGb: rep.ram.freeGb, running: s.card?.editor.running ?? 'unknown' })))
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
    const rep = await runChecks({ adapter: s.adapter, local: io.proc, now: io.now, prior: s.state.checks, ...(s.state.os ? { os: s.state.os } : {}), reverse: s.entry.decl.reach.options?.reverse === true }, planOf(x.checks, s.state.checks, now, staleMs()), staleMs())
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
      ...(s.entry.decl && s.state.declSum !== undefined && s.state.declSum !== sumOf(s.entry.decl) ? [`declaration changed since the checks: /a5r host check ${s.entry.id}`] : []),
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
        ? 'L2 needs an adapter that can run or deliver jobs and C3, C7, C8, C9, C12 passing: not in this version (slice S-d).'
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

  /** The tick's probe cards (one writer: the status writer), in the background: a dead host never holds the tick. */
  const probeCards = async (io: HostIo, xs: readonly Seen[], now: number): Promise<void> => {
    for (const s of xs) {
      const a = s.adapter
      // A hand-written entry that names the local ssh client or config is never run unasked: `/a5r host add <id>` first.
      if (s.entry.byHand && PERSON_ONLY_OPTIONS.some(k => s.entry.decl?.reach.options?.[k] !== undefined)) continue
      if (!s.entry.decl || !a.probe || !a.run || !isStale(s.card, now, declared?.options.staleCardMin ?? 10) || phaseOf(s, now).kind !== 'ok') continue
      if (linkNow(s.link, now, s.state.link.windowStart, a.link).retryAt > now) continue // D16: back off after a failure
      const p = await a.probe()
      const os = p.ok ? p.value.os : null
      const ram = os ? await ramOf(a, os) : null
      const card = probeCard(s.entry.id, s.entry.decl, now, { os, totalRamGb: ram?.totalGb ?? null, freeRamGb: ram?.freeGb ?? null, running: os ? await editorRunning(a, os) : 'unknown' })
      await io.write(cardPath(coord(), s.entry.id), JSON.stringify(card))
      s.card = card
    }
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
    suggest: async () => noticeText(HOST_GATE, 'not in this version', 'slice S-c adds suggest'),
  }
  const act = (io: HostIo, x: HostInput): Promise<string> => (ACTIONS[x.action] ?? (async () => noticeText(HOST_GATE, `"${x.action}" is not a host action`, `use ${Object.keys(ACTIONS).join(', ')} or handoff (${HOST_USAGE})`)))(io, x)

  return {
    handoffs,
    /** The minute: the hand-offs and the hosts read for the pane and status.json; stale probe cards refreshed. */
    tick: async (io: HostIo, now: number): Promise<void> => {
      tickAt = now
      await handoffs.read(io)
      const xs = await readAll(io)
      if (probing || !xs.length || !h.isWriter(now)) return
      probing = true
      void probeCards(io, xs, now)
        .catch(err => io.log(`a5r: host probe cards: ${String(err)}`)) // tried again on a later minute
        .finally(() => (probing = false))
    },
    /** `/a5r host …` and `/a5r handoff …` (the words after /a5r). */
    command: (io: HostIo, args: string): Promise<string> => (/^handoff\b/i.test(args) ? handoffs.command(io, args.slice(7)) : act(io, commandInput(args.replace(/^host\b/i, '')))),
    /** The model tool `host`. */
    tool: (io: HostIo, e: Record<string, unknown>): Promise<string> => (e.action === 'handoff' ? handoffs.tool(io, e) : act(io, inputOf(e, false))),
    /** D9 and D20 at the edit: the hosts' state files are a5r's (one writer); then the hand-offs' claims. The edit check
     * sees the shared checkout's paths, so a coordination root outside it is guarded only by its own a5r. */
    touch: async (io: FileIo, rels: readonly string[]) => {
      const root = h.root().replace(/[\\/]+$/, '')
      const hostsRel = `${coord().startsWith(`${root}/`) ? coord().slice(root.length + 1) : DIR}/hosts/`.toLowerCase()
      if (rels.some(r => r.toLowerCase().startsWith(hostsRel))) return { deny: noticeText(HOST_GATE, `${DIR}/hosts is written by a5r alone (one writer)`, 'use /a5r host or the host tool'), shared: [] }
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
      const staleMin = declared?.options.staleCardMin ?? 10
      const rows = xs.map((s): HostRow => {
        const c = s.card
        const level = levelFor(s.state, s.entry.decl, now)
        const avail = availabilityOf(s)
        const storm = phaseOf(s, now).kind === 'storm'
        const editor = c?.editor.running === true ? 'running' : c?.editor.running === false ? 'idle' : 'unknown'
        const parts = [s.entry.decl?.label ?? `${s.entry.id} (invalid)`, `L${level}`, c?.machine.freeRamGb != null ? `${c.machine.freeRamGb} GB free` : 'RAM unknown', `Editor ${editor}`, ...(c && isStale(c, now, staleMin) ? ['stale'] : []), ...(avail.state === 'no' ? [avail.reason || 'unavailable'] : []), ...(storm ? ['link-storm'] : [])]
        return { id: s.entry.id, text: parts.join(' · '), dot: storm || !s.entry.decl ? 'bad' : level >= 1 ? 'ok' : 'warn' }
      })
      return [hostsBox(el, rows, open, now, look)]
    },
  }
}
