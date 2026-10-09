import { mock } from 'claude-code/testing'
import { CONFIG } from './config.fixture.ts'

// Through the engine: the plugin's hooks sit above; the test's `on` hooks stand for the engine
// beneath it: an in-memory file system, the session, the store, the clock, processes and the tools.
export const PROJ = 'E:/proj'
export const LOCK = 'E:/s2/Saved/EDITOR_OWNER.txt'
export const PENDING = 'C:/Users/hai.huynh/.claude/PENDING.md'
export const ME = 'ab12cd34-5678-4000-8000-000000000000'
export const ENV = { TEMP: 'C:/Users/HAI~1.HUY/AppData/Local/Temp', LOCALAPPDATA: 'C:/Users/hai.huynh/AppData/Local', USERPROFILE: 'C:/Users/hai.huynh' }
export const opts = (a5rWhenPresent = 'deny') => ({ options: { a5rWhenPresent, editorLock: LOCK, pendingFile: PENDING } })
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
export function world(on: any, { out = {} as Record<string, string>, ram = '20.5', a5r = true, disk = 40, procs = [] as Proc[], git = {} as Record<string, { stdout: string; exitCode?: number; truncated?: boolean; deny?: string }>, store = {} as Record<string, unknown>, ask = undefined as string | undefined, rules = 'A5R RULES {SESSION8}', theme = 'dark' } = {}) {
  const files = new Map<string, string>([[k(`${PROJ}/.git/HEAD`), 'ref: refs/heads/main'], [k('E:/s2/S2.uproject'), '{}'], [k(`${PROJ}/S2.uproject`), '{}']])
  const mtimes = new Map<string, number>()
  const seen: Rec[] = []
  const runs: string[] = []
  const sent: Rec[] = []
  const machine = { ram, disk, procs }
  const ids = { current: ME } // the session id: a /clear moves the process to another
  const value = (v: unknown) => ({ value: v })
  mock.env(on, ENV)
  mock.store(on, { a5r: { on: a5r }, ...store })
  const clock = mock.clock(on, { now: NOW })
  on('fs.read', async (_$: unknown, e: { path: string }) => {
    if (k(e.path).endsWith('/rules/config.json')) return value(JSON.stringify(CONFIG))
    if (k(e.path).endsWith('/rules/rules-a5r.md')) return value(rules)
    if (k(e.path).endsWith('/rules/rules-flow.md')) return value('FLOW RULES {SESSION8}')
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
    // Folders too: the first segment of any deeper path (a folder exists while it holds a file).
    const dirs = [...new Set([...files.keys()].filter(p => p.startsWith(dir) && p.slice(dir.length).includes('/')).map(p => p.slice(dir.length).split('/')[0] ?? ''))].filter(Boolean)
    const entries = [...names.map(p => ({ name: p.slice(dir.length), kind: 'file', size: (files.get(p) ?? '').length, mtimeMs: mtimes.get(p) ?? NOW, isLink: false })), ...dirs.map(name => ({ name, kind: 'dir', size: 0, mtimeMs: NOW, isLink: false }))]
    return entries.length ? value(entries) : { deny: `ENOENT: ${e.path}` }
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
    if (hit?.deny) return { deny: hit.deny } // the run rejects, as a timeout does
    const stdout = hit ? hit.stdout
      : argv.includes('ConvertTo-Json') ? JSON.stringify({ freeGb: Number(machine.ram), diskGb: machine.disk, procs: machine.procs })
        : argv.includes('rev-parse') ? 'HaiHuynh/20261005'
          : argv.includes('rev-list') ? '3\t12'
            : argv.includes('--merges') ? 'def5678 · 3 days ago'
              : argv.includes('origin/main') ? 'abc1234 · 2 hours ago'
                : machine.ram
    return value({ exitCode: hit?.exitCode ?? 0, stdout, stderr: '', isStdoutTruncated: hit?.truncated === true, isStderrTruncated: false })
  })
  const calls: Record<string, unknown[]> = {}
  let answer = ask // what Hai picks in the next dialog; `say` changes it
  for (const ev of ['ui.toast', 'ui.log', 'ui.status', 'ui.invalidate', 'command.register', 'tool.register'])
    on(ev, async (_$: unknown, e: unknown) => {
      ;(calls[ev] ??= []).push(e)
      return value(ev === 'tool.register' ? { tool: `mcp__a5r__${String((e as Rec).name)}` } : undefined)
    })
  // D7: an agent type registers; a spawned subagent starts as `w-sync` (its end is the test's turn.complete).
  on('agent.register', async (_$: unknown, e: Rec) => {
    ;(calls['agent.register'] ??= []).push(e)
    return value({ agent: `a5r:${String(e.name)}` })
  })
  on('agent.spawn', async (_$: unknown, e: Rec) => {
    ;(calls['agent.spawn'] ??= []).push(e)
    return { model: 'claude-test', agentId: 'w-sync' }
  })
  // The session's agents: the sync worker once one was spawned (the harness drops a spawn's agentId).
  // A65: a judge spawned is listed as `w-judge-<n>` (n from 1), of its own type.
  on('agent.list', async () => {
    const spawns = (calls['agent.spawn'] ?? []) as Rec[]
    const judges = spawns.filter(s => (s.subagent_type ?? s.subagentType) === 'a5r:judge').map((s, n) => ({ id: `w-judge-${n + 1}`, description: String(s.description ?? ''), type: 'a5r:judge', status: 'running', spawnedBy: 'a5r' }))
    return value([...(spawns.some(s => (s.subagent_type ?? s.subagentType) !== 'a5r:judge') ? [{ id: 'w-sync', description: 'Sync main', type: 'a5r:sync', status: 'running', spawnedBy: 'a5r' }] : []), ...judges])
  })
  // A prompt the plugin submits enters as it was sent (an event: it answers { text }).
  // A59: `failSubmit(n)` makes the next n prompt submissions fail (a refused wake); they are not recorded.
  let submitFails = 0
  on('prompt.submit', async (_$: unknown, e: { text: string; context?: string[] }) => {
    if (submitFails > 0) {
      submitFails -= 1
      throw new Error('wake refused')
    }
    ;(calls['prompt.submit'] ??= []).push(e)
    return { text: e.text, ...(e.context ? { context: e.context } : {}) }
  })
  on('classic.Stop', async () => ({}))
  // A40: the app theme as /config lists it, and its change through /config.
  let themeValue = theme
  on('config.list', async () => value([{ key: 'theme', label: 'Theme', kind: 'choice', value: themeValue, options: ['dark', 'light', 'dark-daltonized', 'light-daltonized'], provider: 'engine', isLocked: false }]))
  on('config.set', async (_$: unknown, e: Rec) => {
    if (e.key === 'theme') themeValue = String(e.value)
    return value(e.value)
  })
  // The surface places every pane a5r opens (A29), and the test can see which.
  on('ui.open', async (_$: unknown, e: Rec) => {
    ;(calls['ui.open'] ??= []).push(e)
    return value({ isPlaced: true })
  })
  on('tool.call', async (_$: unknown, e: Rec) => {
    // The dialog (`$.ui.ask` → AskUserQuestion): Hai picks `ask` when the test gives one.
    if (e.tool === 'AskUserQuestion' && answer !== undefined) {
      ;(calls.ask ??= []).push(e)
      const q = String(((e.questions as Rec[] | undefined) ?? [])[0]?.question ?? '')
      return { result: { questions: e.questions, answers: { [q]: answer } }, text: answer }
    }
    seen.push(e)
    const t = out[String(e.command ?? e.tool)] ?? (e.tool === 'mcp__ccd_session_mgmt__get_session' ? '{"title":"3️⃣ Loco fix"}' : 'ok')
    return { result: { stdout: t, stderr: '', interrupted: false }, text: t }
  })
  return {
    failSubmit: (n: number) => {
      submitFails = n
    },
    say: (label: string | undefined) => {
      answer = label
    },
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
/** A29: the A5R pane, drawn by a5r itself (no Ather beneath). */
export const A5RPANE = { ...PANE, requestId: 'a5r' }

// A25/A26: measuring a drawn tree the way the surface lays it out.
/** The narrowest width a node can be laid out in, in cells, the way the surface lays boxes out: text that wraps
 * breaks at words, any other text keeps its whole line; a row lays its children side by side (with its gaps)
 * unless it wraps; a column takes its widest child; padding and a border add to it. */
export const minWidth = (node: unknown, wraps = false): number => {
  if (node === null || node === undefined || node === false) return 0
  if (typeof node === 'string' || typeof node === 'number') {
    const s = String(node)
    return wraps ? Math.max(0, ...s.split(/\s+/).map(w => [...w].length)) : [...s].length
  }
  if (Array.isArray(node)) return node.reduce((n: number, c) => n + minWidth(c, wraps), 0)
  const t = node as Tree
  const p = (t.props ?? {}) as Record<string, unknown>
  const kids = t.children ?? (p.children === undefined ? [] : [p.children].flat())
  if (t.type === 'Text') {
    // A28: a text that truncates can shrink to its ellipsis and one cell.
    if (typeof p.wrap === 'string' && p.wrap.startsWith('truncate')) return Math.min([...text(t)].length, 2)
    const isWrap = p.wrap === 'wrap' || wraps
    const s = text(t)
    return isWrap ? Math.max(0, ...s.split(/\s+/).map(w => [...w].length)) : [...s].length
  }
  if (t.type === 'Button') return [...String(p.label ?? '')].length + (p.plain ? 0 : 4)
  if (t.type === 'Svg') return Math.ceil(Number(p.width ?? 16) / 8)
  if (t.type === 'Client') return 11
  // A35: a box that clips (overflow hidden: a hairline) needs no width of its own; margins add like padding.
  if (p.overflow === 'hidden') return Number(p.marginX ?? 0) * 2
  if (p.position === 'absolute') return 0 // A37: a curtain lies over its block and takes no room
  const pad = Number(p.paddingX ?? 0) * 2 + Number(p.paddingLeft ?? 0) + Number(p.paddingRight ?? 0) + (p.borderStyle ? 2 : 0) + Number(p.marginX ?? 0) * 2 + Number(p.marginLeft ?? 0) + Number(p.marginRight ?? 0)
  const widths = kids.map(c => minWidth(c))
  if (p.flexDirection === 'column' || p.flexWrap === 'wrap') return pad + Math.max(0, ...widths)
  const gap = Number(p.columnGap ?? p.gap ?? 0)
  return pad + widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, widths.length - 1)
}

/** A49: where each keyed box lies across the pane, in cells from the pane's left edge, the way the surface's flex
 * layout places it down the column blocks: in a column, a child's own `width: '100%'` (or a number) is its width and
 * its side margins sit outside it; a child without a width stretches to the parent's content width less its margins.
 * Content is the box less its border and padding. Rows are placed themselves but not entered (their children share
 * the row by flex; `minWidth(row) <= w` says they fit). */
export const placed = (tree: unknown, columns: number): Map<string, { x: number; w: number }> => {
  const at = new Map<string, { x: number; w: number }>()
  const walk = (node: unknown, x: number, w: number): void => {
    const t = node as Tree
    if (!t || typeof t !== 'object' || t.type !== 'Box') return
    const p = (t.props ?? {}) as Record<string, unknown>
    if (p.position === 'absolute') return
    const left = Number(p.marginLeft ?? p.marginX ?? 0)
    const right = Number(p.marginRight ?? p.marginX ?? 0)
    const width = p.width === '100%' ? w : typeof p.width === 'number' ? p.width : w - left - right
    const box = { x: x + left, w: width }
    if (typeof p.key === 'string') at.set(p.key, box)
    if (p.flexDirection !== 'column') return
    const inset = (p.borderStyle ? 1 : 0) + Number(p.paddingX ?? 0)
    for (const c of t.children ?? []) walk(c, box.x + inset + Number(p.paddingLeft ?? 0), box.w - 2 * inset - Number(p.paddingLeft ?? 0) - Number(p.paddingRight ?? 0))
  }
  walk(tree, 0, columns)
  return at
}

export const all = (t: unknown, out: Tree[] = []): Tree[] => {
  if (t && typeof t === 'object' && !Array.isArray(t)) {
    out.push(t as Tree)
    for (const c of (t as Tree).children ?? []) all(c, out)
  }
  return out
}

/** A37: a drawn tree without its entrance and event curtains (absolute boxes keyed hai-a5r-in… / hai-a5r-fx…), for tests
 * that read a block's own children while a curtain may still lie over it. */
export const still = <T>(tree: T): T => {
  const strip = (n: unknown): unknown => {
    if (!n || typeof n !== 'object' || Array.isArray(n)) return n
    const t = n as Tree
    const kids = (t.children ?? []).filter(c => !/^hai-a5r-(in|fx)/.test(String((c as Tree)?.props?.key ?? ''))).map(strip)
    return { ...t, ...(t.children ? { children: kids } : {}) }
  }
  return strip(tree) as T
}
