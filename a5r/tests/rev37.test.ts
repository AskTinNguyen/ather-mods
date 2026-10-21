import { expect, test } from 'claude-code/testing'
import { under } from '../hooks/a5r.ts'
import { buildScriptText } from '../hooks/buildscript.ts'
import { parseSyncFile, syncWorkerTask, newSync, type SyncFile } from '../hooks/coord.ts'
import { NO_CHECKOUT, buildBatOf, checkoutOf, commonDirArgv, editorLogs, engineAssociation, engineLabel, engineOfLog, lockIn, mainTreeOf, pickEngine, registryQueries, registryRoot, rootOfLock, uprojectIn } from '../hooks/machine.ts'
import { machinePathHits } from './machine-paths.ts'
import { A5RPANE, ME, NOW, find, text, world, type Rec } from './world.ts'

// Rev 37 (L-41, Hai: "the plugin must work on many machines; a hard path breaks the others"). A110: the engine root for the
// sync's build is found on the machine (the option, the Editor's last log, the registry; the first with a Build.bat).
// A111: no machine path in the plugin: with editorLock unset the checkout is the main working tree of the session's own
// repository when it holds a .uproject; outside any checkout the coordination is idle and says how to point it at one.
const EDITOR = 'mcp__a5r__editor'
const SYNC_TOOL = 'mcp__a5r__sync'
const COMMON = '--git-common-dir'
const UNSET = { timeoutMs: 30_000, options: { a5rWhenPresent: 'deny' } } // no editorLock: the checkout is found
const S2_LOCK = 'E:/s2/Saved/EDITOR_OWNER.txt'
const HF = 'E:/s2/Saved/A5R'
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const MIN = 60_000
const ID = 'sync-20261006-1445-ab12cd34'
const SCRIPT = `${HF}/${ID}-build.cmd`
const ENGINE = 'D:/GameEditors/5.8-ninetails-ed5c054'
const GUID = '{ED5C0549-1350-26D4-59AD-3BA427017BA4}'
const start = (cwd: string) => ({ cwd, surface: 'terminal', isInteractive: true }) as never
const out = (ran: { result?: unknown; text?: string; deny?: string }): string => String(ran.deny ?? ran.result ?? ran.text ?? '')
const idle = async ($: any) => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
type W = ReturnType<typeof world>
const task = (w: W): string => String(((w.calls['agent.spawn'] ?? [])[0] as Rec | undefined)?.prompt ?? '')
const syncOf = (w: W): SyncFile | null => parseSyncFile(w.read(`${HF}/sync.json`) || null)
const prompts = (w: W): string[] => (w.calls['prompt.submit'] ?? []).map(e => String((e as Rec).text))
/** Every path the session wrote that is not under a drive (a write at a drive root through an empty checkout would be). */
const rootless = (w: W): string[] => [...w.files.keys()].filter(p => !/^[a-z]:\//.test(p))

// ---------- unit ----------
test('A111: unit: the main working tree from git\'s common dir (a worktree leads to it), the .uproject at a folder\'s root only, the lock in it, the hint', () => {
  expect(commonDirArgv('E:/s2-wt/feat')).toEqual(['git', '-C', 'E:/s2-wt/feat', 'rev-parse', '--path-format=absolute', '--git-common-dir'])
  expect([mainTreeOf('E:/Projects/s2/.git\n'), mainTreeOf('E:\\Projects\\s2\\.git'), mainTreeOf('/home/hai/s2/.git/'), mainTreeOf('E:/s2/.git/modules/sub'), mainTreeOf('E:/bare.git'), mainTreeOf(''), mainTreeOf('D:/my games/s 2/.git')]).toEqual(['E:/Projects/s2', 'E:/Projects/s2', '/home/hai/s2', '', '', '', 'D:/my games/s 2'])
  expect(uprojectIn([{ name: 'Saved', kind: 'dir' }, { name: 'S2.uproject', kind: 'file' }])).toBe('S2.uproject')
  expect(uprojectIn([{ name: 'Unreal', kind: 'dir' }, { name: 'README.md', kind: 'file' }])).toBe('') // a project in a subfolder is not the checkout
  expect(lockIn('E:/s2')).toBe(S2_LOCK)
  expect(rootOfLock('E:\\Projects\\s2\\Saved\\EDITOR_OWNER.txt')).toBe('E:/Projects/s2')
  const listing = [{ name: 'S2.uproject', kind: 'file' }]
  expect(checkoutOf('', 'E:/s2', listing)).toEqual({ root: 'E:/s2', lock: S2_LOCK, uproject: 'S2.uproject' })
  expect([checkoutOf('', 'E:/s2', []), checkoutOf('', '', listing)]).toEqual([null, null])
  // The option names the checkout wherever it points, a folder without a .uproject (or not on this machine) included.
  expect(checkoutOf('F:/elsewhere/Saved/EDITOR_OWNER.txt', 'F:/elsewhere', [])).toEqual({ root: 'F:/elsewhere', lock: 'F:/elsewhere/Saved/EDITOR_OWNER.txt', uproject: '' })
  // No checkout found: its folder is '', which holds nothing (a posix path starts with '/' and used to count as inside it).
  expect([under('/home/hai/app', ''), under('E:/s2/Source', ''), under('E:/s2/Source', 'E:/s2'), under('E:/s2', 'E:/s2/')]).toEqual([false, false, true, true])
  expect(NO_CHECKOUT.next).toBe('set the a5r option editorLock to <checkout>/Saved/EDITOR_OWNER.txt')
})

test('A110: unit: the log line (the last one, any platform folder, a timestamp before it), the Editor\'s own logs newest first, the association, the registry, the order', () => {
  const line = (root: string, platform = 'Win64') => `[2026.10.21-02.31.00:123][  0]LogInit: Base Directory: ${root}/Engine/Binaries/${platform}/\r`
  expect(engineOfLog(`LogInit: Display: x\n${line('D:/Old')}\nLog\n${line(ENGINE)}\nLogInit: Base Directory is fine\n`)).toBe(ENGINE)
  expect(engineOfLog(line('/opt/UE 5.8', 'Linux'))).toBe('/opt/UE 5.8')
  expect(engineOfLog('LogInit: Base Directory: D:\\GameEditors\\UE_5.8\\Engine\\Binaries\\Win64\\')).toBe('D:/GameEditors/UE_5.8')
  expect([engineOfLog(''), engineOfLog('LogInit: Base Directory: D:/x/Binaries/Win64/')]).toEqual([null, null])
  const entries = [
    { name: 'S2-backup-2026.10.20-13.06.51.log', kind: 'file', mtimeMs: 3 },
    { name: 'S2.log', kind: 'file', mtimeMs: 9 },
    { name: 'cef3.log', kind: 'file', mtimeMs: 10 },
    { name: 'HeadlessTests_20261012.log', kind: 'file', mtimeMs: 11 },
    { name: 'S2-backup-2026.10.20-12.00.00.log', kind: 'file', mtimeMs: 1 },
    { name: 'S2.log', kind: 'dir', mtimeMs: 12 },
  ]
  expect(editorLogs(entries, 'S2.uproject')).toEqual(['S2.log', 'S2-backup-2026.10.20-13.06.51.log', 'S2-backup-2026.10.20-12.00.00.log'])
  expect(editorLogs(entries, '')).toEqual([])
  expect([engineAssociation(`{ "FileVersion": 3, "EngineAssociation": "${GUID}" }`), engineAssociation('{ "EngineAssociation": "5.7" }'), engineAssociation('{}'), engineAssociation('not json')]).toEqual([GUID, '5.7', '', ''])
  expect(registryQueries(GUID)).toEqual([['reg', 'query', 'HKCU\\Software\\Epic Games\\Unreal Engine\\Builds'], ['reg', 'query', 'HKLM\\Software\\Epic Games\\Unreal Engine\\Builds']])
  expect(registryQueries('5.7')).toEqual([['reg', 'query', 'HKLM\\SOFTWARE\\EpicGames\\Unreal Engine\\5.7', '/v', 'InstalledDirectory']])
  expect([registryQueries(''), registryQueries('../x')]).toEqual([[], []])
  // MEASURED on one machine (2026-10-21): the registry holds a GUID that is not the one the .uproject names.
  const builds = '\r\nHKEY_CURRENT_USER\\Software\\Epic Games\\Unreal Engine\\Builds\r\n    {8EDEED77-4353-DAEE-0DA9-11B18745C69B}    REG_SZ    D:/GameEditors/5.8-ninetails-ed5c054\r\n'
  expect(registryRoot(GUID, builds)).toBeNull()
  expect(registryRoot('{8edeed77-4353-daee-0da9-11b18745c69b}', builds)).toBe(ENGINE)
  expect(registryRoot('5.7', '    InstalledDirectory    REG_SZ    C:\\Program Files\\Epic Games\\UE_5.7\r\n')).toBe('C:/Program Files/Epic Games/UE_5.7')
  expect(buildBatOf('D:/E/')).toBe('D:/E/Engine/Build/BatchFiles/Build.bat')
  // The order: the first source with a root whose Build.bat exists; the ones passed over are named.
  const src = (from: string, root: string | null, hasBat: boolean) => ({ from, root, hasBat })
  expect(pickEngine([src('option', 'D:/A', true), src('log', 'D:/B', true), src('registry', 'D:/C', true)])).toEqual({ root: 'D:/A', from: 'option', tried: [] })
  expect(pickEngine([src('option', null, false), src('log', 'D:/B', true), src('registry', 'D:/C', true)])).toEqual({ root: 'D:/B', from: 'log', tried: [] })
  expect(pickEngine([src('option', 'D:/A', false), src('log', null, false), src('registry', 'D:/C', true)])).toEqual({ root: 'D:/C', from: 'registry', tried: ['option names D:/A, which has no Engine/Build/BatchFiles/Build.bat'] })
  const none = pickEngine([src('option', null, false), src('log', 'D:/B', false), src('registry', null, false)])
  expect(none).toEqual({ root: null, tried: ['option: none', 'log names D:/B, which has no Engine/Build/BatchFiles/Build.bat', 'registry: none'] })
  expect(engineLabel(none)).toBe('no engine root found: option: none; log names D:/B, which has no Engine/Build/BatchFiles/Build.bat; registry: none')
  expect(engineLabel({ root: 'D:/C', from: 'registry', tried: ['option names D:/A, …'] })).toBe('D:/C (from registry; passed over: option names D:/A, …)')
  // The build target follows the checkout's .uproject (Unreal's naming: <project>Editor).
  const lyra = buildScriptText('D:/games/Lyra', 'Lyra.uproject', 'D:/games/Lyra/Saved/A5R/x-build.log', ENGINE).split('\r\n')
  expect(lyra).toContain('set "PROJECT=D:\\games\\Lyra\\Lyra.uproject"')
  expect(lyra).toContain('call "%BAT%" LyraEditor Win64 Development -Project="%PROJECT%" -WaitMutex > "%LOG%" 2>&1')
  const s: SyncFile = { ...newSync(T(14, 45), { session: ME, id8: ME.slice(0, 8), lane: 'x' }, 'x', NOW, true), buildRun: '' }
  expect(syncWorkerTask(s, 'E:/s2', '', none)).toContain(`Build: yes, but A5R wrote no build script (${engineLabel(none)}): start no build, and end with SYNC MERGED <merge sha> build-log=none.`)
})

test('A111: unit: the scan rule: a drive-letter path only in a comment labelled as an example (hooks), a labelled line (rules), never an option default', () => {
  const code = ['const LOCK = \'E:/Projects/s2/Saved/EDITOR_OWNER.txt\'', '  alt: \'a worktree (D:\\\\Projects\\\\x)\',', '// the checkout E:/Projects/s2', ' * e.g. `E:/s2` → `E--s2`', '// for example C:/x', 'const u = \'https://github.com/a/b\'', 'const r = /^[a-zA-Z]:[\\\\/]/', 'foo(\'C:/x\') // e.g. a code line with a comment']
  expect(machinePathHits('hooks/x.ts', code.join('\n'))).toEqual([
    'hooks/x.ts:1: const LOCK = \'E:/Projects/s2/Saved/EDITOR_OWNER.txt\'',
    'hooks/x.ts:2: alt: \'a worktree (D:\\\\Projects\\\\x)\',',
    'hooks/x.ts:3: // the checkout E:/Projects/s2',
    'hooks/x.ts:8: foo(\'C:/x\') // e.g. a code line with a comment',
  ])
  expect(machinePathHits('rules/rules-a5r.md', 'Work in E:/Projects/s2.\nA lock, e.g. E:/s2/Saved/EDITOR_OWNER.txt.')).toEqual(['rules/rules-a5r.md:1: Work in E:/Projects/s2.'])
  expect(machinePathHits('.claude-plugin/plugin.json', JSON.stringify({ userConfig: { editorLock: { type: 'string', default: 'E:/Projects/s2/Saved/EDITOR_OWNER.txt' }, motion: { default: 'on' }, engineRoot: { description: 'e.g. D:/x' } } }))).toEqual(['.claude-plugin/plugin.json: option editorLock default E:/Projects/s2/Saved/EDITOR_OWNER.txt'])
  expect(machinePathHits('README.md', 'E:/Projects/s2')).toEqual([]) // the README is read by hand (placeholders and labelled examples)
  expect(machinePathHits('tests/world.ts', 'const LOCK = \'E:/s2/Saved/EDITOR_OWNER.txt\'')).toEqual([])
})

// ---------- engine: the checkout (A111) ----------
test('A111: editorLock unset, a session in an Unreal checkout: that checkout coordinates (its lock, its Saved/A5R)', UNSET, async ($, on) => {
  const w = world(on, { cwd: 'E:/s2', ram: '40', git: { [COMMON]: { stdout: 'E:/s2/.git\n' } } })
  on('turn.complete', async () => ({ text: '' }))
  w.put(S2_LOCK, 'free since 14:20\n')
  await $.session.start(start('E:/s2'))
  expect(w.runs.filter(r => r.includes(COMMON))).toEqual(['git -C E:/s2 rev-parse --path-format=absolute --git-common-dir'])
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'tail VFX' } as never))).toContain('granted to this session until 15:00')
  expect(w.read(S2_LOCK)).toContain(ME.slice(0, 8))
  expect(w.read(`${HF}/editor/${ME.slice(0, 8)}.json`)).not.toBe('')
  expect(rootless(w)).toEqual([])
  await idle($)
  await $.ui.render(A5RPANE as never)
  expect(w.runs.filter(r => r.includes(COMMON)).length).toBe(1) // found once, never per call
})

test('A111: in a linked worktree of the checkout: the main tree is the checkout, never the worktree', UNSET, async ($, on) => {
  const w = world(on, { cwd: 'E:/s2-wt/feat', ram: '40', git: { [COMMON]: { stdout: 'E:/s2/.git\n' } } })
  w.put('E:/s2-wt/feat/S2.uproject', '{}')
  w.put('E:/s2-wt/feat/.git', 'gitdir: E:/s2/.git/worktrees/feat')
  w.put(S2_LOCK, 'free since 14:20\n')
  await $.session.start(start('E:/s2-wt/feat'))
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'tail VFX' } as never))).toContain('granted to this session until 15:00')
  expect(w.read(S2_LOCK)).toContain(ME.slice(0, 8))
  expect([...w.files.keys()].some(p => p.startsWith('e:/s2-wt/feat/saved'))).toBe(false)
})

test('A111: outside any Unreal checkout: the Editor and Sync tools and the panel say how to point A5R at one; the five rules still apply; nothing is written at a drive root', UNSET, async ($, on) => {
  const w = world(on, { cwd: 'D:/tools/app', git: { [COMMON]: { stdout: 'D:/tools/app/.git\n' } } })
  w.put('D:/tools/app/.git/HEAD', 'ref: refs/heads/main')
  w.put('D:/tools/app/README.md', 'x')
  await $.session.start(start('D:/tools/app'))
  const hint = `${NO_CHECKOUT.why} → ${NO_CHECKOUT.next}`
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'x' } as never))).toBe(`A5R · Editor — ${hint}`)
  expect(out(await $.tool.call({ tool: SYNC_TOOL, action: 'status' } as never))).toContain(`A5R · Sync main — ${hint}`)
  expect(text(find(await $.ui.render(A5RPANE as never), 'hai-a5r-nos2'))).toBe(`Coordination is idle here: ${NO_CHECKOUT.why}. To point it at a checkout, ${NO_CHECKOUT.next}. The five rules still apply.`)
  expect(out(await $.tool.call({ tool: 'Bash', command: 'git commit --no-verify -m x' } as never))).toContain('--no-verify') // rule 1 stands
  expect(out(await $.tool.call({ tool: 'Bash', command: 'git push --force-with-lease origin HEAD:feature' } as never))).not.toContain('the shared checkout') // no shared branch to guard
  expect(rootless(w)).toEqual([])
  expect([...w.files.keys()].some(p => p.includes('/saved/a5r'))).toBe(false)
})

test('A111: outside any checkout the rules\' own records still work: a PR scored after the fact claims its alert in A5R\'s folder under TEMP, never at a drive root', UNSET, async ($, on) => {
  const STATUS_TOOL = 'mcp__ather-automata__status'
  const INTENT = 'D:/mods/docs/intent/tail-vfx'
  const status = JSON.stringify({ me: 'hai', role: 'techart', tracked: { slug: 'tail-vfx', stage: 'Build', prs: [], directorCalls: [] }, evidence: { pie: { state: 'pass' }, editor: { state: 'pass' } } })
  const progress = (pr: string) => ['# tail-vfx: Progress', '', `- PR: ${pr}`, '', '## Acceptance', '| Item | Verdict | Evidence |', '| --- | --- | --- |', '| A1 | met | PIE: glow visible |'].join('\n')
  const view = { stdout: JSON.stringify({ headRefName: 'tail-glow', baseRefName: 'main', state: 'OPEN' }) }
  const DIRTY = { stdout: '+++ b/Source/S2/Tail/Glow.cpp\n+float Glow = 1.f; // A5TMP\n' }
  const w = world(on, { cwd: 'D:/mods', out: { [STATUS_TOOL]: status }, git: { [COMMON]: { stdout: 'D:/mods/.git\n' }, 'pr view 812': view, 'diff --name-only': { stdout: 'Source/S2/Tail/Glow.cpp\n' }, 'diff -U0': DIRTY, 'worktree list': { stdout: '' } } })
  on('turn.complete', async () => ({ text: '' }))
  w.put('D:/mods/.git/HEAD', 'ref: refs/heads/main')
  w.put(`${INTENT}/prompt.md`, ['# Tail VFX', '- Rev: 2', '- Status: active', 'Change `Source/S2/Tail/` only.', '## Acceptance', '- A1: the tail glows. Proof: PIE.'].join('\n'))
  w.put(`${INTENT}/progress.md`, progress('none yet'))
  await $.session.start(start('D:/mods'))
  const read = async () => {
    await w.clock.advance(6 * MIN) // past the 5-min ship check: the pane's draw schedules the read
    await $.ui.render(A5RPANE as never)
    await w.clock.advance(20)
  }
  await read() // the first read records the numbers already listed
  w.put(`${INTENT}/progress.md`, progress('#812'))
  await read()
  await idle($)
  expect(prompts(w).some(p => p.includes('A5R · Acceptance — PR #812'))).toBe(true)
  expect(w.read('C:/Users/HAI~1.HUY/AppData/Local/Temp/a5r/alerts/pr2-812.json')).toContain('"scorer":2')
  expect(rootless(w)).toEqual([])
})

test('A111: a repository whose .uproject sits in a subfolder is not taken for a checkout (idle, with the hint)', UNSET, async ($, on) => {
  const w = world(on, { cwd: 'D:/game', git: { [COMMON]: { stdout: 'D:/game/.git\n' } } })
  w.put('D:/game/Unreal/Game.uproject', '{}')
  await $.session.start(start('D:/game'))
  expect(out(await $.tool.call({ tool: EDITOR, action: 'status' } as never))).toContain(NO_CHECKOUT.why)
})

test('A111: the option set: the option\'s checkout, and no git call to find one', { timeoutMs: 30_000, options: { a5rWhenPresent: 'deny', editorLock: S2_LOCK } }, async ($, on) => {
  const w = world(on, { cwd: 'D:/tools/app', ram: '40' })
  w.put(S2_LOCK, 'free since 14:20\n')
  await $.session.start(start('D:/tools/app'))
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'tail VFX' } as never))).toContain('granted to this session until 15:00')
  expect(w.runs.some(r => r.includes(COMMON))).toBe(false)
  // Its root holds no .uproject of the checkout: it does not coordinate itself (no tiles), and says where that happens.
  expect(text(find(await $.ui.render(A5RPANE as never), 'hai-a5r-nos2'))).toContain('This session is not in the checkout E:/s2')
})

test('A111: a hook that runs before the session start (a reload in the middle of a turn) still waits for the one find', UNSET, async ($, on) => {
  const w = world(on, { cwd: 'E:/s2', ram: '40', git: { [COMMON]: { stdout: 'E:/s2/.git\n' } } })
  w.put(S2_LOCK, 'free since 14:20\n')
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'tail VFX' } as never))).toContain('granted to this session until 15:00')
  expect(w.runs.filter(r => r.includes(COMMON)).length).toBe(1)
})

test('A111: git missing or slow at the start: idle; /a5r on looks again and the checkout then coordinates', UNSET, async ($, on) => {
  const git: Record<string, { stdout: string; deny?: string }> = { [COMMON]: { stdout: '', deny: 'spawn git ENOENT' } }
  const w = world(on, { cwd: 'E:/s2', ram: '40', git })
  w.put(S2_LOCK, 'free since 14:20\n')
  await $.session.start(start('E:/s2'))
  expect(out(await $.tool.call({ tool: EDITOR, action: 'status' } as never))).toContain(NO_CHECKOUT.why)
  git[COMMON] = { stdout: 'E:/s2/.git\n' }
  await $.command.run({ command: 'a5r', args: 'on' } as never)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 20, what: 'tail VFX' } as never))).toContain('granted to this session until 15:00')
  expect(w.runs.filter(r => r.includes(COMMON)).length).toBe(2)
})

// ---------- engine: the engine root (A110) ----------
/** This session's build sync at 14:45 in the checkout found from its cwd; `put` lays out the machine before the start. */
const atT = async ($: any, on: any, put: (w: W) => void, git: Record<string, { stdout: string }> = {}) => {
  const PRE = '9f8e7d6c0000'
  const w = world(on, { cwd: 'E:/s2', ram: '40', git: { [COMMON]: { stdout: 'E:/s2/.git\n' }, 'rev-parse HEAD': { stdout: `${PRE}\n` }, 'log -1 --format=%H %P HEAD': { stdout: `7b68b894 ${PRE} 1c153b41\n` }, ...git } })
  on('turn.complete', async () => ({ text: '' }))
  w.put('E:/s2/.git/HEAD', 'ref: refs/heads/HaiHuynh/20261005')
  w.put(S2_LOCK, 'free since 14:20\n')
  put(w)
  await $.session.start(start('E:/s2'))
  expect(String((await $.command.run({ command: 'a5r', args: 'sync 14:45 build' } as never)).text)).toContain('planned')
  await idle($)
  for (let k = 0; k < 5; k += 1) await w.clock.advance(MIN)
  expect(syncOf(w)?.workerAt).toBe(T(14, 45))
  return w
}
const bat = (w: W, root: string) => w.put(buildBatOf(root), '@echo off')
const log = (w: W, root: string, name = 'S2.log') => w.put(`E:/s2/Saved/Logs/${name}`, `LogInit: Base Directory: ${root}/Engine/Binaries/Win64/\n`)

test('A110: the option with its Build.bat comes first, before the log', { timeoutMs: 30_000, options: { a5rWhenPresent: 'deny', engineRoot: 'D:\\Eng\\Opt' } }, async ($, on) => {
  const w = await atT($, on, w => {
    bat(w, 'D:/Eng/Opt')
    bat(w, ENGINE)
    log(w, ENGINE)
  })
  expect(w.read(SCRIPT).split('\r\n')).toContain('set "ROOT=D:\\Eng\\Opt"')
  expect(task(w)).toContain('(the script builds with the engine root D:/Eng/Opt (from the a5r option engineRoot): pass no engine root of your own)')
})

test('A110: the option without a Build.bat is passed over: the Editor\'s last log decides', { timeoutMs: 30_000, options: { a5rWhenPresent: 'deny', engineRoot: 'D:/Wrong' } }, async ($, on) => {
  const w = await atT($, on, w => {
    bat(w, ENGINE)
    log(w, ENGINE)
  })
  expect(w.read(SCRIPT).split('\r\n')).toContain('set "ROOT=D:\\GameEditors\\5.8-ninetails-ed5c054"')
  expect(task(w)).toContain(`the engine root ${ENGINE} (from the Editor's last log (Saved/Logs/s2.log); passed over: the a5r option engineRoot names D:/Wrong, which has no Engine/Build/BatchFiles/Build.bat)`)
})

test('A110: no option and no log: the .uproject\'s EngineAssociation in the registry', UNSET, async ($, on) => {
  const reg = `\r\nHKEY_CURRENT_USER\\Software\\Epic Games\\Unreal Engine\\Builds\r\n    ${GUID}    REG_SZ    D:/Eng/Reg\r\n`
  const w = await atT($, on, w => {
    w.put('E:/s2/S2.uproject', JSON.stringify({ FileVersion: 3, EngineAssociation: GUID }))
    bat(w, 'D:/Eng/Reg')
  }, { 'reg query HKCU': { stdout: reg } })
  expect(w.runs).toContain('reg query HKCU\\Software\\Epic Games\\Unreal Engine\\Builds')
  expect(w.read(SCRIPT).split('\r\n')).toContain('set "ROOT=D:\\Eng\\Reg"')
  expect(task(w)).toContain(`the engine root D:/Eng/Reg (from the registry (s2.uproject EngineAssociation ${GUID}))`)
})

test('A110: no engine root anywhere: no script, the worker starts no build, and the holder is told to set engineRoot or build by hand', UNSET, async ($, on) => {
  const w = await atT($, on, () => undefined)
  expect(w.files.has(SCRIPT.toLowerCase())).toBe(false)
  expect(syncOf(w)?.buildRun).toBe('')
  expect(task(w)).toContain('Build: yes, but A5R wrote no build script (no engine root found: the a5r option engineRoot: none; the Editor\'s last log (Saved/Logs): none; the registry (s2.uproject EngineAssociation unset): none): start no build')
  await $.turn.complete({ agentId: 'w-sync', answer: 'SYNC MERGED 7b68b894 build-log=none', durationMs: 1, isAborted: false, turnId: 'tw', reason: 'answer' } as never)
  const wake = prompts(w).find(p => p.includes('its build did not start')) ?? ''
  expect(wake).toContain('Build.bat <project>Editor Win64 Development -Project="<checkout>\\<project>.uproject" -WaitMutex')
  expect(wake).toContain('A5R wrote no build script (the worker\'s task says why): when it found no engine root, set the a5r option engineRoot to the engine root that builds this checkout')
})
