import { expect, test } from 'claude-code/testing'
import { DEFAULT_LINK, errOf, okOf, type Adapter, type RunOut } from '../hooks/adapters/types.ts'
import { blankSession } from '../hooks/coord.ts'
import { ALL_BYTES, FIX, STDOUT_SEQ, checkLine, helperCount, pastedChecks, planOf, runChecks, type CheckCtx } from '../hooks/hostchecks.ts'
import { hostsDesk, type HostIo } from '../hooks/hostdesk.ts'
import { HOST_USAGE } from '../hooks/hosts.ts'
import type { CheckId, Checks } from '../hooks/hoststate.ts'
import { A5RPANE, ME, NOW, PROJ, find, keys, opts, refused, still, text, world, type Rec } from './world.ts'

// a5r-hosts S-b (L1) through a mocked adapter and through the engine: the checks C1, C2, C4, C5, C10 (pass, fail with
// the fix line verbatim, the dependency skips; A3), add and its resume (A13), the storm cap at the tool (A4), the
// option/state split with two checkouts on one coordination root (A17), the Hosts tile and status.json (A12).
const MIN = 60_000
const DAY = 24 * 60 * MIN
const STALE = 7 * DAY

/** A mocked remote: each argv (joined) is answered by the first matching rule; the rest exit 0 with no output. */
const mocked = (os: 'windows' | 'posix', rules: [RegExp, (stdin?: string) => RunOut | 'link'][], probe: () => 'ok' | 'link' = () => 'ok'): Adapter & { runs: string[] } => {
  const runs: string[] = []
  return {
    kind: 'mock',
    link: DEFAULT_LINK,
    helpers: () => /^sshd(-session)?(\.exe)?$/i,
    runs,
    probe: async () => (probe() === 'ok' ? okOf({ os, shell: os === 'windows' ? 'cmd' : 'sh' }) : errOf('LINK', 'ssh f20 failed: Permission denied (publickey)')),
    run: async (argv, init) => {
      runs.push(argv.join(' '))
      const hit = rules.find(([rx]) => rx.test(argv.join(' ')))
      const r = hit ? hit[1](init?.stdin) : { exitCode: 0, stdout: '', stderr: '' }
      return r === 'link' ? errOf('LINK', 'ssh f20 failed: Connection reset') : okOf(r)
    },
  }
}
const out = (stdout: string, exitCode = 0): RunOut => ({ exitCode, stdout, stderr: '' })
const HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4'
const local = async () => out(`${HASH}\n`)
const GOOD: [RegExp, (stdin?: string) => RunOut][] = [
  [/^sort$/, s => out(s === 'b\r\na\r\nc\r\n' || s === 'b\na\nc\n' ? 'a\r\nb\r\nc\r\n' : '???\r\n')],
  [/hash-object/, s => out(s === ALL_BYTES ? `${HASH}\r\n` : 'other\r\n')],
  [/^echo A5R-BYTES/, () => out(`${STDOUT_SEQ}\r\n`)],
  [/ToUnixTimeMilliseconds/, () => out(`${NOW + 1_500}\r\n`)],
  [/^date/, () => out(`${Math.round(NOW / 1000)}\n`)],
  [/^tasklist/, () => out('"sshd.exe","1","Services","0","9,000 K"\r\n"sshd-session.exe","2","Services","0","9,000 K"\r\n"cmd.exe","3","Console","1","4,000 K"\r\n')],
  [/^ps/, () => out('bash\nsshd-session\nsshd\n')],
  [/Win32_OperatingSystem/, () => out('66270000 31000000\r\n')],
  [/meminfo/, () => out('MemTotal:       32768000 kB\nMemFree:  100 kB\nMemAvailable:   16384000 kB\n')],
]
const ctx = (a: Adapter, prior: Checks = {}, extra: Partial<CheckCtx> = {}): CheckCtx => ({ adapter: a, local, now: async () => NOW, prior, ...extra })
const ALL: CheckId[] = ['C1', 'C2', 'C4', 'C5', 'C10']

test('S-b (A3): engine: C1, C2, C4, C5, C10 pass on a clean Windows host and on a POSIX one; the values are what was read', async () => {
  const win = await runChecks(ctx(mocked('windows', GOOD)), ALL, STALE)
  expect(ALL.map(id => checkLine(id, win.checks[id]))).toEqual([
    'C1 pass · windows (cmd), 0 ms',
    'C2 pass · sort a b c; 256 bytes in, same hash; stdout as sent',
    'C4 pass · skew +1.5 s (limit 120 s)',
    'C5 pass · helpers 2, 2, 2 over 3 probe cycles',
    'C10 pass · total 63.2 GB, free 29.6 GB',
  ])
  expect([win.failed, win.os, win.ram]).toEqual([null, { os: 'windows', shell: 'cmd' }, { totalGb: 63.2, freeGb: 29.6 }])
  const nix = await runChecks(ctx(mocked('posix', GOOD)), ALL, STALE)
  expect(ALL.map(id => nix.checks[id]?.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass'])
  expect([nix.checks.C4?.value, nix.checks.C10?.value]).toEqual(['skew +0.0 s (limit 120 s)', 'total 31.3 GB, free 15.6 GB'])
  // The commands are written for the OS C1 read.
  const a = mocked('posix', GOOD)
  await runChecks(ctx(a), ALL, STALE)
  expect(a.runs.filter(r => !/^(sort|git|echo)/.test(r))).toEqual(['date +%s', 'ps -x -o comm=', 'ps -x -o comm=', 'ps -x -o comm=', 'cat /proc/meminfo'])
  expect(helperCount('"sshd.exe","1"\r\n"sshd-session.exe","2"\r\n"other.exe","3"\r\n', 'windows', /^sshd(-session)?(\.exe)?$/i)).toBe(2)
})

test('S-b (A3): engine: C2 fails on the "b a c" -> "???" stdin case with its fix text verbatim, and the run stops there (later checks skip)', async () => {
  const pwsh = mocked('windows', [[/^sort$/, () => out('???\r\n')], ...GOOD])
  const rep = await runChecks(ctx(pwsh), ALL, STALE)
  expect(ALL.map(id => checkLine(id, rep.checks[id]))).toEqual([
    'C1 pass · windows (cmd), 0 ms',
    `C2 fail · sort returned "???" for "b a c": the lines did not arrive as sent (possibly a default shell that is not the plain command shell, e.g. PowerShell) → ${FIX.C2}`,
    'C4 skip · not run: C2 failed',
    'C5 skip · not run: C2 failed',
    'C10 skip · not run: C2 failed',
  ])
  expect(rep.failed).toBe('C2')
  expect(FIX.C2).toBe("the link changes bytes; a possible cause is the host's SSH default shell (S2, e.g. a PowerShell default shell): set the server's default shell to the plain command shell, retest; never use that link for adapters until pass")
  // F-b4: sort gets CRLF on a Windows remote (its sort.exe reads LF-only input as UTF-16) and LF on POSIX.
  for (const os of ['windows', 'posix'] as const) {
    const sent: (string | undefined)[] = []
    await runChecks(ctx(mocked(os, [[/^sort$/, stdin => (sent.push(stdin), out('a\nb\nc\n'))], ...GOOD])), ['C1', 'C2'], STALE)
    expect([os, sent]).toEqual([os, [os === 'windows' ? 'b\r\na\r\nc\r\n' : 'b\na\nc\n']])
  }
  // The other two parts of C2: bytes in (hash), bytes out (stdout).
  const hashed = await runChecks(ctx(mocked('windows', [[/hash-object/, () => out('0000000000000000\r\n')], ...GOOD])), ['C1', 'C2'], STALE)
  expect(hashed.checks.C2?.value).toBe('the 256 values 0-255 hashed 000000000000 on the host, e3b0c44298fc here: stdin bytes changed on the way (possibly a default shell that is not the plain command shell, e.g. PowerShell)')
  const echoed = await runChecks(ctx(mocked('windows', [[/^echo A5R-BYTES/, () => out('"A5R-BYTES"\r\n')], ...GOOD])), ['C1', 'C2'], STALE)
  expect(echoed.checks.C2?.status).toBe('fail')
  expect(echoed.checks.C2?.value).toMatch(/^stdout changed on the way:/)
})

test('S-b (A3): engine: C1 fails with its fix line; C4 fails past 120 s; C5 fails on a rising count; C10 fails unread', async () => {
  const down = await runChecks(ctx(mocked('windows', GOOD, () => 'link')), ALL, STALE)
  expect(checkLine('C1', down.checks.C1)).toBe(`C1 fail · origin to host: ssh f20 failed: Permission denied (publickey) → ${FIX.C1}`)
  expect(FIX.C1).toBe('name which direction failed; look for policy blocks on the failing side (S1: a group allow list on the SSH server); ask the host owner/IT; polling stays available')
  expect(ALL.slice(1).map(id => down.checks[id]?.value)).toEqual(['not run: C1 failed', 'not run: C1 failed', 'not run: C1 failed', 'not run: C1 failed'])
  const skewed = await runChecks(ctx(mocked('windows', [[/ToUnixTimeMilliseconds/, () => out(`${NOW - 200_000}`)], ...GOOD])), ['C1', 'C4'], STALE)
  expect(checkLine('C4', skewed.checks.C4)).toBe('C4 fail · skew -200.0 s (limit 120 s) → sync time on the host; windows and heartbeats rely on it')
  let n = 1
  const leaking = await runChecks(ctx(mocked('windows', [[/^tasklist/, () => out(Array.from({ length: (n += 1) }, () => '"sshd-session.exe","9"').join('\r\n'))], ...GOOD])), ['C1', 'C5'], STALE)
  expect(checkLine('C5', leaking.checks.C5)).toBe('C5 fail · helpers 2, 3, 4 over 3 probe cycles: rising (a leak) → S2: kill leaked pairs (may need elevation: report to the host owner); do not declare until stable')
  const blind = await runChecks(ctx(mocked('windows', [[/Win32_OperatingSystem/, () => out('Access denied')], ...GOOD])), ['C1', 'C10'], STALE)
  expect(checkLine('C10', blind.checks.C10)).toBe('C10 fail · total RAM could not be read → record measured value; adjust maxEditors')
})

test('S-b (A3, A13): engine: dependency skips, checks not in this version, and the resume plan', async () => {
  const at = NOW - MIN
  // C4 alone with C1 never passed: skipped as needing C1; C3 answers not in this version.
  const alone = await runChecks(ctx(mocked('windows', GOOD)), ['C3', 'C4'], STALE)
  expect([checkLine('C3', alone.checks.C3), checkLine('C4', alone.checks.C4)]).toEqual(['C3 skip · not in this version', 'C4 skip · needs C1'])
  // A passed C1 on file (os known) lets C4 run alone.
  const prior: Checks = { C1: { status: 'pass', checkedAt: at }, C2: { status: 'fail', value: 'x', checkedAt: at } }
  expect((await runChecks(ctx(mocked('windows', GOOD), prior, { os: { os: 'windows', shell: 'cmd' } }), ['C4'], STALE)).checks.C4?.status).toBe('pass')
  expect(planOf([], prior, NOW, STALE)).toEqual(['C2', 'C4', 'C5', 'C10'])
  expect(planOf([], {}, NOW, STALE)).toEqual(ALL)
  expect(planOf([], Object.fromEntries(ALL.map(id => [id, { status: 'pass', checkedAt: at }])), NOW, STALE)).toEqual(ALL) // all passed: a fresh full run
  expect(planOf([], { ...prior, C2: { status: 'pass', checkedAt: NOW - 8 * DAY } }, NOW, STALE)).toEqual(['C2', 'C4', 'C5', 'C10']) // stale counts as not passed
  expect(planOf(['C10', 'C1'], prior, NOW, STALE)).toEqual(['C1', 'C10'])
  // Scenario 7 (manual): pasted lines fill C1, C4, C10; C2 and C5 need a link.
  const pasted = pastedChecks({ os: 'windows', osText: 'Windows_NT', epochMs: NOW - 30_000, ramKb: { total: 66270000, free: 31000000 } }, NOW, NOW)
  expect(ALL.map(id => checkLine(id, pasted.checks[id]))).toEqual(['C1 pass · windows (pasted: Windows_NT)', 'C2 skip · manual: no link to test', "C4 pass · skew -30.0 s (limit 120 s), against the pasted file's time", 'C5 skip · manual: no link to test', 'C10 pass · total 63.2 GB, free 29.6 GB (pasted)'])
})

// Through a desk with in-memory files: two checkouts that share one coordination root (A17), and the storm cap (A4).
const memIo = (files: Map<string, string>, clock: { now: number }, proc: HostIo['proc'], hostOpts: HostIo['hostOpts'] = {}): HostIo => ({
  now: async () => clock.now,
  read: async p => files.get(p) ?? null,
  write: async (p, t) => void files.set(p, t),
  stat: async p => (files.has(p) ? { mtimeMs: clock.now } : null),
  list: async () => [],
  run: async () => null,
  secrets: async () => [],
  proc,
  hostOpts,
  log: () => undefined,
})
/** An ssh client to a clean Windows host, by the remote line; `down` makes every call a link failure (255). */
const winRemote = (state: { down: boolean; sort?: string }) => async (argv: readonly string[], init: { stdin?: string }): Promise<RunOut | null> => {
  const line = argv[argv.length - 1] ?? ''
  if (argv[0] === 'git') return out(`${HASH}\n`)
  if (state.down) return { exitCode: 255, stdout: '', stderr: 'ssh: connect to host f20 port 22: Connection refused' }
  if (line === 'echo a5r %OS%') return out('a5r Windows_NT\r\n')
  const hit = [[/^sort$/, () => out(state.sort ?? 'a\r\nb\r\nc\r\n')] as const, ...GOOD].find(([rx]) => rx.test(line))
  return hit ? hit[1](init.stdin) : out('')
}
const AS_HOST = { enabled: false, roles: [], trust: [], availability: { state: 'yes' }, coordinationRoot: 'E:/s2' }

test('S-b (A17): engine: two checkouts of one machine share one state and one link record under the coordination root; options hold declarations only', async () => {
  const files = new Map<string, string>()
  const clock = { now: NOW }
  const remote = { down: false }
  const io = memIo(files, clock, winRemote(remote))
  const desk = (dir: string) => hostsDesk({ dir: () => dir, root: () => dir.replace('/Saved/A5R', ''), me8: () => ME.slice(0, 8), lane: () => 'lane', home: () => 'C:/Users/u', isWriter: () => true })
  const a = desk('E:/s2/Saved/A5R')
  const b = desk('E:/s2-wt/Saved/A5R')
  expect(await a.tool(io, { action: 'set', asHost: AS_HOST })).toBe('A5R · asHost written (this machine when it serves others).')
  expect(await a.command(io, 'host add f20 --reach ssh:f20 --label "second pc" --owner hai')).toContain('A5R · host f20 added (ssh:f20): 5 checks run; level L1.')
  // The second checkout reads the same state (its own Saved/A5R holds none).
  expect(await b.command(io, 'host list')).toMatch(/^Hosts declared here:\n- f20 · second pc · L1 · ssh:f20 · checked 0m ago$/)
  expect([...files.keys()].filter(p => p.includes('/hosts/')).sort()).toEqual(['E:/s2/Saved/A5R/hosts/f20/card.json', 'E:/s2/Saved/A5R/hosts/f20/state.json'])
  // Options hold declarations only; state holds checks, level and link counts.
  const decl = JSON.parse(files.get('C:/Users/u/.claude/a5r/hosts.json') ?? '{}') as Rec
  expect(Object.keys((decl.hosts as Rec).f20 as Rec)).toEqual(['label', 'owner', 'reach'])
  expect(Object.keys(JSON.parse(files.get('E:/s2/Saved/A5R/hosts/f20/state.json') ?? '{}') as Rec)).toEqual(['v', 'checks', 'level', 'link', 'declSum', 'os'])
  // A link failure from the second checkout lands in the shared link record.
  remote.down = true
  clock.now += MIN
  await b.command(io, 'host check f20 C1')
  expect(files.get('E:/s2/Saved/A5R/hosts/f20/link.jsonl')?.trim().split('\n').length).toBe(1)
  expect(await a.command(io, 'host list')).toContain('f20 · second pc · L0 · ssh:f20')
})

test('S-b (A4, D16): engine: 12 link failures in 10 min pause the host with the refusal verbatim; resume lets it run again', async () => {
  const files = new Map<string, string>()
  const clock = { now: NOW }
  const remote = { down: false }
  const io = memIo(files, clock, winRemote(remote))
  const d = hostsDesk({ dir: () => 'E:/s2/Saved/A5R', root: () => 'E:/s2', me8: () => 'ab12cd34', lane: () => 'lane', home: () => 'C:/Users/u', isWriter: () => true })
  await d.command(io, 'host add f20 --reach ssh:f20')
  remote.down = true
  const said: string[] = []
  for (let i = 0; i < 12; i++) {
    clock.now += 30_000
    said.push(await d.tool(io, { action: 'check', id: 'f20', checks: ['C1'] }))
  }
  expect(said[0]).toContain('C1 fail · origin to host: ssh f20 failed: ssh: connect to host f20 port 22: Connection refused')
  expect(said[10]).not.toContain('link failed')
  expect(said[11]?.split('\n').slice(-1)[0]).toBe('A5R · host f20 — link failed 12 times in 10 min → fix the link (C2), then /a5r host resume f20')
  clock.now += 30_000
  expect(await d.tool(io, { action: 'check', id: 'f20' })).toBe('A5R · host f20 — link failed 12 times in 10 min → fix the link (C2), then /a5r host resume f20')
  expect(await d.command(io, 'host list')).toContain('link-storm')
  // D16: the storm holds after its failures age out of the window, until a resume.
  clock.now += 2 * 60 * MIN
  expect(await d.tool(io, { action: 'check', id: 'f20' })).toBe('A5R · host f20 — link failed 12 times in 10 min → fix the link (C2), then /a5r host resume f20')
  remote.down = false
  expect(await d.command(io, 'host resume f20')).toBe('A5R · host f20 resumed: the link count starts again; run /a5r host check f20 to see it work.')
  clock.now += 1_000
  expect(await d.command(io, 'host check f20')).toContain('level L1.')
  expect(await d.command(io, 'host pause f20 night build')).toBe('A5R · host f20 paused (night build): no check or probe uses it until /a5r host resume f20.')
  expect(await d.command(io, 'host check f20')).toBe('A5R · host f20 — paused (night build) → /a5r host resume f20 when it should be used again')
})

test('S-b review: add keeps the declaration\'s other fields; only the person chooses the ssh client; one availability rule; the originId option is the origin', async () => {
  const files = new Map<string, string>()
  const clock = { now: NOW }
  const io = memIo(files, clock, winRemote({ down: false }))
  io.originId = 'team-pc1' // the plugin option, as register.ts hands it
  const d = hostsDesk({ dir: () => 'E:/s2/Saved/A5R', root: () => 'E:/s2', me8: () => 'ab12cd34', lane: () => 'lane', home: () => 'C:/Users/u', isWriter: () => true })
  await d.command(io, 'host add f20 --reach ssh:f20 --label "second pc"')
  expect(await d.tool(io, { action: 'set', id: 'f20', assumed: { availability: { state: 'no', reason: 'nights only' } } })).toBe('A5R · host f20 changed (no check needed).')
  await d.tool(io, { action: 'add', id: 'f20', reach: 'ssh:f20.lan' })
  const decl = (JSON.parse(files.get('C:/Users/u/.claude/a5r/hosts.json') ?? '{}') as { hosts: Record<string, Rec> }).hosts.f20
  expect(decl).toEqual({ label: 'second pc', owner: '', reach: { kind: 'ssh', target: 'f20.lan' }, assumed: { availability: { state: 'no', reason: 'nights only' } } })
  // The model's tool cannot pick the local program that runs; a declaration names only an ssh client.
  const personOnly = "A5R · host — the local ssh client and its config are the person's choice → /a5r host add pc3 --reach ssh:<target> --ssh <client> --config <ssh config>"
  expect(await d.tool(io, { action: 'add', id: 'pc3', reach: 'ssh:pc3', options: { ssh: 'C:/Windows/System32/cmd.exe' } })).toBe(personOnly)
  expect(await d.tool(io, { action: 'add', id: 'pc3', reach: 'ssh:pc3', options: { config: 'E:/proj/evil_config' } })).toBe(personOnly)
  expect(await d.tool(io, { action: 'add', id: 'pc3', reach: 'ssh:-oProxyCommand=calc' })).toContain('hosts.pc3.reach.target must be a host name, an ssh alias or user@host')
  // A second add with only a new label applies it (and resumes the checks).
  expect(await d.command(io, 'host add f20 --label "the rig"')).toMatch(/^A5R · host f20 changed \(ssh:f20\.lan\): /)
  expect(await d.command(io, 'host add pc3 --reach ssh:pc3 --ssh C:/tools/evil.exe')).toContain('hosts.pc3.reach.options.ssh must be an ssh client (ssh or ssh.exe)')
  expect(await d.tool(io, { action: 'add', id: 'pc3', reach: 'ssh:pc3', options: { args: ['-o', 'ProxyCommand=x'] } })).toContain('hosts.pc3.reach.options.args is not an option (ssh, config, laneRoot, a5rRoot, reverse)')
  // status.json and the tile read one availability rule (the assumption here, marked assumed).
  await d.tick(io, clock.now)
  expect(d.status()?.[0]?.availability).toEqual({ state: 'no', reason: 'nights only', assumed: true })
  const el = { Box: (p: Rec) => ({ type: 'Box', props: p, children: (p.children as unknown[]) ?? [] }), Text: (p: Rec) => ({ type: 'Text', props: p, children: [p.children] }) }
  expect(text(d.boxes(el, clock.now, { ink: '#fff', quiet: '#888' })[0])).toBe('HOSTS · 1●the rig · L1 · 29.6 GB free · Editor unknown · nights only')
  expect(await d.command(io, 'host status')).toMatch(/^This machine: L1\. Origin id team-pc1;/)
  expect(await d.command(io, 'host frobnicate')).toBe(`A5R · host — "frobnicate" is not a host action → use list, status, add, set, check, pause, resume, remove, suggest or handoff (${HOST_USAGE})`)
})

// Through the plugin engine (world.ts): ssh calls are answered by their remote line, as the git needles answer git.
const HF = 'E:/s2/Saved/A5R'
const HOSTS_JSON = 'C:/Users/hai.huynh/.claude/a5r/hosts.json'
const ME8 = ME.slice(0, 8)
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const cmd = async ($: any, args: string) => String((await $.command.run({ command: 'a5r', args } as never)).text)
const sshAnswers = (sort: string) => ({
  'f20 echo a5r %OS%': { stdout: 'a5r Windows_NT\r\n' },
  'f20 sort': { stdout: sort },
  'hash-object': { stdout: `${HASH}\n` },
  'f20 echo A5R-BYTES': { stdout: `${STDOUT_SEQ}\r\n` },
  ToUnixTimeMilliseconds: { stdout: `${NOW}\r\n` },
  'USERNAME eq': { stdout: '"sshd-session.exe","4"\r\n' },
  'IMAGENAME eq UnrealEditor.exe': { stdout: 'INFO: No tasks are running which match the specified criteria.\r\n' },
  Win32_OperatingSystem: { stdout: '66270000 31000000\r\n' },
})
const asWriter = (w: ReturnType<typeof world>) =>
  w.put(`${HF}/editor/${ME8}.json`, JSON.stringify({ ...blankSession(ME, 'lane-me', '', NOW), heartbeatAt: NOW + 600 * MIN, want: { what: 'PIE retest', minutes: 30, pie: true, build: false, launch: true, mode: 'interactive', pausable: true, nextSafe: '', requestedAt: NOW - 10 * MIN, since: NOW - 10 * MIN } }))

test('S-b (A13): engine: /a5r host add runs C1, C2, C4, C5, C10 in order, stops at the first failure with its fix line; a second add resumes at it', opts(), async ($, on) => {
  const answers: Record<string, { stdout: string }> = sshAnswers('???\r\n')
  const w = world(on, { git: answers })
  await $.session.start(START)
  const first = await cmd($, 'host add f20 --reach ssh:f20 --label "second pc" --ssh C:/Windows/System32/OpenSSH/ssh.exe --config C:/Users/hai.huynh/.ssh/config')
  expect(first.split('\n')).toEqual([
    'A5R · host f20 added (ssh:f20): 5 checks run; level L0.',
    'C1 pass · windows (cmd), 0 ms',
    `C2 fail · sort returned "???" for "b a c": the lines did not arrive as sent (possibly a default shell that is not the plain command shell, e.g. PowerShell) → ${FIX.C2}`,
    'C4 skip · not run: C2 failed',
    'C5 skip · not run: C2 failed',
    'C10 skip · not run: C2 failed',
    'Next: fix C2 (above), then /a5r host check f20: it resumes at C2.',
  ].map((l, i) => (i === 1 ? first.split('\n')[1] ?? l : l)))
  expect(first.split('\n')[1]).toMatch(/^C1 pass · windows \(cmd\), \d+ ms$/)
  expect(w.runs.find(r => r.endsWith('f20 sort'))).toBe('C:/Windows/System32/OpenSSH/ssh.exe -F C:/Users/hai.huynh/.ssh/config -o BatchMode=yes -o ConnectTimeout=10 -- f20 sort')
  expect(JSON.parse(w.read(HOSTS_JSON)).hosts.f20).toEqual({ label: 'second pc', owner: '', reach: { kind: 'ssh', target: 'f20', options: { ssh: 'C:/Windows/System32/OpenSSH/ssh.exe', config: 'C:/Users/hai.huynh/.ssh/config' } } })
  expect(JSON.parse(w.read(`${HF}/hosts/f20/state.json`))).toMatchObject({ v: 1, level: 0, checks: { C1: { status: 'pass' }, C2: { status: 'fail' }, C4: { status: 'skip' } } })
  // The default shell is fixed on the host; the second add resumes at C2 (C1 is not run again).
  answers['f20 sort'] = { stdout: 'a\r\nb\r\nc\r\n' }
  const second = await cmd($, 'host add f20')
  expect(second.split('\n')).toEqual(['A5R · host f20: 4 checks run; level L1.', 'C2 pass · sort a b c; 256 bytes in, same hash; stdout as sent', 'C4 pass · skew +0.0 s (limit 120 s)', 'C5 pass · helpers 1, 1, 1 over 3 probe cycles', 'C10 pass · total 63.2 GB, free 29.6 GB'])
  expect(await cmd($, 'host status')).toMatch(/^This machine: L1\. .*\nNext: L2 needs an adapter that can run or deliver jobs and C3, C7, C8, C9, C12 passing: not in this version \(slice S-d\)\.\n- f20 · second pc · L1 · ssh:f20 · checked 0m ago\n  C1 pass/)
  // The host tool answers the same; a hand edit of the state files is refused (A17: written by the tool only).
  expect(String((await $.tool.call({ tool: 'mcp__a5r__host', action: 'list' } as never)).result)).toBe('Hosts declared here:\n- f20 · second pc · L1 · ssh:f20 · checked 0m ago')
  w.put('E:/s2/.git/HEAD', 'ref: refs/heads/HaiHuynh/20261005')
  expect(refused(await $.tool.call({ tool: 'Write', file_path: `${HF}/hosts/f20/state.json`, content: '{"v":1,"level":2}' } as never))).toBe('A5R · host — Saved/A5R/hosts is written by a5r alone (one writer) → use /a5r host or the host tool')
})

test('S-b (A2): engine: a hand edit (of the hosts file, or an entry in the plugin option) is read, flagged edited-by-hand and must be re-checked', { ...opts(), options: { ...opts().options, hosts: JSON.stringify({ rig: { label: 'night rig', owner: 'team', reach: { kind: 'manual', target: '' } } }) } }, async ($, on) => {
  const w = world(on, { git: sshAnswers('a\r\nb\r\nc\r\n') })
  await $.session.start(START)
  await cmd($, 'host add f20 --reach ssh:f20')
  const f = JSON.parse(w.read(HOSTS_JSON))
  w.put(HOSTS_JSON, JSON.stringify({ ...f, hosts: { f20: { ...f.hosts.f20, label: 'renamed by hand' } } }))
  const status = await cmd($, 'host status')
  expect(status).toContain('- f20 · renamed by hand · L0 · ssh:f20 · checked 0m ago · edited-by-hand · declaration changed since the checks: /a5r host check f20')
  expect(status).toContain('- rig · night rig · L0 · manual · never checked · edited-by-hand')
  expect(await cmd($, 'host check f20')).toContain('level L1.')
  // The manual host: nothing runs from here; the packet says what to run and paste.
  const manual = await cmd($, 'host check rig')
  expect(manual).toContain('A5R · host rig is manual: nothing runs from here.\nHost rig (night rig) has no transport')
  w.put('E:/proj/rig.txt', 'a5r-os Windows_NT\r\na5r-epoch 1791269000000\r\na5r-ram 33000000 12000000\r\n')
  expect(await cmd($, 'host check rig --paste E:/proj/rig.txt')).toContain('A5R · host rig: pasted lines read; level L0.\nC1 pass · windows (pasted: Windows_NT)')
  expect(await cmd($, 'host remove rig')).toBe('A5R · host — host rig is declared in pluginConfigs."a5r".hosts (by hand) → remove it there; a5r writes only its own file')
})

test('S-b (A12): engine: the Hosts tile and status.json\'s hosts appear only with a host declared (or a hand-off open); terminal and desktop alike', opts(), async ($, on) => {
  const answers = sshAnswers('a\r\nb\r\nc\r\n')
  const w = world(on, { git: answers, ram: '40' })
  w.put('E:/s2/.git/HEAD', 'ref: refs/heads/HaiHuynh/20261005')
  asWriter(w)
  await $.session.start(START)
  await w.clock.advance(MIN)
  const look = async (surface: 'terminal' | 'desktop') => {
    const tree = still(await $.ui.render({ ...A5RPANE, surface } as never))
    return { tree, blocks: keys(tree), tile: find(tree, 'hai-hosts'), status: JSON.parse(w.read(`${HF}/status.json`)) as Rec }
  }
  const none = await look('terminal')
  expect([none.tile, none.blocks.includes('hai-hosts'), Object.keys(none.status).includes('hosts')]).toEqual([undefined, false, false])
  expect((await look('desktop')).tile).toBeUndefined()
  await cmd($, 'host add f20 --reach ssh:f20 --label "second pc"')
  await w.clock.advance(MIN)
  for (const surface of ['terminal', 'desktop'] as const) {
    const now = await look(surface)
    expect([surface, text(now.tile)]).toEqual([surface, 'HOSTS · 1●second pc · L1 · 29.6 GB free · Editor unknown'])
    expect(now.blocks.filter(b => b === 'hai-hosts')).toEqual(['hai-hosts'])
  }
  const status = (await look('terminal')).status
  expect(Object.keys(status)).toEqual([...Object.keys(none.status), 'hosts'])
  expect(status.v).toBe(1)
  expect(status.hosts).toMatchObject([{ id: 'f20', label: 'second pc', level: 1, availability: { state: 'unknown' }, card: { v: 1, source: 'probe', hostId: 'f20', machine: { os: 'windows', totalRamGb: 63.2, freeRamGb: 29.6, freeDiskGb: null }, editor: { running: 'unknown' } } }])
  // The probe card: past staleCardMin the minute refreshes it (the Editor read from the process list).
  await w.clock.advance(11 * MIN)
  await w.clock.advance(MIN)
  expect(text((await look('terminal')).tile)).toBe('HOSTS · 1●second pc · L1 · 29.6 GB free · Editor idle')
  // An old card shows stale; a storm shows link-storm (the probe is never retried meanwhile).
  for (const k of Object.keys(answers)) delete (answers as Record<string, unknown>)[k]
  Object.assign(answers, { 'f20 ': { stdout: '', exitCode: 255 } })
  const card = JSON.parse(w.read(`${HF}/hosts/f20/card.json`)) as Rec
  w.put(`${HF}/hosts/f20/card.json`, JSON.stringify({ ...card, at: NOW - 60 * MIN }))
  for (let i = 0; i < 12; i++) await cmd($, 'host check f20 C1')
  await w.clock.advance(MIN)
  expect(text((await look('terminal')).tile)).toBe('HOSTS · 1●second pc · L0 · 29.6 GB free · Editor idle · stale · link-storm')
})
