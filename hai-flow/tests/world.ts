import { mock } from 'claude-code/testing'
import { CONFIG } from './config.fixture.ts'

// Through the engine: the plugin's hooks sit above; the test's `on` hooks stand for the engine
// beneath it: an in-memory file system, the session, the store, the clock, processes and the tools.
export const PROJ = 'E:/proj'
export const LOCK = 'E:/s2/Saved/EDITOR_OWNER.txt'
export const PENDING = 'C:/Users/hai.huynh/.claude/PENDING.md'
export const ME = 'ab12cd34-5678-4000-8000-000000000000'
export const ENV = { TEMP: 'C:/Users/HAI~1.HUY/AppData/Local/Temp', LOCALAPPDATA: 'C:/Users/hai.huynh/AppData/Local', USERPROFILE: 'C:/Users/hai.huynh' }
export const opts = (a5WhenPresent = 'deny') => ({ options: { a5WhenPresent, editorLock: LOCK, pendingFile: PENDING } })
export const BAT = '"D:/GameEditors/5.8/Engine/Build/BatchFiles/Build.bat" S2Editor Win64 Development'
export const NOW = new Date(2026, 9, 6, 14, 40).getTime()
export const LIME = '#DDFF00'

export type Rec = Record<string, unknown>
export type Tree = { type?: string; props?: Rec; children?: unknown[] }
export const k = (p: string) => p.replace(/\\/g, '/').toLowerCase()
/** Why the plugin refused a call, or undefined when it let it run. */
export const refused = (ran: { deny?: string; isError?: boolean; text?: string }): string | undefined => ran.deny ?? (ran.isError ? ran.text : undefined)
export const keys = (t: unknown): string[] => ((t as Tree).children ?? []).map(c => String((c as Tree).props?.key ?? ''))
export const find = (t: unknown, key: string): Tree | undefined => {
  const n = t as Tree
  if (n?.props?.key === key) return n
  for (const c of n?.children ?? []) {
    const hit = find(c, key)
    if (hit) return hit
  }
  return undefined
}
/** The color of the first Text inside the keyed Box. */
export const firstText = (t: unknown, key: string): unknown => ((find(t, key)?.children ?? [])[0] as Tree | undefined)?.props?.color
export const text = (t: unknown): string => (typeof t === 'string' ? t : ((t as Tree)?.children ?? []).map(text).join(''))

export type Proc = { name: string; pid: number; gb: number; parentAlive: boolean }
/** The engine beneath the plugin. `out` maps a Bash command (or a tool name) to the text it prints; `ram`,
 * `disk` and `procs` are what the machine probe reads (a function of the run count to change it over time). */
export function world(on: any, { out = {} as Record<string, string>, ram = '20.5', a5 = true, disk = 40, procs = [] as Proc[], git = {} as Record<string, { stdout: string; exitCode?: number }>, store = {} as Record<string, unknown> } = {}) {
  const files = new Map<string, string>([[k(`${PROJ}/.git/HEAD`), 'ref: refs/heads/main'], [k('E:/s2/S2.uproject'), '{}'], [k(`${PROJ}/S2.uproject`), '{}']])
  const mtimes = new Map<string, number>()
  const seen: Rec[] = []
  const runs: string[] = []
  const sent: Rec[] = []
  const machine = { ram, disk, procs }
  const ids = { current: ME } // the session id: a /clear moves the process to another
  const value = (v: unknown) => ({ value: v })
  mock.env(on, ENV)
  mock.store(on, { a5: { on: a5 }, ...store })
  const clock = mock.clock(on, { now: NOW })
  on('fs.read', async (_$: unknown, e: { path: string }) => {
    if (k(e.path).endsWith('/a5/config.json')) return value(JSON.stringify(CONFIG))
    if (k(e.path).endsWith('/a5/rules-a5.md')) return value('A5 RULES {SESSION8}')
    if (k(e.path).endsWith('/a5/rules-flow.md')) return value('FLOW RULES {SESSION8}')
    const t = files.get(k(e.path))
    return t === undefined ? { deny: `ENOENT: ${e.path}` } : value(t)
  })
  on('fs.write', async (_$: unknown, e: { path: string; text: string }) => {
    files.set(k(e.path), e.text)
    mtimes.set(k(e.path), clock.now())
    return value(undefined)
  })
  on('fs.exists', async (_$: unknown, e: { path: string }) => value([...files.keys()].some(p => p === k(e.path) || p.startsWith(`${k(e.path)}/`))))
  on('fs.list', async (_$: unknown, e: { path: string }) => {
    const dir = `${k(e.path).replace(/\/$/, '')}/`
    const names = [...files.keys()].filter(p => p.startsWith(dir) && !p.slice(dir.length).includes('/'))
    return names.length ? value(names.map(p => ({ name: p.slice(dir.length), kind: 'file', size: (files.get(p) ?? '').length, mtimeMs: mtimes.get(p) ?? NOW, isLink: false }))) : { deny: `ENOENT: ${e.path}` }
  })
  on('fs.stat', async (_$: unknown, e: { path: string }) =>
    k(e.path).endsWith('fetch_head')
      ? value({ kind: 'file', size: 1, mtimeMs: NOW - 90 * 60_000, isLink: false })
      : files.has(k(e.path))
        ? value({ kind: 'file', size: (files.get(k(e.path)) ?? '').length, mtimeMs: mtimes.get(k(e.path)) ?? NOW, isLink: false })
        : { deny: 'ENOENT' })
  on('session.id', async () => value(ids.current))
  on('session.end', async (_$: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  on('session.cwd', async () => value(PROJ))
  on('session.root', async () => value(PROJ))
  on('session.messages', async () => value([]))
  on('session.start', async () => ({ cwd: PROJ }))
  on('session.send', async (_$: unknown, e: Rec) => {
    sent.push(e)
    return { isDelivered: true }
  })
  on('process.run', async (_$: unknown, e: { argv: string[] }) => {
    const argv = e.argv.join(' ')
    runs.push(argv)
    const hit = Object.entries(git).find(([needle]) => argv.includes(needle))?.[1]
    const stdout = hit ? hit.stdout
      : argv.includes('ConvertTo-Json') ? JSON.stringify({ freeGb: Number(machine.ram), diskGb: machine.disk, procs: machine.procs })
        : argv.includes('rev-parse') ? 'HaiHuynh/20261005'
          : argv.includes('rev-list') ? '3\t12'
            : argv.includes('--merges') ? 'def5678 · 3 days ago'
              : argv.includes('origin/main') ? 'abc1234 · 2 hours ago'
                : machine.ram
    return value({ exitCode: hit?.exitCode ?? 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
  })
  const calls: Record<string, unknown[]> = {}
  for (const ev of ['ui.toast', 'ui.log', 'ui.status', 'ui.invalidate', 'command.register', 'tool.register'])
    on(ev, async (_$: unknown, e: unknown) => {
      ;(calls[ev] ??= []).push(e)
      return value(ev === 'tool.register' ? { tool: `mcp__hai-flow__${String((e as Rec).name)}` } : undefined)
    })
  // D7: an agent type registers; a spawned subagent starts as `w-sync` (its end is the test's turn.complete).
  on('agent.register', async (_$: unknown, e: Rec) => {
    ;(calls['agent.register'] ??= []).push(e)
    return value({ agent: `hai-flow:${String(e.name)}` })
  })
  on('agent.spawn', async (_$: unknown, e: Rec) => {
    ;(calls['agent.spawn'] ??= []).push(e)
    return { model: 'claude-test', agentId: 'w-sync' }
  })
  // The session's agents: the sync worker once one was spawned (the harness drops a spawn's agentId).
  on('agent.list', async () => value((calls['agent.spawn'] ?? []).length > 0 ? [{ id: 'w-sync', description: 'Sync main', type: 'hai-flow:sync', status: 'running', spawnedBy: 'hai-flow' }] : []))
  // A prompt the plugin submits enters as it was sent (an event: it answers { text }).
  on('prompt.submit', async (_$: unknown, e: { text: string; context?: string[] }) => {
    ;(calls['prompt.submit'] ??= []).push(e)
    return { text: e.text, ...(e.context ? { context: e.context } : {}) }
  })
  on('classic.Stop', async () => ({}))
  on('tool.call', async (_$: unknown, e: Rec) => {
    seen.push(e)
    const t = out[String(e.command ?? e.tool)] ?? (e.tool === 'mcp__ccd_session_mgmt__get_session' ? '{"title":"3️⃣ Loco fix"}' : 'ok')
    return { result: { stdout: t, stderr: '', interrupted: false }, text: t }
  })
  return {
    files,
    mtimes,
    seen,
    clock,
    calls,
    runs,
    sent,
    machine,
    ids,
    put: (p: string, t: string, mtime = NOW) => {
      files.set(k(p), t)
      mtimes.set(k(p), mtime)
    },
    read: (p: string): string => files.get(k(p)) ?? '',
  }
}

/** What Ather draws for its pane: masthead, the home strip (home view only), the foot. */
export const atherTree = (home: boolean): never => ({
  type: 'Box',
  props: { flexDirection: 'column' },
  children: [
    { type: 'Box', props: { key: 'head-words', flexDirection: 'column' }, children: [{ type: 'Text', props: { color: LIME, bold: true }, children: ['A T H E R'] }] },
    ...(home ? [{ type: 'Box', props: { key: 'strip', borderStyle: 'round', borderColor: '#3a3c36' }, children: [{ type: 'Text', props: { color: '#8E918A' }, children: ['Checklist'] }] }] : []),
    { type: 'Box', props: { key: 'foot', flexDirection: 'column' }, children: [{ type: 'Text', props: { color: '#8E918A' }, children: ['Enter chooses · Esc closes'] }] },
  ],
}) as never
export const PANE = { surface: 'terminal', component: 'Pane', requestId: 'ather', props: { title: 'ATHER AUTOMATA', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 22 }, view: {} } }
