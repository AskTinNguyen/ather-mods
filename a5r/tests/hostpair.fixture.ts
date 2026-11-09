// a5r-hosts S-d: two machines over in-memory files for the engine tests of hand-offs (hosts-sd-engine, hosts-sd2-engine).
// The origin (E:/o) declares the host `rig` over the real command adapter (its readFile and writeFile templates reach the
// host's files; no deliver: the reverse direction is cut); the host (D:/h) runs A5R with asHost on.
import type { Proc, RunOut } from '../hooks/adapters/types.ts'
import { parseHandoff, type Handoff } from '../hooks/handoff.ts'
import type { LocalTruth } from '../hooks/hostcard.ts'
import { hostsDesk, type HostIo } from '../hooks/hostdesk.ts'
import type { PrScore } from '../hooks/handofflink.ts'
import { NOW } from './world.ts'

export const MIN = 60_000
export const SHA = 'abc1234def5678abc1234def5678abc1234def56'
export const ORIGIN = 'hai-1a2b3c4d'
export type Machine = { files: Map<string, string>; clock: { now: number }; started: string[][] }

/** One machine's io over in-memory files; `proc` is the local process runner (the origin's reaches the host through it). */
export const memIo = (m: Machine, proc: Proc, extra: Partial<HostIo> = {}, runs: Record<string, string> = {}): HostIo => ({
  now: async () => m.clock.now,
  read: async p => m.files.get(p) ?? null,
  write: async (p, t) => void m.files.set(p, t),
  stat: async p => (m.files.has(p) ? { mtimeMs: m.clock.now } : null),
  list: async dir => [...m.files.keys()].filter(k => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes('/')).map(k => ({ name: k.slice(dir.length + 1), mtimeMs: m.clock.now })),
  run: async argv => {
    const hit = Object.entries(runs).find(([needle]) => argv.join(' ').includes(needle))
    return hit ? { exitCode: 0, stdout: hit[1] } : null
  },
  secrets: async () => ['ghp_[A-Za-z0-9]{10}'],
  proc,
  hostOpts: {},
  log: () => undefined,
  start: async argv => (m.started.push([...argv]), { exitCode: 0 }),
  sleep: async () => undefined,
  ...extra,
})
export const out = (stdout: string, exitCode = 0): RunOut => ({ exitCode, stdout, stderr: '' })
export const truth = (over: Partial<LocalTruth> = {}): LocalTruth => ({ os: 'windows', freeGb: 40, diskGb: 500, running: false, holder: null, queue: 0, gates: { pieGb: 38, nopieGb: 28 }, sync: null, ...over })
export const LS_REMOTE = { 'ls-remote': `${SHA}\trefs/heads/intent/x\n` }
export const LANES = { 'worktree list --porcelain': 'worktree D:/h\nHEAD 1\nbranch refs/heads/main\n\nworktree D:/lanes/l1\nHEAD 2\ndetached\n' }
/** The command adapter's templates: `cat`/`put` reach the host's files (through `toHost`), no deliver. */
export const OPS = JSON.stringify({ probe: ['q', 'ping', '{target}'], readFile: ['q', 'cat', '{path}'], writeFile: ['q', 'put', '{path}'] })
export const AS_HOST = { enabled: true, roles: ['ue'], trust: [ORIGIN], availability: { state: 'yes' }, laneRoot: 'D:/lanes', coordinationRoot: 'D:/h' }

/** Two machines: the origin (E:/o) with a declared host `rig` (command adapter, a5rRoot D:/h) and the host (D:/h, A5R on). */
export const pair = async (o: { asHost?: Record<string, unknown>; scores?: PrScore[]; pass?: boolean; manual?: boolean; originTruth?: () => LocalTruth; hostRuns?: Record<string, string>; originRuns?: Record<string, string> } = {}) => {
  const clock = { now: NOW }
  const origin: Machine = { files: new Map(), clock, started: [] }
  const host: Machine = { files: new Map(), clock, started: [] }
  const reached: string[] = []
  const toHost: Proc = async (argv, init) => {
    reached.push(argv.join(' '))
    if (argv[1] === 'ping') return out('a5r Windows_NT\r\n')
    if (argv[1] === 'cat') return host.files.has(argv[2] ?? '') ? out(host.files.get(argv[2] ?? '') ?? '') : out('', 1)
    if (argv[1] === 'put') return (host.files.set(argv[2] ?? '', init.stdin ?? ''), out(''))
    return out('', 1)
  }
  const scores = [...(o.scores ?? [])]
  const scored: number[] = []
  const passes: string[][] = []
  const oruns: Record<string, string> = { ...LS_REMOTE, ...o.originRuns } // the origin's git answers (a test may change them)
  const oio = memIo(origin, toHost, { originId: ORIGIN, scorePr: async n => (scored.push(n), scores.shift() ?? { state: 'OPEN', ok: null, lines: [] }), takePass: async keys => (passes.push([...keys]), o.pass === true) }, oruns)
  const hio = memIo(host, async () => null, {}, { ...LANES, ...o.hostRuns })
  const od = hostsDesk({ dir: () => 'E:/o/Saved/A5R', root: () => 'E:/o', me8: () => 'ab12cd34', lane: () => 'lane', home: () => 'C:/Users/o', isWriter: () => true, alive: () => true, local: o.originTruth ?? (() => truth()) })
  const hd = hostsDesk({ dir: () => 'D:/h/Saved/A5R', root: () => 'D:/h', me8: () => 'cd56ef78', lane: () => 'hostlane', home: () => 'C:/Users/h', isWriter: () => true, alive: () => true, local: () => truth() })
  await hd.tool(hio, { action: 'set', asHost: { ...AS_HOST, ...o.asHost } })
  const add = o.manual ? 'host add rig --reach manual --label Rig' : `host add rig --reach command:rig --label Rig --ops '${OPS}' --a5r-root D:/h`
  await od.command(oio, add)
  return { clock, origin, host, oio, hio, od, hd, reached, scored, passes, oruns }
}
export type Pair = Awaited<ReturnType<typeof pair>>
export const create = (p: Pair, more: Record<string, unknown> = {}) => p.od.tool(p.oio, { action: 'handoff', op: 'create', host: 'rig', branch: 'intent/x', task: 'do x', claims: ['Content/A.uasset'], wants: ['ue'], ...more })
export const idOf = (said: string) => /hand-off (\S+) for/.exec(said)?.[1] ?? ''
export const ho = (p: Pair, id: string): Handoff | null => parseHandoff(p.origin.files.get(`E:/o/Saved/A5R/handoffs/${id}.json`) ?? null)
export const minute = async (p: Pair, ms = MIN) => {
  p.clock.now += ms
  await p.hd.tick(p.hio, p.clock.now)
  return p.od.tick(p.oio, p.clock.now)
}
