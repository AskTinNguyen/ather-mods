import { expect, test } from 'claude-code/testing'
import { MANUAL_STEPS, manualAdapter, manualPacket, parsePaste } from '../hooks/adapters/manual.ts'
import { isUnder, osOf, remoteLine, shQuote, sshAdapter, winQuote } from '../hooks/adapters/ssh.ts'
import { DEFAULT_LINK, callOp, type Adapter, type Proc, type RunOut } from '../hooks/adapters/types.ts'
import { HOSTS_OPTIONS, asHostProblems, declProblems, readHosts, sumOf, writeHosts, type HostDecl } from '../hooks/hosts.ts'
import { CHECK_IDS, blankState, levelOf, linkNow, linkText, parseLink, parseState, statePath, stormText, type CheckId, type Checks } from '../hooks/hoststate.ts'
import { NOW } from './world.ts'

// a5r-hosts S-b (L1), pure parts: the declarations (A2, A17), levelOf (A2), the adapters' contract on a fake transport
// (A4: ssh and manual, NO_ADAPTER_OP, timeouts, one argument string) and the link's backoff and storm cap (D16, A4).
const MIN = 60_000
const DAY = 24 * 60 * MIN
const F20: HostDecl = { label: 'second pc', owner: 'hai', reach: { kind: 'ssh', target: 'f20' } }
const file = (hosts: Record<string, unknown>, sums: Record<string, string> = {}) => JSON.stringify({ v: 1, hosts, sums: { hosts: sums } })

test('S-b (A2): unit: declarations are validated on read; state keys are refused (D20); the file wins over the option per id', () => {
  expect(declProblems('f20', F20)).toEqual([])
  expect(declProblems('F 20', F20)).toEqual(['host id "F 20" must be 1-32 of a-z, 0-9 and -'])
  expect(declProblems('x', { label: '', owner: 1, reach: { kind: 'ftp' } })).toEqual(['hosts.x.label must be text', 'hosts.x.owner must be text', 'hosts.x.reach.kind must be one of ssh, herdr, command, manual'])
  expect(declProblems('x', { ...F20, reach: { kind: 'ssh', target: ' ' } })).toEqual(['hosts.x.reach.target must name the machine for ssh'])
  expect(declProblems('x', { ...F20, reach: { kind: 'manual', target: '' } })).toEqual([])
  // An ssh target is never something the client reads as an option (review 2).
  for (const t of ['-oProxyCommand=calc', 'a b', 'x;y'])
    expect(declProblems('x', { ...F20, reach: { kind: 'ssh', target: t } })).toEqual(['hosts.x.reach.target must be a host name, an ssh alias or user@host (no leading -, no spaces)'])
  expect(declProblems('x', { ...F20, reach: { kind: 'ssh', target: 'hai@pc2.lan' } })).toEqual([])
  expect(declProblems('x', { ...F20, checks: {}, level: 1 })).toEqual(['hosts.x.checks is state, kept in Saved/A5R/hosts/x/state.json, never in the options', 'hosts.x.level is state, kept in Saved/A5R/hosts/x/state.json, never in the options'])
  expect(declProblems('x', { ...F20, assumed: { availability: { state: 'maybe' } } })).toEqual(['hosts.x.assumed.availability.state must be "yes" or "no"'])
  expect(asHostProblems({ enabled: true, roles: ['build'], trust: ['*'], availability: { state: 'no', reason: 'nights only', windows: [{ days: ['mon'], from: '20:00', to: '07:00', tz: 'Asia/Saigon' }] } })).toEqual([])
  expect(asHostProblems({ enabled: 'yes', roles: 'build', availability: { state: 'yes', windows: [{ from: '8' }] } })).toEqual(['asHost.enabled must be true or false', 'asHost.roles must be a list of text', 'asHost.availability.windows must be [{ days, from: "HH:MM", to: "HH:MM", tz }]'])
  const opt = JSON.stringify({ f20: { ...F20, label: 'from the option' }, rig: { ...F20, label: 'rig' } })
  const d = readHosts({ hosts: opt, hostsOptions: '{"staleCardMin":3,"bogus":1,"suggest":"no"}' }, file({ f20: F20 }, { f20: sumOf(F20) }))
  expect(d.hosts.map(h => [h.id, h.decl?.label, h.from, h.byHand])).toEqual([['f20', 'second pc', 'file', false], ['rig', 'rig', 'option', true]])
  expect(d.options).toEqual({ ...HOSTS_OPTIONS, staleCardMin: 3 })
  // Not JSON, or invalid: read, named, never a throw.
  const bad = readHosts({ hosts: '{not json', asHost: '[]' }, '{"v":1,"hosts":{"x y":{}}}')
  expect(bad.hosts.map(h => [h.id, h.decl, h.problems[0]])).toEqual([['(option)', null, 'pluginConfigs."a5r".hosts is not JSON'], ['x y', null, 'host id "x y" must be 1-32 of a-z, 0-9 and -']])
  expect([bad.asHost, bad.asHostProblems]).toEqual([null, ['asHost must be an object']])
  expect(readHosts({}, null)).toEqual({ hosts: [], asHost: null, asHostProblems: [], asHostByHand: false, options: HOSTS_OPTIONS })
})

test('S-b (A2, A17): unit: writeHosts is the one writer: it validates, stores a sum per entry, and a hand edit of the file reads as edited-by-hand', () => {
  const w1 = writeHosts(null, { id: 'f20', decl: F20 })
  if (!('text' in w1)) throw new Error('refused')
  expect(readHosts({}, w1.text).hosts.map(h => [h.id, h.byHand])).toEqual([['f20', false]])
  // A hand reorders keys: still the tool's (canonical sum). A hand changes a value: edited-by-hand.
  const parsed = JSON.parse(w1.text) as { hosts: Record<string, HostDecl> }
  const reordered = JSON.stringify({ ...JSON.parse(w1.text), hosts: { f20: { reach: F20.reach, owner: 'hai', label: 'second pc' } } })
  expect(readHosts({}, reordered).hosts[0]?.byHand).toBe(false)
  const handEdited = JSON.stringify({ ...JSON.parse(w1.text), hosts: { f20: { ...parsed.hosts.f20, label: 'renamed by hand' } } })
  expect(readHosts({}, handEdited).hosts.map(h => [h.decl?.label, h.byHand])).toEqual([['renamed by hand', true]])
  // Invalid changes are refused before anything is written; state never enters the file (A17).
  expect(writeHosts(w1.text, { id: 'Bad', decl: F20 })).toEqual({ problems: ['host id "Bad" must be 1-32 of a-z, 0-9 and -'] })
  expect(writeHosts(w1.text, { id: 'f20', decl: { ...F20, level: 1 } as never })).toEqual({ problems: ['hosts.f20.level is state, kept in Saved/A5R/hosts/f20/state.json, never in the options'] })
  expect(Object.keys(JSON.parse(w1.text) as object)).toEqual(['v', 'hosts', 'sums'])
  const asWritten = writeHosts(w1.text, { asHost: { enabled: true, roles: [], trust: [], availability: { state: 'yes' }, coordinationRoot: 'E:/s2' } })
  if (!('text' in asWritten)) throw new Error('refused')
  expect(readHosts({}, asWritten.text)).toMatchObject({ asHost: { enabled: true, coordinationRoot: 'E:/s2' }, asHostByHand: false })
  expect(readHosts({ asHost: '{"enabled":true}' }, null)).toMatchObject({ asHost: { enabled: true, roles: [], trust: [] }, asHostByHand: true })
  const removed = writeHosts(asWritten.text, { id: 'f20', decl: null })
  if (!('text' in removed)) throw new Error('refused')
  expect(readHosts({}, removed.text).hosts).toEqual([])
  expect(statePath('E:/s2/Saved/A5R', 'f20')).toBe('E:/s2/Saved/A5R/hosts/f20/state.json')
})

test('S-b (A2): unit: levelOf derives the level from checks only, for every class of combination', () => {
  const at = NOW - MIN
  const all = (status: 'pass' | 'fail' | 'skip', ids: readonly CheckId[] = CHECK_IDS): Checks => Object.fromEntries(ids.map(id => [id, { status, checkedAt: at }]))
  const o = { now: NOW, staleMs: 7 * DAY }
  const rows: [string, Checks, Partial<typeof o & { windows: boolean; builds: boolean; fresh: boolean }>, number][] = [
    ['none', {}, {}, 0],
    ['C1 only', all('pass', ['C1']), {}, 0],
    ['C1 and C2', all('pass', ['C1', 'C2']), {}, 1],
    ['C2 failed', { ...all('pass', ['C1']), ...all('fail', ['C2']) }, {}, 0],
    ['C2 skipped', { ...all('pass', ['C1']), ...all('skip', ['C2']) }, {}, 0],
    ['windows without C4', all('pass', ['C1', 'C2']), { windows: true }, 0],
    ['windows with C4', all('pass', ['C1', 'C2', 'C4']), { windows: true }, 1],
    ['every check', all('pass'), {}, 2],
    ['L2 short of C12', all('pass', CHECK_IDS.filter(id => id !== 'C12')), {}, 1],
    ['builds without C11', all('pass', CHECK_IDS.filter(id => id !== 'C11')), { builds: true }, 1],
    ['no build role, C11 missing', all('pass', CHECK_IDS.filter(id => id !== 'C11')), {}, 2],
    ['stale C2', { ...all('pass', ['C1']), C2: { status: 'pass', checkedAt: NOW - 8 * DAY } }, {}, 0],
    ['declaration changed since', all('pass'), { fresh: false }, 0],
  ]
  expect(rows.map(([name, checks, extra]) => [name, levelOf(checks, { ...o, ...extra })])).toEqual(rows.map(([name, , , level]) => [name, level]))
  expect(parseState('{"v":1,"checks":{"C1":{"status":"pass","checkedAt":5},"C99":{}},"level":9}')).toEqual({ ...blankState(), checks: { C1: { status: 'pass', checkedAt: 5 } } })
  expect(parseState('nonsense')).toEqual(blankState())
})

// A fake transport for the ssh client: the remote line is the last argument; the answer comes from the line.
type Remote = { os: 'windows' | 'posix' | 'pwsh'; answer?: (line: string, stdin?: string) => RunOut | null }
const fakeSsh = (r: Remote) => {
  const calls: { argv: string[]; stdin?: string; timeoutMs: number }[] = []
  const proc: Proc = async (argv, init) => {
    calls.push({ argv: [...argv], ...(init.stdin !== undefined ? { stdin: init.stdin } : {}), timeoutMs: init.timeoutMs })
    const line = argv[argv.length - 1] ?? ''
    const given = r.answer?.(line, init.stdin)
    if (given !== undefined) return given
    if (line === 'echo a5r %OS%') return { exitCode: 0, stdout: r.os === 'windows' ? 'a5r Windows_NT\r\n' : r.os === 'pwsh' ? 'a5r\r\n%OS%\r\n' : 'a5r %OS%\n', stderr: '' }
    return { exitCode: 0, stdout: '', stderr: '' }
  }
  return { calls, proc }
}

test('S-b (A4): unit: the adapter contract on a fake transport: every op answers { ok } or { ok: false, error }; a missing op is NO_ADAPTER_OP; a throw is ADAPTER_ERROR', async () => {
  const win = fakeSsh({ os: 'windows' })
  const ssh = sshAdapter('f20', { ssh: 'C:/ssh.exe', config: 'C:/cfg', laneRoot: 'D:/lanes', a5rRoot: 'D:/s2' }, win.proc)
  const manual = manualAdapter()
  for (const a of [ssh, manual] as Adapter[])
    for (const op of ['probe', 'readFile', 'writeFile', 'run', 'envInfo'] as const) {
      const r = (await (callOp as (a: Adapter, op: string, ...x: unknown[]) => Promise<{ ok: boolean; error?: { code: string } }>)(a, op, ...(op === 'readFile' ? ['D:/s2/x.txt'] : op === 'writeFile' ? ['D:/lanes/x.txt', 'hi'] : op === 'run' ? [['sort']] : [])))
      expect([a.kind, op, typeof r.ok, r.ok || typeof r.error?.code === 'string']).toEqual([a.kind, op, 'boolean', true])
    }
  expect(await callOp(manual, 'probe')).toEqual({ ok: false, error: { code: 'NO_ADAPTER_OP', text: 'the manual adapter has no probe' } })
  expect(await callOp(manual, 'run', ['sort'])).toEqual({ ok: false, error: { code: 'NO_ADAPTER_OP', text: 'the manual adapter has no run' } })
  const throwing: Adapter = { kind: 'x', link: DEFAULT_LINK, helpers: () => null, probe: async () => { throw new Error('boom') } }
  expect(await callOp(throwing, 'probe')).toEqual({ ok: false, error: { code: 'ADAPTER_ERROR', text: 'Error: boom' } })
  expect(manualPacket('rig', 'night rig')).toContain(`Windows (cmd): ${MANUAL_STEPS.windows}`)
  expect(parsePaste('junk\r\na5r-os Windows_NT\r\na5r-epoch 1790000000000\r\na5r-ram 66270000 31000000\r\n')).toEqual({ os: 'windows', osText: 'Windows_NT', epochMs: 1790000000000, ramKb: { total: 66270000, free: 31000000 } })
  expect(parsePaste('a5r-os Linux')).toEqual({ os: 'posix', osText: 'Linux', epochMs: null, ramKb: null })
})

test('S-b (A4): unit: ssh: the remote command is ONE argument string written for the remote OS (read in C1), 30 s by default; exit 255 is the link, no answer a timeout', async () => {
  expect([osOf('a5r Windows_NT\r\n'), osOf('a5r %OS%\n'), osOf('a5r\r\n%OS%\r\n'), osOf('Welcome!\n')]).toEqual([{ os: 'windows', shell: 'cmd' }, { os: 'posix', shell: 'sh' }, { os: 'windows', shell: 'other' }, null])
  expect([winQuote('sort'), winQuote('USERNAME eq %USERNAME%'), winQuote('a"b'), winQuote('')]).toEqual(['sort', '"USERNAME eq %USERNAME%"', '"a\\"b"', '""'])
  expect([shQuote('+%s'), shQuote("it's"), shQuote('a b')]).toEqual(['+%s', `'it'\\''s'`, `'a b'`])
  expect(remoteLine('windows', ['git', 'hash-object', '--stdin'], 'D:/my lanes/x')).toBe('cd /d "D:/my lanes/x" && git hash-object --stdin')
  expect(remoteLine('posix', ['ps', '-x', '-o', 'comm='], '/srv/lane')).toBe('cd /srv/lane && ps -x -o comm=')
  const win = fakeSsh({ os: 'windows', answer: line => (line === 'sort' ? { exitCode: 0, stdout: 'a\r\nb\r\nc\r\n', stderr: '' } : undefined) as never })
  const ssh = sshAdapter('f20', { ssh: 'C:/Windows/System32/OpenSSH/ssh.exe', config: 'C:/Users/x/.ssh/config' }, win.proc)
  expect(await callOp(ssh, 'probe')).toMatchObject({ ok: true, value: { os: 'windows', shell: 'cmd' } })
  expect(await callOp(ssh, 'run', ['sort'], { stdin: 'b\na\nc\n' })).toEqual({ ok: true, value: { exitCode: 0, stdout: 'a\r\nb\r\nc\r\n', stderr: '' } })
  expect(win.calls.map(c => c.argv)).toEqual([
    ['C:/Windows/System32/OpenSSH/ssh.exe', '-F', 'C:/Users/x/.ssh/config', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', 'f20', 'echo a5r %OS%'],
    ['C:/Windows/System32/OpenSSH/ssh.exe', '-F', 'C:/Users/x/.ssh/config', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '--', 'f20', 'sort'],
  ])
  expect(win.calls.map(c => [c.stdin, c.timeoutMs])).toEqual([[undefined, 30_000], ['b\na\nc\n', 30_000]])
  // A posix host, never probed: run probes first, then quotes for sh.
  const nix = fakeSsh({ os: 'posix' })
  await callOp(sshAdapter('box', {}, nix.proc), 'run', ['date', '+%s'], { cwd: '/srv/a b', timeoutMs: 5_000 })
  expect(nix.calls.map(c => [c.argv.slice(-1)[0], c.timeoutMs])).toEqual([['echo a5r %OS%', 30_000], ["cd '/srv/a b' && date +%s", 5_000]])
  expect(nix.calls[0]?.argv[0]).toBe('ssh')
  // The link fails (255), or nothing answers in time.
  const down = sshAdapter('f20', {}, async () => ({ exitCode: 255, stdout: '', stderr: 'ssh: connect to host f20 port 22: Connection timed out\r\n' }))
  expect(await callOp(down, 'probe')).toEqual({ ok: false, error: { code: 'LINK', text: 'ssh f20 failed: ssh: connect to host f20 port 22: Connection timed out' } })
  expect(await callOp(sshAdapter('f20', {}, async () => null), 'run', ['sort'])).toEqual({ ok: false, error: { code: 'TIMEOUT', text: 'ssh f20 did not answer within 30 s' } })
})

test('S-b (A4): unit: ssh readFile caps at 1 MiB; writeFile writes only under the lane root or Saved/A5R, through stdin; envInfo names the logon', async () => {
  const sizes: Record<string, string> = { 'D:/s2/Saved/A5R/card.json': '120', 'D:/big.log': String(2 * 1024 * 1024) }
  const win = fakeSsh({
    os: 'windows',
    answer: line => {
      const size = /^for %I in \(([^)]+)\) do @echo %~zI$/.exec(line)?.[1]
      if (size) return { exitCode: sizes[size] ? 0 : 1, stdout: sizes[size] ? `${sizes[size]}\r\n` : '', stderr: '' }
      if (line.startsWith('type ')) return { exitCode: 0, stdout: '{"v":1}', stderr: '' }
      if (line === 'echo %USERNAME%') return { exitCode: 0, stdout: 'administrator\r\n', stderr: '' }
      return undefined as never
    },
  })
  const ssh = sshAdapter('f20', { laneRoot: 'D:/lanes', a5rRoot: 'D:/s2' }, win.proc, { os: 'windows', shell: 'cmd' })
  expect(await callOp(ssh, 'readFile', 'D:/s2/Saved/A5R/card.json')).toEqual({ ok: true, value: '{"v":1}' })
  expect(await callOp(ssh, 'readFile', 'D:/big.log')).toEqual({ ok: false, error: { code: 'TOO_BIG', text: 'D:/big.log is 2097152 bytes (cap 1048576)' } })
  expect(await callOp(ssh, 'readFile', 'D:/none.txt')).toEqual({ ok: false, error: { code: 'NOT_FOUND', text: 'D:/none.txt could not be read on f20' } })
  expect(await callOp(ssh, 'writeFile', 'D:/s2/Saved/A5R/inbox/x.json', '{}')).toEqual({ ok: true, value: null })
  expect(await callOp(ssh, 'writeFile', 'd:\\lanes\\lane-1\\job.json', '{}')).toEqual({ ok: true, value: null })
  for (const p of ['D:/s2/Source/x.cpp', 'D:/lanes/../Windows/x', 'C:/Users/x.txt'])
    expect(await callOp(ssh, 'writeFile', p, 'x')).toEqual({ ok: false, error: { code: 'PATH_NOT_ALLOWED', text: `${p} is not under the host's lane root or Saved/A5R (reach.options laneRoot, a5rRoot)` } })
  const write = win.calls.find(c => c.stdin === '{}')
  expect(write?.argv.slice(-1)[0]).toMatch(/^powershell -NoProfile -NonInteractive -Command "\[Console\]::InputEncoding/)
  expect(await callOp(ssh, 'envInfo')).toEqual({ ok: true, value: { os: 'windows', shell: 'cmd', user: 'administrator' } })
  expect([isUnder('/srv/lanes/a', ['/srv/lanes'], 'posix'), isUnder('/srv/lanesX/a', ['/srv/lanes'], 'posix'), isUnder('/SRV/lanes/a', ['/srv/lanes'], 'posix')]).toEqual([true, false, false])
})

test('S-b (A4, D16): unit: the backoff grows with consecutive failures; 12 failures in 10 min, or more than the hourly cap, is a storm with the refusal text verbatim', () => {
  const fails = (n: number, every: number, from: number) => Array.from({ length: n }, (_, i) => ({ at: from + i * every, ok: false, op: 'probe', code: 'LINK' }))
  const eleven = fails(11, 30_000, NOW)
  const end = NOW + 10 * 30_000
  expect(linkNow(eleven, end, 0, DEFAULT_LINK)).toMatchObject({ failures10: 11, storm: null })
  const twelve = fails(12, 30_000, NOW)
  const at12 = NOW + 11 * 30_000
  expect(linkNow(twelve, at12, 0, DEFAULT_LINK)).toMatchObject({ failures10: 12, storm: { count: 12, minutes: 10 } })
  expect(stormText('f20', { count: 12, minutes: 10 })).toBe('A5R · host f20 — link failed 12 times in 10 min → fix the link (C2), then /a5r host resume f20')
  // A resume (windowStart) forgets the failures before it; a success ends the backoff run.
  expect(linkNow(twelve, at12, at12 + 1, DEFAULT_LINK).storm).toBeNull()
  expect(linkNow([...fails(3, 1_000, NOW), { at: NOW + 5_000, ok: true, op: 'probe' }], NOW + 6_000, 0, DEFAULT_LINK).retryAt).toBe(0)
  // Backoff: 5 s, 10 s, 20 s … capped at 15 min.
  expect([1, 2, 3, 20].map(n => linkNow(fails(n, 1, NOW), NOW + n, 0, DEFAULT_LINK).retryAt - (NOW + n - 1))).toEqual([5_000, 10_000, 20_000, 15 * MIN])
  // The hourly cap (an adapter's maxReconnectsPerHour), spread so no 10 minutes holds 12.
  expect(linkNow(fails(31, 110_000, NOW), NOW + 31 * 110_000 - 1, 0, DEFAULT_LINK).storm).toEqual({ count: 31, minutes: 60 })
  // link.jsonl: one JSON line each, the last 200 kept; junk lines are skipped.
  const text = linkText(fails(200, 1, NOW), { at: NOW + 999, ok: true, op: 'run' })
  expect(parseLink(`${text}garbage\n`).length).toBe(200)
  expect(parseLink(text).slice(-1)).toEqual([{ at: NOW + 999, ok: true, op: 'run' }])
})
