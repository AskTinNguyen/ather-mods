import { expect, test } from 'claude-code/testing'
import { newSync, parseSyncEnd, parseSyncFile, SYNC_WORKER_PROMPT, syncWorkerTask, type SyncFile } from '../hooks/coord.ts'
import { buildScriptText, buildStartCommand, ENGINE_ROOT_SLOT, runLabel, syncBuildScript } from '../hooks/buildscript.ts'
// The real cmd half (the script started through PowerShell with a stand-in Build.bat) runs with node, as the test runner
// has no file system or processes: node --experimental-strip-types a5r/tests/build-script-smoke.mjs
import { afterWorker, buildTell, entryTell, readBuildLog, syncBuildLog } from '../hooks/syncstage.ts'
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
const RUN = `Start-Process -FilePath 'E:\\s2\\Saved\\A5R\\${ID}-build.cmd' -ArgumentList '"<engine root>"' -WindowStyle Hidden`
const ENGINE = 'D:\\GameEditors\\5.8-ninetails-ed5c054'
const UBT: Proc = { name: 'UnrealBuildTool', pid: 900, gb: 2, parentAlive: true }
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
const atT = async ($: any, on: any, build = true) => {
  const w = world(on, { ram: '40', git: { 'rev-parse HEAD': { stdout: `${PRE}\n` }, 'log -1 --format=%H %P HEAD': { stdout: `7b68b894 ${PRE} 1c153b41\n` } } })
  on('turn.complete', async () => ({ text: '' }))
  w.put('E:/s2/.git/HEAD', 'ref: refs/heads/HaiHuynh/20261005')
  w.put(LOCK, 'free since 14:20\n')
  await $.session.start(START)
  expect(String((await $.command.run({ command: 'a5r', args: `sync 14:45${build ? ' build' : ''}` } as never)).text)).toContain('planned')
  await idle($)
  await minutes(w, 5)
  expect(syncOf(w)?.workerAt).toBe(T(14, 45))
  return w
}

// ---------- unit ----------
test('A109: unit: the build script: @echo off, the engine root from the option or its first argument, Build.bat with -WaitMutex written fresh with > to the log, the exit line, CRLF', () => {
  const s2 = 'E:/Projects/s2'
  const log = syncBuildLog(s2, 'sync-20261020-1650-f41dc683')
  const text = buildScriptText(s2, log)
  expect(text.split('\r\n')[0]).toBe('@echo off')
  expect(text.endsWith('\r\n')).toBe(true)
  expect(text.replace(/\r\n/g, '').includes('\n')).toBe(false) // every line ends in CRLF
  const lines = text.split('\r\n')
  expect(lines).toContain('set "LOG=E:\\Projects\\s2\\Saved\\A5R\\sync-20261020-1650-f41dc683-build.log"')
  expect(lines).toContain('set "PROJECT=E:\\Projects\\s2\\S2.uproject"')
  expect(lines).toContain('set "ROOT=%~1"')
  expect(lines).toContain('if not defined ROOT goto noroot')
  expect(lines).toContain('set "BAT=%ROOT%\\Engine\\Build\\BatchFiles\\Build.bat"')
  expect(lines).toContain('if not exist "%BAT%" goto nobat')
  // Build.bat's own output and errors go to a fresh log (`>`), never appended to; only the script's exit line follows.
  expect(lines).toContain('call "%BAT%" S2Editor Win64 Development -Project="%PROJECT%" -WaitMutex > "%LOG%" 2>&1')
  expect(lines.filter(l => l.includes('>>'))).toEqual(['>> "%LOG%" echo A5R build exit %ERRORLEVEL% (engine "%ROOT%")'])
  expect(lines.indexOf('>> "%LOG%" echo A5R build exit %ERRORLEVEL% (engine "%ROOT%")')).toBe(lines.findIndex(l => l.startsWith('call ')) + 1)
  expect(lines).toContain('> "%LOG%" echo A5R build refused: no engine root (set the a5r option engineRoot, or pass the engine root as the first argument)')
  expect(lines).toContain('> "%LOG%" echo A5R build refused: "%BAT%" does not exist (not an engine root)')
  expect(lines).not.toContain('goto badpath')
  // The option: written into the script (forward slashes and a trailing slash made Windows), no argument read.
  const set = buildScriptText(s2, log, 'D:/GameEditors/5.8-ninetails-ed5c054/')
  expect(set.split('\r\n')).toContain(`set "ROOT=${ENGINE}"`)
  expect(set).not.toContain('%~1')
  // `%` is doubled in a literal; a checkout or root with `%` or `^` (which call would change) is refused in the log.
  const odd = buildScriptText('E:/a%b', 'E:/a%b/Saved/A5R/x-build.log')
  expect(odd.split('\r\n')).toContain('set "LOG=E:\\a%%b\\Saved\\A5R\\x-build.log"')
  expect(odd.split('\r\n')).toContain('goto badpath')
  expect(buildScriptText('E:/s2', 'E:/s2/x.log', 'D:/a^b').split('\r\n')).toContain('goto badpath')
  expect(buildScriptText('E:/my s2 & co', 'E:/my s2 & co/x.log', 'D:/eng a&b').split('\r\n')).not.toContain('goto badpath') // spaces and & are plain inside quotes
})

test('A109: unit: the one start command, the log as A5R reads it, what the holder hears, the worker prompt and the task', () => {
  const script = syncBuildScript('E:/s2', ID)
  expect(script).toBe(SCRIPT)
  expect(buildStartCommand(script)).toBe(RUN)
  expect(buildStartCommand(script, ENGINE)).toBe(`Start-Process -FilePath 'E:\\s2\\Saved\\A5R\\${ID}-build.cmd' -WindowStyle Hidden`)
  expect(buildStartCommand("E:/Hai's s2/Saved/A5R/x-build.cmd", ENGINE)).toBe("Start-Process -FilePath 'E:\\Hai''s s2\\Saved\\A5R\\x-build.cmd' -WindowStyle Hidden")
  expect(runLabel(RUN)).toBe(`this one PowerShell command (put the engine root from the machine profile in place of ${ENGINE_ROOT_SLOT}): ${RUN}`)
  expect(runLabel('Start-Process -FilePath x')).toBe('this one PowerShell command: Start-Process -FilePath x')
  expect([readBuildLog(null), readBuildLog(''), readBuildLog('Building 4127 actions...'), readBuildLog('Building...\nA5R build exit 0 (engine "D:\\x")'), readBuildLog('A5R build refused: no engine root'), readBuildLog('Result: Succeeded\nA5R build exit 0'), readBuildLog('Result: Failed (x)\nA5R build exit 0')]).toEqual(['absent', 'running', 'running', 'ended', 'ended', 'Succeeded', 'Failed'])
  // (log, a build process, not started: the worker's build-log=none or the grace over)
  // (the log, not started: the worker's build-log=none, or no log and no build process past the grace)
  expect([buildTell('absent', false), buildTell('running', false), buildTell('absent', true), buildTell('ended', false), buildTell('running', true), buildTell('Succeeded', false), buildTell('Failed', true)]).toEqual([null, 'building', 'build-unknown', 'build-unknown', 'building', null, null])
  // At the worker's end: the stage's own notice; a building stage by what is seen of its build (log, a build process).
  const entry = (stage: 'building' | 'testing' | 'manual', isBuildNone = false) => ({ stage, mergeSha: 'x', note: 'x', isBuildNone })
  expect([entryTell(entry('manual'), 'absent', false), entryTell(entry('testing'), 'absent', false), entryTell(entry('building'), 'absent', false), entryTell(entry('building'), 'absent', true), entryTell(entry('building'), 'running', false), entryTell(entry('building'), 'Succeeded', true), entryTell(entry('building'), 'ended', true), entryTell(entry('building', true), 'absent', true), entryTell(entry('building', true), 'running', false)]).toEqual(['manual', 'testing', 'build-reported', 'building', 'building', null, 'build-unknown', 'build-unknown', 'building'])
  expect([afterWorker(parseSyncEnd('SYNC MERGED 7b68b894 build-log=none'), { state: 'merged', sha: '7b68b894' }, true), afterWorker(parseSyncEnd('SYNC MERGED 7b68b894 build-log=none'), { state: 'merged', sha: '7b68b894' }, false), afterWorker(parseSyncEnd(`SYNC MERGED 7b68b894 build-log=${LOG}`), { state: 'merged', sha: '7b68b894' }, true)]).toMatchObject([{ stage: 'building', isBuildNone: true }, { stage: 'testing', isBuildNone: false }, { stage: 'building', isBuildNone: false }])
  for (const must of ['Start the build only with the one PowerShell command your task gives, exactly as given', 'never your own cmd, Build.bat or redirection line', 'Within 60 seconds, check both that the build log exists and that a build process runs (dotnet, UnrealBuildTool, cl or link', 'or that the log already holds the build\'s `Result:` line (a quick build)','end with `SYNC MERGED <merge sha> build-log=none` and say in your report that the build did not start, with what you saw'])
    expect(SYNC_WORKER_PROMPT).toContain(must)
  const s: SyncFile = { ...newSync(T(14, 45), { session: ME, id8: ME.slice(0, 8), lane: 'x' }, 'x', NOW, true), buildRun: RUN }
  expect(syncWorkerTask(s, 'E:/s2', '')).toContain(`Build: yes; build log: ${LOG}; start the build (after the merge commit) only with ${runLabel(RUN)}.`)
  expect(syncWorkerTask({ ...s, buildRun: '' }, 'E:/s2', '')).toContain('Build: yes, but A5R could not write its build script: start no build, and end with SYNC MERGED <merge sha> build-log=none.')
  expect(syncWorkerTask({ ...s, build: false }, 'E:/s2', '')).toContain('Build: no.')
})

// ---------- engine ----------
test('A109: at T the holder\'s A5R writes the build script before the worker starts; the task gives the one command (the engine root slot while the option is unset)', opts(), async ($, on) => {
  const w = await atT($, on)
  expect(w.read(SCRIPT)).toBe(buildScriptText('E:/s2', LOG, ''))
  expect(syncOf(w)?.buildRun).toBe(RUN)
  expect(task(w)).toContain(`Build: yes; build log: ${LOG}; start the build (after the merge commit) only with this one PowerShell command (put the engine root from the machine profile in place of <engine root>): ${RUN}.`)
})

test('A109: with the option engineRoot the script carries the root and the command has no argument', { ...opts(), options: { ...opts().options, engineRoot: ENGINE } }, async ($, on) => {
  const w = await atT($, on)
  expect(w.read(SCRIPT).split('\r\n')).toContain(`set "ROOT=${ENGINE}"`)
  expect(syncOf(w)?.buildRun).toBe(`Start-Process -FilePath 'E:\\s2\\Saved\\A5R\\${ID}-build.cmd' -WindowStyle Hidden`)
  expect(task(w)).toContain(`only with this one PowerShell command: Start-Process -FilePath 'E:\\s2\\Saved\\A5R\\${ID}-build.cmd' -WindowStyle Hidden.`)
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

test('A109: a build process seen at the worker\'s end: the build runs at once', opts(), async ($, on) => {
  const w = await atT($, on)
  w.machine.procs = [UBT]
  await minutes(w, 1) // the shared probe reads the build
  await workerEnds($, `SYNC MERGED 7b68b894 build-log=${LOG}`)
  await typed($)
  expect(told(w)).toContain(`the merge 7b68b894 is in and the build runs (log ${LOG})`)
  expect(told(w)).not.toContain('the worker reports it started the build')
})

test('A109: the worker ends with build-log=none on a build sync: the holder is woken at once to start the script with the exact command (another lane\'s dotnet never masks it, nor says the build runs)', opts(), async ($, on) => {
  const w = await atT($, on)
  w.machine.procs = [{ name: 'dotnet', pid: 77, gb: 1, parentAlive: true }]
  await minutes(w, 1) // the shared probe reads it
  await workerEnds($, 'The build did not start: no log after 60 s, no UnrealBuildTool.\nSYNC MERGED 7b68b894 build-log=none')
  expect(syncOf(w)?.stage).toBe('building') // still frozen: the merge is in
  const wake = prompts(w).filter(p => p.includes('has no Result: line of this run: the build did not start (no log of this run), or its script ended without one'))
  expect(wake.length).toBe(1)
  expect(wake[0]).toContain(`start the build yourself now with its script, this one PowerShell command (put the engine root from the machine profile in place of <engine root>): ${RUN} (A5R watches the log and wakes you at its Result: line)`)
  await minutes(w, 3) // past the grace: told once only
  expect(prompts(w).filter(p => p.includes('the build did not start')).length).toBe(1)
  await typed($)
  expect(told(w)).not.toContain('the build runs')
})

test('A109: the log never appears and no build process runs: past the 2-min grace the holder is told to start the script; a log the script ended with no Result is told at once', opts(), async ($, on) => {
  const w = await atT($, on)
  await workerEnds($, `SYNC MERGED 7b68b894 build-log=${LOG}`)
  await minutes(w, 1)
  expect(prompts(w).some(p => p.includes('the build did not start'))).toBe(false)
  await minutes(w, 2)
  const wake = prompts(w).filter(p => p.includes('the build did not start (no log of this run)'))
  expect(wake.length).toBe(1)
  expect(wake[0]).toContain(RUN)
})

test('A109: the script refused (no engine root): its line in the log, no Result → the holder is told at once, before the grace', opts(), async ($, on) => {
  const w = await atT($, on)
  w.put(LOG, 'A5R build refused: no engine root (set the a5r option engineRoot, or pass the engine root as the first argument)\n', w.clock.now())
  await workerEnds($, `SYNC MERGED 7b68b894 build-log=${LOG}`)
  expect(prompts(w).filter(p => p.includes('the build did not start (no log of this run)')).length).toBe(1)
})

test('A109: a quick build whose Result was written after the worker started but before it ended counts (the log of this run)', opts(), async ($, on) => {
  const w = await atT($, on)
  w.put(LOG, 'Target is up to date\nResult: Succeeded\nA5R build exit 0 (engine "D:\\x")\n', T(14, 46))
  await minutes(w, 2) // the worker ends at 14:47, after the build
  await workerEnds($, `SYNC MERGED 7b68b894 build-log=${LOG}`)
  await minutes(w, 1)
  expect(syncOf(w)?.stage).toBe('testing')
})
