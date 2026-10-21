import { expect, test } from 'claude-code/testing'
import { newSync, parseSyncEnd, parseSyncFile, SYNC_WORKER_PROMPT, syncWorkerTask, type SyncFile } from '../hooks/coord.ts'
import { buildScriptText, buildStartCommand, isScriptAlive, runLabel, syncBuildScript } from '../hooks/buildscript.ts'
// The real cmd half (the script started through PowerShell with a stand-in Build.bat) runs with node, as the test runner
// has no file system or processes: node --experimental-strip-types a5r/tests/build-script-smoke.mjs
import { afterWorker, entryTell, isQuietTell, logTell, readBuildLog, stageNext, syncBuildLog, tellKey } from '../hooks/syncstage.ts'
import { LOCK, ME, NOW, PROJ, opts, world, type Proc, type Rec } from './world.ts'

// Rev 36 (L-40, the sync conductor: the 16:50 build never started). MEASURED 2026-10-20 (sync 16:50, worker aa0ae3d3): the
// worker ran `Start-Process cmd.exe -ArgumentList '/c "…\Build.bat" S2Editor … > "…build.log" 2>&1'`; cmd /c strips the
// first and last quote of such a line, so cmd exited at once, no log was written, and A5R said "the build runs". A109: the
// build starts from a script A5R writes, with one exact command, checked within 60 s; A5R says the build runs only once
// its log or a build process is seen, and a build that did not start is told to the holder at once with that command.
const HF = 'E:/s2/Saved/A5R'
const SYNC = `${HF}/sync.json`
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const MIN = 60_000
const PRE = '9f8e7d6c0000'
const ID = 'sync-20261006-1445-ab12cd34'
const LOG = `${HF}/${ID}-build.log`
const SCRIPT = `${HF}/${ID}-build.cmd`
// Rev 37 (A110): the engine root is written into the script (found by A5R), so the command has no argument.
const RUN = `Start-Process -FilePath 'E:\\s2\\Saved\\A5R\\${ID}-build.cmd' -WindowStyle Hidden`
const ENGINE = 'D:\\GameEditors\\5.8-ninetails-ed5c054'
const ENGINE_FWD = 'D:/GameEditors/5.8-ninetails-ed5c054'
const UBT: Proc = { name: 'UnrealBuildTool', pid: 900, gb: 2, parentAlive: true }
/** The sync's own build script's cmd.exe, as the probe lists it (its command line kept). */
const SCRIPT_CMD: Proc = { name: 'cmd', pid: 950, gb: 0, parentAlive: false, cmd: `C:\\WINDOWS\\system32\\cmd.exe /c ""E:\\s2\\Saved\\A5R\\${ID}-build.cmd" "D:\\GameEditors\\5.8-ninetails-ed5c054""` }
type W = ReturnType<typeof world>
const prompts = (w: W): string[] => (w.calls['prompt.submit'] ?? []).map(e => String((e as Rec).text))
/** Every notice the session was given: its wake prompts and the context that rode the prompts Hai typed. */
const told = (w: W): string => (w.calls['prompt.submit'] ?? []).flatMap(e => [String((e as Rec).text), ...(((e as Rec).context as string[] | undefined) ?? [])]).join('\n')
const syncOf = (w: W): SyncFile | null => parseSyncFile(w.read(SYNC) || null)
const task = (w: W): string => String(((w.calls['agent.spawn'] ?? [])[0] as Rec | undefined)?.prompt ?? '')
const idle = async ($: any) => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
const typed = async ($: any) => $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } } as never)
const workerEnds = async ($: any, answer: string) => $.turn.complete({ agentId: 'w-sync', answer, durationMs: 1, isAborted: false, turnId: 'tw', reason: 'answer' } as never)
const minutes = async (w: W, n: number) => {
  for (let k = 0; k < n; k += 1) await w.clock.advance(MIN)
}
/** This session's sync at 14:45 (with a build unless `build` is false), planned at 14:40; at T its worker starts. */
/** `git`: the map the world answers process runs from (a test may add to it later, e.g. a failing probe). */
const atT = async ($: any, on: any, build = true, git: Record<string, { stdout: string; deny?: string }> = {}) => {
  const w = world(on, { ram: '40', git: Object.assign(git, { 'rev-parse HEAD': { stdout: `${PRE}\n` }, 'log -1 --format=%H %P HEAD': { stdout: `7b68b894 ${PRE} 1c153b41\n` } }) })
  on('turn.complete', async () => ({ text: '' }))
  w.put('E:/s2/.git/HEAD', 'ref: refs/heads/HaiHuynh/20261005')
  w.put(LOCK, 'free since 14:20\n')
  // Rev 37 (A110): the engine the checkout's Editor last ran with, from its log, with its Build.bat.
  w.put('E:/s2/Saved/Logs/S2.log', `LogInit: Base Directory: ${ENGINE_FWD}/Engine/Binaries/Win64/\n`)
  w.put(`${ENGINE_FWD}/Engine/Build/BatchFiles/Build.bat`, '@echo off')
  await $.session.start(START)
  expect(String((await $.command.run({ command: 'a5r', args: `sync 14:45${build ? ' build' : ''}` } as never)).text)).toContain('planned')
  await idle($)
  await minutes(w, 5)
  expect(syncOf(w)?.workerAt).toBe(T(14, 45))
  return w
}

// ---------- unit ----------
test('A109: unit: the build script: @echo off, the engine root written in (rev 37, A110: found by A5R; no argument form), Build.bat with -WaitMutex written fresh with > to the log, the exit line, CRLF', () => {
  const s2 = 'E:/Projects/s2'
  const log = syncBuildLog(s2, 'sync-20261020-1650-f41dc683')
  const text = buildScriptText(s2, 'S2.uproject', log, `${ENGINE_FWD}/`)
  expect(text.split('\r\n')[0]).toBe('@echo off')
  expect(text.endsWith('\r\n')).toBe(true)
  expect(text.replace(/\r\n/g, '').includes('\n')).toBe(false) // every line ends in CRLF
  const lines = text.split('\r\n')
  expect(lines).toContain('set "LOG=E:\\Projects\\s2\\Saved\\A5R\\sync-20261020-1650-f41dc683-build.log"')
  expect(lines).toContain('set "PROJECT=E:\\Projects\\s2\\S2.uproject"')
  // The root found, forward slashes and a trailing slash made Windows; no argument read, no "no engine root" branch.
  expect(lines).toContain(`set "ROOT=${ENGINE}"`)
  expect(text).not.toContain('%~1')
  expect(text).not.toContain('noroot')
  expect(lines).toContain('set "BAT=%ROOT%\\Engine\\Build\\BatchFiles\\Build.bat"')
  expect(lines).toContain('if not exist "%BAT%" goto nobat')
  // Build.bat's own output and errors go to a fresh log (`>`), never appended to; only the script's exit line follows.
  expect(lines).toContain('call "%BAT%" S2Editor Win64 Development -Project="%PROJECT%" -WaitMutex > "%LOG%" 2>&1')
  expect(lines.filter(l => l.includes('>>'))).toEqual(['>> "%LOG%" echo A5R build exit %ERRORLEVEL% (engine "%ROOT%")'])
  expect(lines.indexOf('>> "%LOG%" echo A5R build exit %ERRORLEVEL% (engine "%ROOT%")')).toBe(lines.findIndex(l => l.startsWith('call ')) + 1)
  expect(lines).toContain('> "%LOG%" echo A5R build refused: "%BAT%" does not exist (not an engine root)')
  expect(lines).not.toContain('goto badpath')
  // `%` is doubled in a literal; a checkout or root with `%` or `^` (which call would change) is refused in the log.
  const odd = buildScriptText('E:/a%b', 'S2.uproject', 'E:/a%b/Saved/A5R/x-build.log', ENGINE_FWD)
  expect(odd.split('\r\n')).toContain('set "LOG=E:\\a%%b\\Saved\\A5R\\x-build.log"')
  expect(odd.split('\r\n')).toContain('goto badpath')
  expect(buildScriptText('E:/s2', 'S2.uproject', 'E:/s2/x.log', 'D:/a^b').split('\r\n')).toContain('goto badpath')
  expect(buildScriptText('E:/my s2 & co', 'S2.uproject', 'E:/my s2 & co/x.log', 'D:/eng a&b').split('\r\n')).not.toContain('goto badpath') // spaces and & are plain inside quotes
})

test('A109: unit: the one start command, the log as A5R reads it, what the holder hears, the worker prompt and the task', () => {
  const script = syncBuildScript('E:/s2', ID)
  expect(script).toBe(SCRIPT)
  expect(buildStartCommand(script)).toBe(RUN)
  expect(buildStartCommand("E:/Hai's s2/Saved/A5R/x-build.cmd")).toBe("Start-Process -FilePath 'E:\\Hai''s s2\\Saved\\A5R\\x-build.cmd' -WindowStyle Hidden")
  expect(runLabel(RUN)).toBe(`this one PowerShell command: ${RUN}`)
  const logOf = (text: string | null) => readBuildLog(text, 1).log
  expect([logOf(null), logOf(''), logOf('Building 4127 actions...'), logOf('Building...\nA5R build exit 0 (engine "D:\\x")'), logOf('A5R build refused: no engine root'), logOf('Result: Succeeded\nA5R build exit 0'), logOf('Result: Failed (x)\nA5R build exit 0'), logOf('Using bundled DotNet SDK\nBuild.bat is already running, waiting for existing script to terminate...\n'), logOf('Build.bat is already running, waiting for existing script to terminate...\nBuilding S2Editor...')]).toEqual(['absent', 'running', 'running', 'ended', 'ended', 'Succeeded', 'Failed', 'queued', 'running'])
  expect(readBuildLog('a\n\nb\nc\nd\n', 7)).toEqual({ log: 'running', mtime: 7, isFinal: false, tail: '"b" | "c" | "d"' })
  expect([readBuildLog('Result: Failed (x)\n', 7).isFinal, readBuildLog('Result: Failed (x)\nA5R build exit 0 (engine "D:\\x")\n', 7).isFinal, readBuildLog(null, 0)]).toEqual([false, true, { log: 'absent', mtime: 0, isFinal: false, tail: '' }])
  expect([logTell('running'), logTell('queued'), logTell('ended'), logTell('absent'), logTell('Succeeded')]).toEqual(['building', 'build-queued', 'build-ended', null, null])
  // The watch (stageNext, building, the grace from stageAt 14:50): (the log, the script's cmd seen: true / false / null unread, the time).
  const st = { stage: 'building' as const, extended: false, hardEnd: T(16, 15), stageAt: T(14, 50) }
  const watch = (text: string | null, isScript: boolean | null, now: number) => stageNext(st, { log: readBuildLog(text, 9), isScript, isBusy: false, now }, 10 * MIN).tell
  expect([watch(null, false, T(14, 51)), watch(null, true, T(14, 53)), watch('Building...', true, T(14, 53)), watch('Building...', false, T(14, 51)), watch('Building...', false, T(14, 53)), watch('Building...', null, T(14, 53)), watch('Build.bat is already running, waiting for existing script to terminate...', true, T(14, 59)), watch('Build.bat is already running, waiting for existing script to terminate...', false, T(14, 53)), watch('A5R build refused: x', true, T(14, 51)), watch('Result: Failed (x)', true, T(14, 51)), watch('Result: Failed (x)', false, T(14, 51)), watch('Result: Failed (x)', null, T(14, 51)), watch('Result: Failed (x)\nA5R build exit 0', true, T(14, 51)), watch('Result: Succeeded', true, T(14, 51))]).toEqual([null, 'build-unknown', 'building', 'building', 'build-stopped', 'building', 'build-queued', 'build-stopped', 'build-ended', null, 'build-failed', null, 'build-failed', 'testing'])
  // At the worker's end: the stage's own notice; a building stage by its log (never by a process).
  const entry = (stage: 'building' | 'testing' | 'manual', isBuildNone = false) => ({ stage, mergeSha: 'x', note: 'x', isBuildNone })
  expect([entryTell(entry('manual'), 'absent'), entryTell(entry('testing'), 'absent'), entryTell(entry('building'), 'absent'), entryTell(entry('building'), 'running'), entryTell(entry('building'), 'queued'), entryTell(entry('building'), 'Succeeded'), entryTell(entry('building'), 'ended'), entryTell(entry('building', true), 'absent'), entryTell(entry('building', true), 'running')]).toEqual(['manual', 'testing', 'build-reported', 'building', 'build-queued', null, 'build-ended', 'build-unknown', 'building'])
  expect([isQuietTell('building'), isQuietTell('build-queued'), isQuietTell('build-reported'), isQuietTell('build-stopped'), isQuietTell('build-ended'), isQuietTell('build-unknown')]).toEqual([true, true, true, false, false, false])
  expect([tellKey('build-ended', 5), tellKey('build-stopped', 5), tellKey('build-failed', 5), tellKey('build-unknown', 0), tellKey('building', 5), tellKey('testing', 5)]).toEqual(['build-ended:5', 'build-stopped:5', 'build-failed:5', 'build-unknown', 'building', 'testing'])
  expect([isScriptAlive([{ name: 'cmd', cmd: `C:\\WINDOWS\\system32\\cmd.exe /c ""E:\\s2\\Saved\\A5R\\${ID}-build.cmd" "D:\\x""` }], ID), isScriptAlive([{ name: 'cmd', cmd: 'cmd /c "E:\\s2\\Saved\\A5R\\sync-20261006-0900-ab12cd34-build.cmd"' }], ID), isScriptAlive([{ name: 'dotnet' }, { name: 'UnrealBuildTool' }], ID), isScriptAlive(null, ID)]).toEqual([true, false, false, null])
  expect([afterWorker(parseSyncEnd('SYNC MERGED 7b68b894 build-log=none'), { state: 'merged', sha: '7b68b894' }, true), afterWorker(parseSyncEnd('SYNC MERGED 7b68b894 build-log=none'), { state: 'merged', sha: '7b68b894' }, false), afterWorker(parseSyncEnd(`SYNC MERGED 7b68b894 build-log=${LOG}`), { state: 'merged', sha: '7b68b894' }, true)]).toMatchObject([{ stage: 'building', isBuildNone: true }, { stage: 'testing', isBuildNone: false }, { stage: 'building', isBuildNone: false }])
  for (const must of ['Start the build only with the one PowerShell command your task gives, exactly as given', 'in a tool call of its own with nothing after it (a tool call stopped while it still runs kills what it started)', 'never your own cmd, Build.bat or redirection line', 'the build log\'s existence decides whether the build started', '`waiting for existing script to terminate` means it started and waits behind Build.bat\'s lock', 'No log after 60 seconds → start it no other way: end with `SYNC MERGED <merge sha> build-log=none`', 'the script carries the engine root your task names: use no engine root of your own'])
    expect(SYNC_WORKER_PROMPT).toContain(must)
  const s: SyncFile = { ...newSync(T(14, 45), { session: ME, id8: ME.slice(0, 8), lane: 'x' }, 'x', NOW, true), buildRun: RUN }
  expect(syncWorkerTask(s, 'E:/s2', '', null)).toContain(`Build: yes; build log: ${LOG}; start the build (after the merge commit) only with ${runLabel(RUN)}.`)
  expect(syncWorkerTask({ ...s, buildRun: '' }, 'E:/s2', '', null)).toContain('Build: yes, but A5R wrote no build script (the write failed): start no build, and end with SYNC MERGED <merge sha> build-log=none.')
  expect(syncWorkerTask({ ...s, build: false }, 'E:/s2', '', null)).toContain('Build: no.')
  // Rev 37 (A110): the task names the engine root the script carries and where A5R found it, or that it found none.
  const set = syncWorkerTask({ ...s, buildRun: buildStartCommand(SCRIPT) }, 'E:/s2', '', { root: ENGINE_FWD, from: 'the a5r option engineRoot', tried: [] })
  expect(set).toContain(`(the script builds with the engine root ${ENGINE_FWD} (from the a5r option engineRoot): pass no engine root of your own)`)
  expect(set).not.toContain('<engine root>')
})

// ---------- engine ----------
test('A109: at T the holder\'s A5R writes the build script before the worker starts; the task gives the one command (rev 37, A110: with the engine root found in the Editor\'s last log written in)', opts(), async ($, on) => {
  const w = await atT($, on)
  expect(w.read(SCRIPT)).toBe(buildScriptText('E:/s2', 's2.uproject', LOG, ENGINE_FWD))
  expect(syncOf(w)?.buildRun).toBe(RUN)
  expect(task(w)).toContain(`Build: yes; build log: ${LOG}; start the build (after the merge commit) only with this one PowerShell command: ${RUN} (the script builds with the engine root ${ENGINE_FWD} (from the Editor's last log (Saved/Logs/s2.log)): pass no engine root of your own).`)
})

test('A109: with the option engineRoot (its Build.bat there) the script carries that root and the command has no argument', { ...opts(), options: { ...opts().options, engineRoot: ENGINE } }, async ($, on) => {
  const w = await atT($, on)
  expect(w.read(SCRIPT).split('\r\n')).toContain(`set "ROOT=${ENGINE}"`)
  expect(syncOf(w)?.buildRun).toBe(RUN)
  expect(task(w)).toContain(`only with this one PowerShell command: ${RUN} (the script builds with the engine root ${ENGINE_FWD} (from the a5r option engineRoot): pass no engine root of your own).`)
  expect(task(w)).not.toContain('<engine root>')
})

test('A109: a sync without a build writes no script and its task says Build: no', opts(), async ($, on) => {
  const w = await atT($, on, false)
  expect(w.files.has(SCRIPT.toLowerCase())).toBe(false)
  expect(syncOf(w)?.buildRun).toBe('')
  expect(task(w)).toContain('Build: no.')
})

test('A109: SYNC MERGED with no log and no build process yet: "the worker reports it started the build", never "the build runs"; once the log appears, the build runs (no wake); its Result moves on', opts(), async ($, on) => {
  const w = await atT($, on)
  const before = prompts(w).length // the cutoff notice
  await workerEnds($, `SYNC MERGED 7b68b894 build-log=${LOG}`)
  expect(syncOf(w)?.stage).toBe('building')
  expect(prompts(w).slice(before)).toEqual([]) // nothing wakes the holder yet
  await typed($)
  expect(told(w)).toContain(`the merge 7b68b894 is in; the worker reports it started the build; A5R confirms when its log appears (${LOG}); every other session stays frozen`)
  expect(told(w)).not.toContain('the build runs')
  await idle($) // that turn ends: a notice that needs action would wake the session now
  w.put(LOG, 'Building 4127 actions...\n', w.clock.now())
  await minutes(w, 1)
  expect(prompts(w).slice(before)).toEqual(['go on']) // the confirmation wakes nobody
  await typed($)
  expect(told(w)).toContain(`the merge 7b68b894 is in and the build runs (log ${LOG})`)
  w.put(LOG, 'Building 4127 actions...\nResult: Succeeded\nA5R build exit 0 (engine "D:\\x")\n', w.clock.now())
  await minutes(w, 1)
  expect(syncOf(w)?.stage).toBe('testing')
})

test('A109 (review D2): the script\'s cmd alive with its log at the worker\'s end: the build runs; another lane\'s UnrealBuildTool with no log of this run: the worker\'s report only, and past the grace the holder is told the build did not start', opts(), async ($, on) => {
  const w = await atT($, on)
  w.machine.procs = [UBT]
  await minutes(w, 1) // the shared probe reads it
  await workerEnds($, `SYNC MERGED 7b68b894 build-log=${LOG}`)
  await typed($)
  expect(told(w)).toContain('the worker reports it started the build')
  expect(told(w)).not.toContain('the build runs')
  await idle($)
  await minutes(w, 3)
  expect(prompts(w).filter(p => p.includes('its build did not start: no log of this run')).length).toBe(1)
})

test('A109 (review D1/D2): the log written and the script\'s cmd alive: the build runs, quietly, past the grace too', opts(), async ($, on) => {
  const w = await atT($, on)
  w.machine.procs = [SCRIPT_CMD]
  w.put(LOG, 'Building 4127 actions...\n', w.clock.now())
  await minutes(w, 1)
  const before = prompts(w).length
  await workerEnds($, `SYNC MERGED 7b68b894 build-log=${LOG}`)
  await idle($)
  await minutes(w, 5)
  expect(prompts(w).slice(before)).toEqual([])
  await typed($)
  expect(told(w)).toContain(`the merge 7b68b894 is in and the build runs (log ${LOG})`)
})

test('A109 (review D1): the log stops with no Result and no exit line and the script\'s cmd is gone: past the grace a wake quotes the log\'s last lines (rev 35 woke after 2 min; 0.21.2 said "the build runs" until the hard end)', opts(), async ($, on) => {
  const w = await atT($, on)
  w.machine.procs = [SCRIPT_CMD]
  w.put(LOG, 'Using bundled DotNet SDK\nBuilding S2Editor...\n[12/4127] Compile Module.S2.cpp\n', w.clock.now())
  await minutes(w, 1)
  await workerEnds($, `SYNC MERGED 7b68b894 build-log=${LOG}`)
  w.machine.procs = [UBT] // the script was killed; another lane's UnrealBuildTool runs (never this sync's build)
  await idle($)
  await minutes(w, 1)
  expect(prompts(w).some(p => p.includes('stopped with no Result: line'))).toBe(false) // within the grace
  await minutes(w, 2)
  const wake = prompts(w).filter(p => p.includes(`the build log of the merge 7b68b894 (${LOG}) stopped with no Result: line and no exit line, and its script no longer runs`))
  expect(wake.length).toBe(1)
  expect(wake[0]).toContain('its last lines: "Using bundled DotNet SDK" | "Building S2Editor..." | "[12/4127] Compile Module.S2.cpp"')
  expect(wake[0]).toContain(`start it again with its script, this one PowerShell command`)
})

test('A109 (review of the fixes, C2): a process list that cannot be read never says the script is gone: no wake while the log runs', opts(), async ($, on) => {
  // The probe never answers in this session (a failed probe falls back to the last shared reading, so only a session that
  // has none sees no process list at all).
  const w = await atT($, on, true, { 'ConvertTo-Json': { stdout: '', deny: 'probe timed out' } })
  w.put(LOG, 'Building 4127 actions...\n', w.clock.now())
  await minutes(w, 1)
  await workerEnds($, `SYNC MERGED 7b68b894 build-log=${LOG}`)
  const before = prompts(w).length
  for (let k = 0; k < 5; k += 1) {
    w.put(LOG, `Building 4127 actions...\n[${k}/4127] Compile\n`, w.clock.now()) // the build goes on writing
    await idle($)
    await minutes(w, 1)
  }
  expect(prompts(w).slice(before).filter(p => p.includes('stopped with no Result: line'))).toEqual([])
})

test('A109 (review D1): behind Build.bat\'s lock (its wait line last, the script\'s cmd alive, no dotnet): queued, quiet, no wake past the grace', opts(), async ($, on) => {
  const w = await atT($, on)
  w.machine.procs = [SCRIPT_CMD]
  w.put(LOG, 'Build.bat is already running, waiting for existing script to terminate...\n', w.clock.now())
  await minutes(w, 1)
  const before = prompts(w).length
  await workerEnds($, `SYNC MERGED 7b68b894 build-log=${LOG}`)
  await idle($)
  await minutes(w, 5)
  expect(prompts(w).slice(before)).toEqual([])
  await typed($)
  expect(told(w)).toContain('started and waits for another Build.bat on this engine to end (Build.bat\'s lock')
  expect(syncOf(w)?.stage).toBe('building')
})

test('A109: the worker ends with build-log=none on a build sync: the holder is woken at once to start the script with the exact command (another lane\'s dotnet never masks it, nor says the build runs)', opts(), async ($, on) => {
  const w = await atT($, on)
  w.machine.procs = [{ name: 'dotnet', pid: 77, gb: 1, parentAlive: true }]
  await minutes(w, 1) // the shared probe reads it
  await workerEnds($, 'The build did not start: no log after 60 s.\nSYNC MERGED 7b68b894 build-log=none')
  expect(syncOf(w)?.stage).toBe('building') // still frozen: the merge is in
  const wake = prompts(w).filter(p => p.includes(`the merge 7b68b894 is in but its build did not start: no log of this run (${LOG})`))
  expect(wake.length).toBe(1)
  expect(wake[0]).toContain(`start the build yourself now with its script, this one PowerShell command: ${RUN} (A5R watches the log and wakes you at its Result: line)`)
  await minutes(w, 3) // past the grace: told once only
  expect(prompts(w).filter(p => p.includes('its build did not start')).length).toBe(1)
  await typed($)
  expect(told(w)).not.toContain('the build runs')
})

test('A109: the log never appears and no build process runs: past the 2-min grace the holder is told to start the script', opts(), async ($, on) => {
  const w = await atT($, on)
  await workerEnds($, `SYNC MERGED 7b68b894 build-log=${LOG}`)
  await minutes(w, 1)
  expect(prompts(w).some(p => p.includes('its build did not start'))).toBe(false)
  await minutes(w, 2)
  const wake = prompts(w).filter(p => p.includes('its build did not start: no log of this run'))
  expect(wake.length).toBe(1)
  expect(wake[0]).toContain(RUN)
})

test('A109 (review D4/D5): the script ended with no Result (its refusal): told at once with the log\'s lines, read before running again; the holder\'s own run that fails again is told again', opts(), async ($, on) => {
  const w = await atT($, on)
  w.put(LOG, 'A5R build refused: no engine root (set the a5r option engineRoot, or pass the engine root as the first argument)\n', w.clock.now())
  await workerEnds($, `SYNC MERGED 7b68b894 build-log=${LOG}`)
  const ended = (): string[] => prompts(w).filter(p => p.includes('the build script of the merge 7b68b894 ended without a Result: line'))
  expect(ended().length).toBe(1)
  expect(ended()[0]).toContain('its last lines: "A5R build refused: no engine root (set the a5r option engineRoot, or pass the engine root as the first argument)"')
  expect(ended()[0]).toContain('read the log first (a refusal names its cause')
  expect(ended()[0]).not.toContain('its build did not start')
  await idle($)
  await minutes(w, 2)
  expect(ended().length).toBe(1) // the same log: told once
  w.put(LOG, `A5R build refused: "D:\\GameEditors\\UE_5.8x\\Engine\\Build\\BatchFiles\\Build.bat" does not exist (not an engine root)\n`, w.clock.now()) // the holder ran it again
  await minutes(w, 1)
  expect(ended().length).toBe(2)
  expect(ended()[1]).toContain('does not exist (not an engine root)')
})

test('A109: a quick build whose Result was written after the worker started but before it ended counts (the log of this run)', opts(), async ($, on) => {
  const w = await atT($, on)
  w.put(LOG, 'Target is up to date\nResult: Succeeded\nA5R build exit 0 (engine "D:\\x")\n', T(14, 46))
  await minutes(w, 2) // the worker ends at 14:47, after the build
  await workerEnds($, `SYNC MERGED 7b68b894 build-log=${LOG}`)
  await minutes(w, 1)
  expect(syncOf(w)?.stage).toBe('testing')
})
