// Rev 45: what its two test files share (no test here).
import { blankSession, heldLine, parseLockLine, DEFAULT_GATES, NO_MANUAL, type GrantInput, type SessionFile, type Want } from '../hooks/coord.ts'
import { conductor, type WakeIo } from '../hooks/wakehost.ts'
import { ENV, ME, NOW, PROJ, opts, world } from './world.ts'

export const HF = 'E:/s2/Saved/A5R'
export const RECORDS = 'C:/Users/hai.huynh/.claude/projects/E--s2'
export const ME8 = ME.slice(0, 8)
export const MIN = 60_000
export const H = 60 * MIN
export const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
export const SID = (id8: string) => `${id8}-1111-4000-8000-000000000000`
export const DESK = `${ENV.APPDATA}/Claude/claude-code-sessions/${ENV.CLAUDE_CODE_ACCOUNT_UUID}/${ENV.CLAUDE_CODE_ORGANIZATION_UUID}`
export const FREE = 'FREE since=14:30 2026-10-06 by=lane-bbbbbbbb note=done background=none · free since 14:30\n'
export const held = (id8: string, since: number, end: number) => `${heldLine({ lane: `lane-${id8}`, sessionName: `title-${id8}`, id8, since, pid: null, end, mode: 'interactive', pausable: true, nextSafe: 'after save', note: 'their slot' })}\n`
export const want = (o: Partial<Want> = {}): Want => ({ minutes: 30, pie: false, build: false, what: 'mc jump test', mode: 'unattended', pausable: true, nextSafe: 'after save', requestedAt: NOW - 3 * H, ...o })
export const file = (id8: string, o: Partial<SessionFile> = {}): SessionFile => ({ ...blankSession(SID(id8), `lane-${id8}`, `title ${id8}`, NOW), ...o })
/** A session whose process is gone: its last heartbeat long ago. */
export const stoppedFile = (id8: string, o: Partial<SessionFile> = {}): SessionFile => file(id8, { heartbeatAt: NOW - 3 * H, lastTurnAt: NOW - 3 * H, canPass: undefined, conducts: undefined, ...o })
export const put = (w: ReturnType<typeof world>, f: SessionFile) => w.put(`${HF}/editor/${f.id8}.json`, JSON.stringify(f))
export const inApp = (w: ReturnType<typeof world>) => w.put(`${DESK}/local_me.json`, JSON.stringify({ sessionId: 'local_me', cliSessionId: ME }))
export const desk = (w: ReturnType<typeof world>, id8: string, local = `local_${id8}`, o: Record<string, unknown> = {}) => {
  inApp(w)
  w.put(`${DESK}/${local}.json`, JSON.stringify({ sessionId: local, cliSessionId: SID(id8), title: `title ${id8}`, isArchived: false, ...o }))
}
export const stopped = (w: ReturnType<typeof world>, id8: string, o: Partial<SessionFile> = {}) => {
  put(w, stoppedFile(id8, { want: want(), ...o }))
  desk(w, id8)
}
export const fileOf = (w: ReturnType<typeof world>, id8: string) => JSON.parse(w.read(`${HF}/editor/${id8}.json`)) as SessionFile
export const sends = (w: ReturnType<typeof world>) => w.seen.filter(e => e.tool === 'SendMessage') as { to: string; message: string }[]
export const LOG = `${HF}/orchestrate.log`
export const SENT = JSON.stringify({ success: true, message: 'Forwarded to Claude Desktop\'s session messaging' })
export const REFUSED = JSON.stringify({ success: false, message: 'Not delivered to Claude Desktop session' })
export const PAUSED = JSON.stringify({ success: false, message: 'Not delivered: this session has already messaged Claude Desktop sessions 8 times since your user last typed here, which looks like sessions messaging each other automatically. Paused until your user\'s next message in this session.' })
export const said = (text: string) => JSON.stringify({ type: 'assistant', timestamp: new Date(NOW - 60 * MIN).toISOString(), message: { role: 'assistant', content: [{ type: 'text', text }] } })
export const QUEUED_WORDS = 'I am queued at #2 for the Editor: the next step is the jump test in PIE.'
export const grant = (files: SessionFile[], o: Partial<GrantInput> = {}): GrantInput => ({ me8: ME8, lock: parseLockLine(FREE), files, lanes: [], now: NOW, sync: null, probe: { freeGb: 40, diskGb: 100, procs: [] }, gates: DEFAULT_GATES, manual: NO_MANUAL, focus: null, ...o })
export const NONE: ReadonlySet<string> = new Set()
export const KEEP = (): boolean => false
/** The engine beneath the host itself, for what the test engine cannot show. */
export const fakeIo = (disk: Map<string, string>, o: Partial<WakeIo> = {}): WakeIo => ({ now: async () => NOW, read: async (p: string) => disk.get(p) ?? null, write: async (p: string, t: string) => void disk.set(p, t), stat: async () => null, list: async () => [], run: async () => null, call: async () => null, deskPlace: async () => ({}), writeChecked: async (p: string, _e: string | null, t: string) => (disk.set(p, t), true), claimAlert: async () => true, log: async () => undefined, notify: async () => false, toast: () => undefined, isGitFree: async () => true, heldNeeds: async () => new Set(), ...o })
export const beat = (w: ReturnType<typeof world>, id8: string) => put(w, { ...fileOf(w, id8), heartbeatAt: w.clock.now() + 1 })


export const app = (extra: { name: string; row: Record<string, unknown> }[]) => {
  const disk = new Map(extra.map(e => [`app/Claude/claude-code-sessions/a/o/${e.name}`, JSON.stringify(e.row)]))
  return { disk, o: { deskPlace: async () => ({ appData: 'app', account: 'a', org: 'o' }), list: async () => extra.map(e => ({ name: e.name, mtimeMs: 1 })) } }
}
export const hostOf = (files: () => SessionFile[], me: SessionFile) => conductor({ me8: () => ME8, me: () => me, grantInput: now => grant(files(), { now }), leases: () => [], dir: () => 'd', freeWindow: () => 'w', freeGb: () => 40, titleOf: () => '' })

export const long = { ...opts(), timeoutMs: 180_000 }
export const logged = (w: ReturnType<typeof world>, what: string): string[] => w.read(LOG).split('\n').filter(l => l.includes(what))

