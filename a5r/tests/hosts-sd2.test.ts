import { expect, test } from 'claude-code/testing'
import { remoteLine, sshAdapter } from '../hooks/adapters/ssh.ts'
import { DEFAULT_LINK, errOf, okOf, type Adapter, type RunInit, type RunOut } from '../hooks/adapters/types.ts'
import { FIX, autoPlan, checkLine, runChecks, type CheckCtx } from '../hooks/hostchecks.ts'
import type { HostDecl } from '../hooks/hosts.ts'
import type { CheckId } from '../hooks/hoststate.ts'
import { preemptNow, withPreempt, type Job } from '../hooks/jobs.ts'
import { NO_PROMPT } from '../hooks/l2setup.ts'
import { lineParts, type LineFacts } from '../hooks/lineparts.ts'

// a5r-hosts S-d part 2, unit: preemption from availability (decision 10), C3, C7, C8, C9 and C11 through a mocked adapter
// with each pass, fail and skip and every fix line verbatim (A3), the per-command env of the ssh adapter (C3's prompts off),
// the resume plan, and the compact line's hand-off part (F-d4).
const NOW = Date.UTC(2026, 10, 10, 12, 0)
const MIN = 60_000
const STALE = 7 * 24 * 60 * MIN

test('S-d (A8, decision 10): unit: availability no preempts with deadline now + warn; within warn of until preempts with deadline until; a preemption older than a resume does not hold', () => {
  const as = { enabled: true, roles: [], trust: [], availability: { state: 'yes' as const } }
  expect(preemptNow(as, NOW, 15 * MIN)).toBe(null)
  expect(preemptNow({ ...as, availability: { state: 'no', reason: 'owner is back' } }, NOW, 15 * MIN)).toEqual({ at: NOW, reason: 'owner is back', deadline: NOW + 15 * MIN })
  expect(preemptNow({ ...as, availability: { state: 'yes', until: NOW + 20 * MIN } }, NOW, 15 * MIN)).toBe(null)
  expect(preemptNow({ ...as, availability: { state: 'yes', until: NOW + 10 * MIN } }, NOW, 15 * MIN)).toEqual({ at: NOW, reason: `the host is available until ${new Date(NOW + 10 * MIN).toISOString()}`, deadline: NOW + 10 * MIN })
  const job: Job = { v: 1, id: 'x', receivedAt: NOW, state: 'running', startedAt: NOW, updatedAt: NOW }
  const p = { at: NOW + MIN, reason: 'r', deadline: NOW + 16 * MIN }
  expect(withPreempt(job, p).preempt).toEqual(p)
  expect(withPreempt({ ...job, resumedAt: NOW + 2 * MIN }, p).preempt).toBe(undefined)
  expect(withPreempt({ ...job, state: 'done' }, p).preempt).toBe(undefined)
})

/** A mocked remote for the setup checks: argv (joined) answered by the first rule; files by path; runs and envs kept. */
const remote = (rules: [RegExp, () => RunOut | 'link'][], files: Record<string, string> = {}, canBg = true): Adapter & { runs: string[]; envs: (Record<string, string> | undefined)[]; bgs: string[] } => {
  const runs: string[] = []
  const envs: (Record<string, string> | undefined)[] = []
  const bgs: string[] = []
  return {
    kind: 'mock',
    link: DEFAULT_LINK,
    canBg,
    helpers: () => null,
    runs,
    envs,
    bgs,
    run: async (argv, init?: RunInit) => {
      runs.push(argv.join(' '))
      envs.push(init?.env)
      if (init?.bg) bgs.push(argv.join(' '))
      const hit = rules.find(([rx]) => rx.test(argv.join(' ')))
      const r = hit ? hit[1]() : { exitCode: 0, stdout: '', stderr: '' }
      return r === 'link' ? errOf('LINK', 'gone') : okOf(r)
    },
    readFile: async path => (path in files ? okOf(files[path] ?? '') : errOf('NOT_FOUND', `${path} could not be read`)),
    status: async () => okOf({ running: false, exitCode: 0 }),
  }
}
const out = (stdout: string, exitCode = 0, stderr = ''): RunOut => ({ exitCode, stdout, stderr })
const DECL: HostDecl = { label: 'Rig', owner: '', reach: { kind: 'command', target: 'rig', options: { laneRoot: 'D:/lanes' } }, repo: { url: 'https://github.com/o/s2.git', path: 'D:/s2' }, diskEstimateGb: 100 }
const ctx = (a: Adapter, decl: HostDecl = DECL, more: Partial<NonNullable<CheckCtx['setup']>> = {}): CheckCtx => ({
  adapter: a,
  local: async () => null,
  now: async () => NOW,
  prior: { C1: { status: 'pass', checkedAt: NOW } },
  os: { os: 'windows', shell: 'cmd' },
  l2: { hostId: 'rig', originId: 'hai-1a2b3c4d', card: null, sleep: async () => undefined },
  setup: { hostId: 'rig', decl, engineHere: '{ED5C0549}', ...more },
})
const one = async (id: CheckId, c: CheckCtx) => checkLine(id, (await runChecks(c, [id], STALE)).checks[id])

test('S-d (A3, S3): unit: C3 runs ls-remote and one small LFS fetch with prompts off, in the adapter\'s logon; fails with the S3 fix line verbatim; skips with no repo', async () => {
  const lfs = { 'D:/s2/.gitattributes': '*.uasset filter=lfs diff=lfs merge=lfs -text\n' }
  const good = remote([[/ls-remote/, () => out('abc\tHEAD\n')]], lfs)
  expect(await one('C3', ctx(good, { ...DECL, repo: { ...(DECL.repo ?? { url: '' }), lfsProbe: 'Content/Tiny.uasset' } }))).toBe('C3 pass · ls-remote and an LFS fetch of Content/Tiny.uasset worked with prompts off (scratch store removed)')
  expect(good.envs.slice(0, 2)).toEqual([NO_PROMPT, NO_PROMPT])
  expect(good.runs[1]).toBe(`git -C D:/s2 -c lfs.storage=D:/s2/.a5r-c3-${NOW} lfs fetch origin HEAD --include=Content/Tiny.uasset`)
  expect(good.runs[2]).toBe(`cmd /c rmdir /s /q D:\\s2\\.a5r-c3-${NOW}`) // the scratch store removed
  // The credential lives in another logon (S3): ls-remote fails with prompts off.
  const s3 = remote([[/ls-remote/, () => out('', 128, 'fatal: could not read Username for \'https://github.com\': terminal prompts disabled')]], lfs)
  expect(await one('C3', ctx(s3))).toBe(`C3 fail · git ls-remote https://github.com/o/s2.git failed in the adapter's logon (exit 128: fatal: could not read Username for 'https://github.com': terminal prompts disabled) → ${FIX.C3}`)
  const nolfs = remote([[/ls-remote/, () => out('abc\tHEAD\n')], [/lfs fetch/, () => out('', 2, 'batch response: Authentication required')]], lfs)
  expect(await one('C3', ctx(nolfs, { ...DECL, repo: { url: 'u', path: 'D:/s2', lfsProbe: 'a.uasset' } }))).toBe(`C3 fail · git lfs fetch of a.uasset failed in the adapter's logon (exit 2: batch response: Authentication required) → ${FIX.C3}`)
  expect(await one('C3', ctx(good))).toBe(`C3 fail · the repo uses LFS: declare hosts.rig.repo.lfsProbe (one small LFS file) so C3 can fetch it → ${FIX.C3}`)
  expect(await one('C3', ctx(good, { ...DECL, repo: undefined }))).toBe('C3 skip · no repo.url declared for rig')
})

test('S-d (A3): unit: C7 compares the host\'s EngineAssociation with this machine\'s (same by default, any on request); C8 the free disk against the lane size x 1.2; both with their fix lines', async () => {
  const r = (assoc = '{ED5C0549}') => remote([[/ls-files/, () => out('S2.uproject\n')]], { 'D:/s2/S2.uproject': `{"EngineAssociation":"${assoc}"}` })
  expect(await one('C7', ctx(r()))).toBe('C7 pass · engine {ED5C0549} on both')
  expect(await one('C7', ctx(r('5.8')))).toBe(`C7 fail · engine 5.8 on the host, {ED5C0549} here → ${FIX.C7}`)
  expect(await one('C7', ctx(r('5.8'), { ...DECL, engine: { rule: 'any' } }))).toBe('C7 pass · engine 5.8 (rule any)')
  expect(await one('C7', ctx(r(), { ...DECL, repo: { url: 'u' } }))).toBe('C7 skip · no repo.path declared for rig')
  expect((await runChecks(ctx(r()), ['C7'], STALE)).engine).toBe('{ED5C0549}')
  const disk = (bytes: number) => remote([[/DriveInfo/, () => out(`${bytes}\r\n`)]])
  expect(await one('C8', ctx(disk(150 * 1024 ** 3)))).toBe('C8 pass · free 150 GB at D:/lanes, need 120 GB (lane 100 GB, declared x 1.2)')
  expect(await one('C8', ctx(disk(100 * 1024 ** 3)))).toBe(`C8 fail · free 100 GB at D:/lanes, need 120 GB (lane 100 GB, declared x 1.2) → ${FIX.C8}`)
  const { diskEstimateGb: _d, ...noEst } = DECL
  expect(await one('C8', ctx(disk(900 * 1024 ** 3), noEst, { labSizeGb: 632 }))).toBe('C8 pass · free 900 GB at D:/lanes, need 759 GB (lane 632 GB, measured x 1.2)')
  expect(await one('C8', ctx(disk(900 * 1024 ** 3), noEst))).toBe(`C8 fail · no lane size known: declare hosts.rig.diskEstimateGb (or measure the lane once) → ${FIX.C8}`)
})

test('S-d (A3, S4): unit: C9 reuses a lane; creates one only in the background and only after C8; never over an adapter without bg; a partial lane is never copied twice', async () => {
  const listing = (lane: boolean) => remote([[/worktree list/, () => out(`worktree D:/s2\nHEAD 1\nbranch refs/heads/main\n${lane ? '\nworktree D:/lanes/l1\nHEAD 2\ndetached\n' : ''}`)], [/worktree add/, () => out('f20/t9')]])
  expect(await one('C9', ctx(listing(true)))).toBe('C9 pass · reuses lane l1 (1 under D:/lanes)')
  expect(await one('C9', ctx(listing(false)))).toBe(`C9 fail · C8 has not passed: the lane is never created before the disk check passes → ${FIX.C9}`)
  const after8 = (a: Adapter) => ({ ...ctx(a), prior: { C1: { status: 'pass' as const, checkedAt: NOW }, C8: { status: 'pass' as const, checkedAt: NOW } } })
  const bg = listing(false)
  expect(await one('C9', after8(bg))).toBe(`C9 fail · lane-1 is being created in the background at D:/lanes/lane-1 (progress: f20/t9); check C9 again when it ends → ${FIX.C9}`)
  expect(bg.bgs).toEqual(['git -C D:/s2 worktree add --detach --progress D:/lanes/lane-1 origin/HEAD'])
  const nobg = remote([[/worktree list/, () => out('worktree D:/s2\n')]], {}, false)
  expect(await one('C9', after8(nobg))).toBe(`C9 fail · the mock adapter cannot start a background run: create the lane on the host (git -C D:/s2 worktree add --detach D:/lanes/lane-1), then check C9 again → ${FIX.C9}`)
  expect(nobg.runs.some(r => r.includes('worktree add'))).toBe(false)
  const partial = remote([[/worktree list/, () => out('worktree D:/s2\n')]], { 'D:/lanes/lane-1/.git': 'gitdir: D:/s2/.git/worktrees/lane-1' })
  expect(await one('C9', after8(partial))).toBe(`C9 fail · a partial lane is at D:/lanes/lane-1 (not in git's list): resume it on the host; no second copy is started → ${FIX.C9}`)
})

test('S-d (A3): unit: C11 runs the declared build and reads its log: only the success line passes; exit 0 without it fails with the fix line; no build declared skips', async () => {
  const build = { argv: ['Build.bat', 'S2Editor'], log: 'D:/s2/build.log', success: 'Result: Succeeded' }
  const decl = { ...DECL, build }
  /** The build appends its lines to the log (the files map is the host's). */
  const building = (old: string, adds: string) => {
    const files: Record<string, string> = old ? { 'D:/s2/build.log': old } : {}
    return remote([[/Build/, () => ((files['D:/s2/build.log'] = old + adds), out('t5'))]], files)
  }
  expect(await one('C11', ctx(building('', 'Compiling\r\nResult: Succeeded\r\n'), decl))).toBe('C11 pass · "Result: Succeeded" in D:/s2/build.log')
  expect(await one('C11', ctx(building('', 'Compiling\r\nerror C2039\r\n'), decl))).toBe(`C11 fail · no "Result: Succeeded" line in D:/s2/build.log (exit 0): exit code 0 is not proof → ${FIX.C11}`)
  // Yesterday's good build in the log: only lines written by this run count.
  expect(await one('C11', ctx(building('Result: Succeeded\r\n', 'error LNK2019\r\n'), decl))).toBe(`C11 fail · no "Result: Succeeded" line in D:/s2/build.log (exit 0): exit code 0 is not proof → ${FIX.C11}`)
  // Background without a status op: it cannot tell when the build ended.
  const blind = { ...building('', 'Result: Succeeded\r\n'), status: undefined }
  expect(await one('C11', ctx(blind, decl))).toBe(`C11 fail · the mock adapter starts the build in the background but has no status op: C11 cannot tell when it ended → ${FIX.C11}`)
  expect(await one('C11', ctx(remote([]), DECL))).toBe('C11 skip · no build declared')
  // The resume plan: L1, the setup checks for a host with a repo, C13; C11 and C12 only when named.
  expect([autoPlan(false), autoPlan(true)]).toEqual([['C1', 'C2', 'C4', 'C5', 'C10', 'C13'], ['C1', 'C2', 'C3', 'C4', 'C5', 'C7', 'C8', 'C9', 'C10', 'C13']])
})

test('S-d (C3): unit: the ssh adapter sets env for one command (cmd: set K=V&&; sh: K=V), quoted, with the cwd first', () => {
  expect(remoteLine('windows', ['git', 'ls-remote', 'u'], 'D:/s2', NO_PROMPT)).toBe('cd /d D:/s2 && set GIT_TERMINAL_PROMPT=0&& set GCM_INTERACTIVE=never&& git ls-remote u')
  expect(remoteLine('posix', ['git', 'ls-remote', 'u'], undefined, { ...NO_PROMPT, 'BAD KEY': 'x' })).toBe('GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never git ls-remote u')
  expect(remoteLine('windows', ['x'], undefined, { A: 'a&calc' })).toBe('set A=acalc&& x')
})

test('S-d (F-d4): unit: the compact line gains a hand-off part only while a hand-off of this session needs a person', () => {
  const facts: LineFacts = { lock: undefined, me8: 'ab12cd34', nowMin: 600, place: '', isMine: false, justGranted: false, stopped: 0, freeGb: 30, nopieGb: 28, syncFile: null, phase: 'none', shortNow: () => '', behind: 0, ink: '#fff', handoffs: '' }
  const keys = (f: LineFacts) => lineParts(f, () => null).map(p => `${p.key}:${p.value}:${p.isWarn}`)
  expect(keys(facts)).toEqual(['editor:?:true', 'memory:30 GB:false', 'main:0:false'])
  expect(keys({ ...facts, handoffs: '1 lost' })).toEqual(['editor:?:true', 'memory:30 GB:false', 'main:0:false', 'handoff:1 lost:true'])
})

test('S-d (F-d8): unit: the ssh adapter reads a Windows file by a backslash path (cmd type refuses forward slashes); POSIX keeps it', async () => {
  const lines: string[] = []
  const proc = async (argv: readonly string[]) => {
    const line = argv[argv.length - 1] ?? ''
    lines.push(line)
    return { exitCode: 0, stdout: /^(for |wc )/.test(line) ? '7\r\n' : '{"a":1}', stderr: '' }
  }
  const win = sshAdapter('f20', {}, proc, { os: 'windows', shell: 'cmd' })
  expect(await win.readFile?.('C:/s2-lanes/lane-a/S2.uproject')).toEqual({ ok: true, value: '{"a":1}' })
  expect(lines).toEqual([String.raw`for %I in (C:\s2-lanes\lane-a\S2.uproject) do @echo %~zI`, String.raw`type C:\s2-lanes\lane-a\S2.uproject`])
  const nix = sshAdapter('pc', {}, proc, { os: 'posix', shell: 'sh' })
  await nix.readFile?.('/srv/s2/a.json')
  expect(lines.slice(2)).toEqual(['wc -c < /srv/s2/a.json', 'cat /srv/s2/a.json'])
})
