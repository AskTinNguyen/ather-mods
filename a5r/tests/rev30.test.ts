import { expect, test } from 'claude-code/testing'
import { A5R } from '../hooks/a5r.ts'
import { blankSession, decide, lapseOf, namesHolder, newSync, parseLockLine, releasedNote, resolveLock, type SessionFile } from '../hooks/coord.ts'
import { mcpCallKind } from '../hooks/editor.ts'
import { CONFIG } from './config.fixture.ts'
import { LOCK, ME, NOW, PROJ, opts, refused, world, type Proc } from './world.ts'

// Rev 30 (L-33), the review of 0.17.1: A84 a hand-written lock never deadlocks, A85 the kit's own checks run from
// anywhere, A86 A5R's own agents never fail a PR, A87 the merge guard names a step an agent can take, A88 three stalls.
const HF = 'E:/s2/Saved/A5R'
const SYNC = `${HF}/sync.json`
const ME8 = ME.slice(0, 8)
const EDITOR = 'mcp__a5r__editor'
const START = { cwd: PROJ, surface: 'terminal', isInteractive: true } as never
const MIN = 60_000
const D = (h: number, m: number) => new Date(2026, 9, 16, h, m).getTime()
const out = (ran: { result?: unknown; text?: string; deny?: string }): string => String(ran.deny ?? ran.result ?? ran.text ?? '')
const idle = async ($: any) => $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
const a5rCmd = async ($: any, args: string): Promise<string> => String((await $.command.run({ command: 'a5r', args } as never)).text)
const repo = (w: ReturnType<typeof world>, root: string) => w.put(`${root}/.git/HEAD`, 'ref: refs/heads/HaiHuynh/20261005')
const peer = (id8: string, o: Partial<SessionFile> = {}): string => JSON.stringify({ ...blankSession(`${id8}-1111-4000-8000-000000000000`, id8 === 'bbbbbbbb' ? 'sync-lane' : `lane-${id8}`, '', NOW), ...o })
const SAVE = { tool: 'mcp__unreal-mcp__call_tool', name: 'save_assets', arguments: { paths: ['/Game/X'] } }
/** Real time (the mock clock stands still): the runtime's timer, which the plugin types do not declare. */
const sleep = (ms: number): Promise<void> => new Promise(r => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => void }).setTimeout(r, ms))

// ---------- A84: the lock line written by hand on 2026-10-16 (MEASURED: E:/Projects/s2/Saved/EDITOR_OWNER.txt) ----------
const LINE = '\uFEFFheld by 9b53d3 (avian wing-kit: build + Sipher.WingKit tests + K1 ReadSkeleton + K3 FBX export, read-only on assets) since 10:36 until 13:06 2026-10-16. Launched -unattended -ModelContextProtocolStartServer -NoLiveCoding -DisablePlugins=S2TowerStair,S2KawaiiPhysicsMcpToolset,SipherArchGrammar. Nothing dirty expected. Editor PID 21832.\r\n'
const HOLDER = '9b53d3e1-2222-4000-8000-000000000000'
const UE: Proc = { name: 'UnrealEditor', pid: 21832, gb: 26, parentAlive: true }
const probe = (procs: Proc[]) => ({ freeGb: 40, diskGb: 50, procs })

test('A84: unit: the hand-written line is read for its holder (9b53d3, avian wing-kit), its dated end and its Editor PID; it lapses like a standard one', () => {
  const lock = parseLockLine(LINE)
  expect([lock.kind, lock.isStandard, lock.isReadable, lock.id8, lock.lane, lock.since, lock.end, lock.pid]).toEqual(['held', false, true, '9b53d3', 'avian wing-kit', '10:36 2026-10-16', '13:06', 21832])
  expect([namesHolder(lock, '9b53d3e1'), namesHolder(lock, ME8), namesHolder(lock, 'ffffffff', 'avian-wing-kit')]).toEqual([true, false, false]) // the id decides
  const holder = { ...blankSession(HOLDER, 'avian-wing-kit', 'avian wing-kit', D(11, 0)) }
  expect(resolveLock(lock, [holder], [], D(11, 0)).id8).toBe('9b53d3e1')
  expect(resolveLock(lock, [], [{ sessionId: HOLDER, hasEnded: false, mtimeMs: D(11, 0) }], D(11, 0)).id8).toBe('9b53d3e1')
  // Re-review (orchestrator): a holder that resolves to no session lapses 30 min past its end with nothing running.
  const x = { lock, files: [], lanes: [], waiting: [] }
  expect(lapseOf({ ...x, now: D(13, 36), probe: probe([]) })?.kind).toBe('lapsed') // past 13:06 + 30 min, PID 21832 gone
  expect(lapseOf({ ...x, now: D(13, 30), probe: probe([]) })).toBeNull() // inside the 30 min
  expect(lapseOf({ ...x, now: D(13, 40), probe: probe([UE]) })).toBeNull() // its Editor still runs
  expect(lapseOf({ ...x, now: D(13, 40), probe: probe([{ ...UE, pid: 4444, name: 'UnrealBuildTool' }]) })).toBeNull() // a build runs
  expect(lapseOf({ ...x, now: D(13, 40), probe: probe([{ ...UE, pid: 4445, name: 'UnrealEditor-Win64-DebugGame' }]) })).toBeNull() // any UnrealEditor* counts
  // A resolved holder: 10 min past its end once its session is gone; a live one (fresh heartbeat) keeps it.
  const known = resolveLock(lock, [holder], [], D(13, 20))
  expect(lapseOf({ ...x, files: [{ ...holder, heartbeatAt: D(13, 19) }], lock: known, now: D(13, 20), probe: probe([]) })).toBeNull()
  expect(lapseOf({ ...x, files: [{ ...holder, heartbeatAt: D(12, 0) }], lock: known, now: D(13, 20), probe: probe([]) })?.kind).toBe('lapsed')
  expect(releasedNote({ kind: 'lapsed', at: D(13, 36), by: '', since: D(10, 36), end: D(13, 6) }, lock)).toBe('hand-written lock by avian wing-kit (id 9b53d3) lapsed: past 13:06 + 30 min, nothing running (pid 21832 not running, no Editor or build)')
  // A line naming nobody: held until its end, or 2 h after it was written, then free when nothing runs.
  const blind = parseLockLine('editor busy - do not touch\n')
  expect([blind.kind, blind.isReadable]).toEqual(['held', false])
  expect(lapseOf({ ...x, lock: blind, writtenAt: D(11, 0), now: D(12, 59), probe: probe([]) })).toBeNull()
  expect(lapseOf({ ...x, lock: blind, writtenAt: D(11, 0), now: D(13, 0), probe: probe([]) })?.kind).toBe('lapsed')
  expect(lapseOf({ ...x, lock: blind, writtenAt: D(11, 0), now: D(13, 0), probe: probe([{ ...UE, pid: 9 }]) })).toBeNull()
  const timed = parseLockLine('testing the editor until 12:00, do not touch\n')
  expect(lapseOf({ ...x, lock: timed, writtenAt: D(9, 0), now: D(12, 0), probe: probe([]) })?.kind).toBe('lapsed')
})

test('A84 (re-review): the holder is only the token right after "held by" or an explicit session id; never an id elsewhere in the note', () => {
  const read = (l: string) => {
    const p = parseLockLine(l)
    return [p.id8, p.heldLane, p.end]
  }
  expect(read('held by walker since 10:00 until 11:00; yield request from 0e860966\n')).toEqual(['', 'walker', '11:00'])
  expect(read('held by walker (merging c15348341b29, ab12cd34 pending) until 11:00\n')).toEqual(['', 'walker', '11:00'])
  expect(read('held by 1009-loco-ab2 since 09:00 until 11:00\n')).toEqual(['', '1009-loco-ab2', '11:00'])
  expect(read(LINE)).toEqual(['9b53d3', '', '13:06'])
  expect(read('1006-x-s9 (worker) since 14:30, expected end 15:10. session ab12cd34\n')).toEqual(['ab12cd34', '', '15:10'])
  expect(parseLockLine('notes: build c15348341b29 for ab12cd34 until 12:00\n').isReadable).toBe(false)
  // A lane matching two live sessions resolves to none: nobody drives on the name alone.
  const two = [blankSession('aaaaaaaa-1', 'walker', 'walker', D(11, 0)), blankSession('cccccccc-1', 'walker', 'walker', D(11, 0))]
  expect(resolveLock(parseLockLine('held by walker until 12:00\n'), two, [], D(11, 0)).id8).toBe('')
  expect(resolveLock(parseLockLine('held by walker until 12:00\n'), two.slice(0, 1), [], D(11, 0)).id8).toBe('aaaaaaaa')
})

test('A84 (re-review): a lane matching two live sessions drives nothing on the name; a request converts it to a standard line when no other lease or named Editor runs', opts(), async ($, on) => {
  const w = world(on, { ram: '40', now: D(11, 0) })
  w.put(LOCK, 'held by walker since 10:00 until 12:00\n', D(10, 0))
  for (const id8 of ['aaaaaaaa', 'cccccccc']) w.put(`${HF}/editor/${id8}.json`, JSON.stringify({ ...blankSession(`${id8}-1111-4000-8000-000000000000`, 'walker', 'walker', D(11, 0)) }), D(11, 0))
  await $.session.start(START)
  const why = refused(await $.tool.call(SAVE as never)) ?? ''
  expect(why).toContain('names walker, which matches no single live session, so nobody drives the Editor on that name alone')
  expect(why).toContain(`call ${EDITOR} (action request): it turns the line into a standard HELD line for this session when no other A5R session holds a lease and no Unreal Editor of another lane (the PID the line names) is known to run`)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'tail VFX' } as never))).toContain('until 11:30')
  const lock = parseLockLine(w.read(LOCK))
  expect([lock.kind, lock.isStandard, lock.id8]).toEqual(['held', true, ME8])
})

test('A84 (re-review): no conversion while the Editor PID the hand line names runs; the request queues', opts(), async ($, on) => {
  const w = world(on, { ram: '40', now: D(11, 0), procs: [{ ...UE, pid: 555 }] })
  w.put(LOCK, 'held by walker since 10:00 until 12:00. Editor PID 555.\n', D(10, 0))
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'tail VFX' } as never))).toContain('walker holds the Editor until 12:00 (a hand-written line naming no single live session)')
  expect(w.read(LOCK)).toBe('held by walker since 10:00 until 12:00. Editor PID 555.\n')
})

test('A84: the holder 9b53d3 named by that exact line uses the Editor, releases it and re-takes it through the editor tool', opts(), async ($, on) => {
  const w = world(on, { ram: '40', now: D(11, 0), procs: [UE] })
  w.ids.current = HOLDER
  w.put(LOCK, LINE, D(10, 36))
  await $.session.start(START)
  expect(refused(await $.tool.call(SAVE as never))).toBeUndefined()
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30 } as never))).toContain('this session already holds the Editor until 13:06')
  const rel = out(await $.tool.call({ tool: EDITOR, action: 'release', note: 'wing-kit build done' } as never))
  expect(rel).toContain('released: FREE since=11:00 2026-10-16')
  expect(parseLockLine(w.read(LOCK)).kind).toBe('free')
  const again = out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'K3 FBX export' } as never))
  expect(again).toContain('until 11:30')
  const held = parseLockLine(w.read(LOCK))
  expect([held.kind, held.isStandard, held.id8, held.pid]).toEqual(['held', true, '9b53d3e1', 21832]) // the open Editor reused
})

test('A84: another session queues behind that exact line, is never told to edit the lock, and is granted once it lapses (past 13:06, PID 21832 gone)', opts(), async ($, on) => {
  const w = world(on, { ram: '40', now: D(11, 0), procs: [UE] })
  w.put(LOCK, LINE, D(10, 36))
  await $.session.start(START)
  const why = refused(await $.tool.call(SAVE as never)) ?? ''
  expect(why).toContain(`${EDITOR} (action request)`)
  expect(why).not.toMatch(/add 'session|write your slot|EDITOR_OWNER\.txt/)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'tail VFX' } as never))).toContain('avian wing-kit (session 9b53d3) holds the Editor until 13:06')
  while (w.clock.now() < D(13, 30)) {
    if (w.clock.now() >= D(12, 50)) w.machine.procs = [] // the avian lane closed its Editor
    await w.clock.advance(MIN)
  }
  expect(w.read(LOCK)).toBe(LINE) // 13:30: inside the 30 min past its end (its holder resolves to no session)
  while (w.clock.now() < D(13, 40)) await w.clock.advance(MIN)
  const lock = parseLockLine(w.read(LOCK))
  expect([lock.kind, lock.id8]).toEqual(['held', ME8])
  expect(w.read(`${HF}/orchestrate.log`)).toContain('hand-written lock by avian wing-kit (id 9b53d3) lapsed: past 13:06 + 30 min, nothing running')
  expect(w.runs.some(r => /Stop-Process|taskkill|kill\b/i.test(r))).toBe(false) // nothing closed or killed
})

test('A84: a line A5R cannot read is held for 2 h from when it was written, then freed with nothing running', opts(), async ($, on) => {
  const w = world(on, { ram: '40', now: D(11, 0) })
  w.put(LOCK, 'editor busy - do not touch\n', D(11, 0))
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'tail VFX' } as never))).toContain('holds the Editor')
  while (w.clock.now() < D(12, 55)) await w.clock.advance(MIN)
  expect(w.read(LOCK)).toBe('editor busy - do not touch\n')
  while (w.clock.now() < D(13, 5)) await w.clock.advance(MIN)
  expect(parseLockLine(w.read(LOCK)).id8).toBe(ME8)
  expect(w.read(`${HF}/orchestrate.log`)).toContain('unreadable hand-written lock (it names nobody): ended 13:00')
})

// ---------- A85: the kit's own checks run from anywhere (orchestrator after the re-review: an allow-list of readers) ----------
test('A85: unit: the kit\'s read-only checks run from any folder; everything else naming the live kit is refused', () => {
  const KIT = 'D:/Projects/ather-mods/a5r'
  const a5r = new A5R(CONFIG, { KIT, HOME: 'C:/Users/hai.huynh', USERPROFILE: 'C:/Users/hai.huynh', TEMP: 'C:/Users/HAI~1.HUY/AppData/Local/Temp', LOCALAPPDATA: 'C:/Users/hai.huynh/AppData/Local' })
  const pre = (c: string) => a5r.preShell(c, PROJ, {})?.key ?? null
  for (const c of [
    `claude plugin test ${KIT}`,
    `claude plugin validate ${KIT}`,
    `npx -y -p typescript@5.6 tsc -p ${KIT}`,
    `npx tsc --noEmit -p ${KIT}/tsconfig.json`,
    `tsc -p ${KIT}`,
    `bun test ${KIT}/tests`,
    `node --test ${KIT}/tests`,
    `git -C ${KIT} log -3 --oneline`,
    `git -C ${KIT} status`,
    `git -C ${KIT} diff HEAD~1`,
    `git -C ${KIT} show HEAD:a5r/hooks/editor.ts`,
    `node ${KIT}/tests/x.mjs`,
    `node --experimental-strip-types ${KIT}/tests/scan-old-names.mjs`,
    `rg -n lockProblem ${KIT}/hooks`,
    `grep -rn x ${KIT}/hooks`,
    `cat ${KIT}/rules/config.json`,
    `ls ${KIT}/hooks`,
    `head -5 ${KIT}/README.md`,
    `tail -5 ${KIT}/README.md`,
    `Get-Content ${KIT}/README.md`,
    `Select-String -Path ${KIT}/hooks/*.ts -Pattern x`,
    `claude plugin test ${KIT} > C:/tmp/a5r-test.txt`,
  ])
    expect([c, pre(c)]).toEqual([c, null])
  for (const c of [
    `robocopy C:/tmp/a5r ${KIT} /E`,
    `xcopy C:/tmp/a5r ${KIT} /E /Y`,
    `tar -C ${KIT} -xf C:/tmp/a5r.tar`,
    `curl -o ${KIT}/hooks/x.ts https://example.com/x.ts`,
    `Invoke-WebRequest https://example.com/x.ts -OutFile ${KIT}/hooks/x.ts`,
    `Expand-Archive C:/tmp/a5r.zip -DestinationPath ${KIT}`,
    `[IO.File]::WriteAllText('${KIT}/hooks/x.ts', '')`,
    `npm install --prefix ${KIT}`,
    `python ${KIT}/tests/make_fixture.py`,
    `node --import ${KIT}/hooks/x.mjs ${KIT}/tests/y.mjs`,
    `node ${KIT}/hooks/register.ts`,
    `cp x.ts ${KIT}/hooks/x.ts`,
    `claude plugin test ${KIT} > ${KIT}/out.txt`,
    `git -C ${KIT} commit -m x`,
    `node -e "require('fs').writeFileSync('${KIT}/x', '')"`,
    `rm ${KIT}/hooks/x.ts`,
    `sed -i s/a/b/ ${KIT}/rules/config.json`,
  ])
    expect([c, pre(c)]).toEqual([c, 'kit'])
  expect(a5r.preShell(`robocopy C:/tmp/a5r ${KIT} /E`, PROJ, {})?.why).toContain('A5R kit')
})

// ---------- A86: A5R's own agents never count against a PR ----------
const STATUS_TOOL = 'mcp__ather-automata__status'
const INTENT = `${PROJ}/docs/intent/tail-vfx`
const PROMPT = ['# Tail VFX', '- Rev: 2', '- Status: active', 'Change `Source/S2/Tail/` only.', '## Acceptance', '- A1: the tail glows. Proof: PIE.'].join('\n')
const MET = ['| Item | Verdict | Evidence |', '| --- | --- | --- |', '| A1 | met | PIE: glow visible |'].join('\n')
const status = JSON.stringify({ me: 'hai', role: 'techart', tracked: { slug: 'tail-vfx', directorCalls: [] }, evidence: { pie: { state: 'pass' }, editor: { state: 'pass' } } })
const PR = 'gh pr create --title "Tail glow" --body "## Verified\\nPIE ✓, Editor check ✓"'
const branch = {
  'diff --name-only': { stdout: 'Source/S2/Tail/Glow.cpp\ndocs/intent/tail-vfx/progress.md\n' },
  'diff -U0': { stdout: '+++ b/Source/S2/Tail/Glow.cpp\n+float Glow = 1.f;\n' },
  'worktree list': { stdout: `worktree ${PROJ}\nbranch refs/heads/HaiHuynh/tail-vfx\n` },
  'rev-parse --abbrev-ref HEAD': { stdout: 'HaiHuynh/tail-vfx\n' },
}
const prWorld = (on: any) => {
  const w = world(on, { out: { [STATUS_TOOL]: status }, git: branch })
  w.put(`${INTENT}/prompt.md`, PROMPT)
  w.put(`${INTENT}/progress.md`, MET)
  w.put(`${INTENT}/findings.md`, '# Findings\n')
  return w
}
const opened = (w: ReturnType<typeof world>) => w.seen.filter(e => e.tool === 'Bash' && String(e.command).startsWith('gh pr create')).length

test('A86: a running a5r:judge (or a5r:sync) does not fail rule 4 at a PR; any other running agent still does', opts(), async ($, on) => {
  const w = prWorld(on)
  w.agents.push({ id: 'w-judge-7', description: 'Judge avian', type: 'a5r:judge', status: 'running', spawnedBy: 'a5r' }, { id: 'w-sync-2', description: 'Sync main 15:30', type: 'a5r:sync', status: 'running', spawnedBy: 'a5r' })
  expect(refused(await $.tool.call({ tool: 'Bash', command: PR }))).toBeUndefined()
  expect(opened(w)).toBe(1)
  w.agents.push({ id: 'x-1', description: 'tail search', type: 'Explore', status: 'running', spawnedBy: 'engine' })
  expect(refused(await $.tool.call({ tool: 'Bash', command: PR }))).toContain('background agent still running: Explore: tail search')
})

// ---------- A87: the merge guard names a step an agent can take ----------
const B = { session: 'bbbbbbbb-1111-4000-8000-000000000000', id8: 'bbbbbbbb', lane: 'sync-lane' }
const COMMIT = 'git -C E:/s2 commit -m "wip: tail"'
test('A87: the merge guard\'s refusal names a doable step: a gone holder\'s merge is taken over and aborted; never "or Hai"', opts(), async ($, on) => {
  const w = world(on)
  repo(w, 'E:/s2')
  w.put('E:/s2/.git/MERGE_HEAD', '1a2b3c\n')
  w.put(SYNC, JSON.stringify({ ...newSync(new Date(2026, 9, 6, 14, 0).getTime(), B, 'sync-lane (session bbbbbbbb)', NOW - 60 * MIN), state: 'expired', endedAt: NOW - 10 * MIN, note: 'its holder is gone' }))
  w.put(`${HF}/editor/bbbbbbbb.json`, peer('bbbbbbbb', { heartbeatAt: NOW - 30 * MIN }), NOW - 30 * MIN) // gone
  await $.session.start(START)
  const why = refused(await $.tool.call({ tool: 'Bash', command: COMMIT })) ?? ''
  expect(why).toContain('→ its holder is gone: take it over with /a5r sync takeover (or the sync tool, action takeover), then run git -C E:/s2 merge --abort; until then no commit, reset or stash there')
  expect(why).not.toMatch(/Hai/)
  w.files.delete(SYNC.toLowerCase())
  const none = refused(await $.tool.call({ tool: 'Bash', command: COMMIT })) ?? ''
  expect(none).toContain('no sync is open (a merge left behind)')
  expect(none).toContain('its holder is gone (no sync on file): take it over with /a5r sync takeover')
  expect(none).not.toMatch(/Hai/)
})

// ---------- A88 (b): an Editor request never waits behind the holder's sync dry-run ----------
test('A88 (b): while the holder\'s cutoff dry-run (git merge-tree) is still running, its editor request answers at once', opts(), async ($, on) => {
  let release = () => {}
  const hold = new Promise<void>(r => {
    release = r
  })
  const w = world(on, { ram: '40', git: { 'merge-tree': { stdout: '7e4887eb85fc0a6b1638a284733984d7d06b39f5\n', exitCode: 0, hold } } })
  on('turn.complete', async () => ({ text: '' }))
  repo(w, 'E:/s2')
  w.put(LOCK, 'FREE since=14:00 2026-10-06 by=x note=none background=none · free since 14:00\n')
  await $.session.start(START)
  expect(await a5rCmd($, 'sync 15:30')).toContain('planned')
  await idle($)
  for (let n = 0; n < 20; n += 1) await w.clock.advance(MIN) // 15:00, the cutoff: the holder's dry-run starts
  for (let n = 0; n < 100 && !w.runs.some(r => r.includes('merge-tree')); n += 1) await sleep(10)
  expect(w.runs.some(r => r.includes('merge-tree'))).toBe(true)
  const answer = await Promise.race([
    $.tool.call({ tool: EDITOR, action: 'request', minutes: 10, what: 'quick check' } as never).then(out),
    sleep(3_000).then(() => 'STILL WAITING'),
  ])
  release()
  expect(answer).not.toBe('STILL WAITING')
  expect(answer).toContain('this session holds the Editor until 15:10')
  await sleep(50)
})

// ---------- A88 (c), orchestrator after the re-review: a failed RAM probe is never a blind pass nor a wait without a step ----------
const READ_CMD = 'powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB"'
const FREE = 'FREE since=14:00 2026-10-06 by=x note=none background=none · free since 14:00\n'
test('A88 (c): no RAM reading after a fresh retry: the launch waits with the step (read RAM, ask again with freeGb); the number given goes through the gate and is logged', opts(), async ($, on) => {
  const w = world(on, { git: { 'ConvertTo-Json': { stdout: '', deny: 'probe failed' } } })
  w.put(LOCK, FREE)
  await $.session.start(START)
  const ran = out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'tail VFX' } as never))
  expect(ran).toContain(`the RAM probe did not answer → read free RAM with ${READ_CMD} and call the editor tool request again with freeGb: <number>`)
  expect(parseLockLine(w.read(LOCK)).kind).toBe('free')
  const low = out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'tail VFX', freeGb: 12 } as never))
  expect(low).toContain('free RAM is 12 GB after cleanup, under the launch gate of 28 GB')
  expect(parseLockLine(w.read(LOCK)).kind).toBe('free')
  const ok = out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'tail VFX', freeGb: 36.4 } as never))
  expect(ok).toContain('until 15:10')
  expect(parseLockLine(w.read(LOCK)).id8).toBe(ME8)
  expect(w.read(`${HF}/orchestrate.log`)).toContain('rule=ram-supplied')
  expect(w.read(`${HF}/orchestrate.log`)).toContain('Editor launch: the RAM probe failed twice; the agent read 36.4 GB of RAM available')
})

test('A88 (c): the PIE check retries a failed probe once, then refuses with the step; a number given to the editor tool goes through the 5 GB gate', opts(), async ($, on) => {
  const w = world(on, { git: { '[math]::Round((Get-CimInstance': { stdout: '', deny: 'probe failed' } } })
  w.put(LOCK, `1006-me-s1 (this lane) since 14:30, expected end 15:10. session ${ME8}\n`)
  await $.session.start(START)
  const START_PIE = { tool: 'mcp__unreal-mcp__call_tool', name: 'McpPieToolset.StartPIE' }
  expect(refused(await $.tool.call(START_PIE as never))).toBe(`A5R · Editor lock — the RAM probe did not answer twice, so the 5 GB PIE start gate cannot be checked → read free RAM with ${READ_CMD} and give it to ${EDITOR} (action status, freeGb: <number>), then start PIE again`)
  expect(w.runs.filter(r => r.includes('[math]::Round((Get-CimInstance')).length).toBe(2)
  await $.tool.call({ tool: EDITOR, action: 'status', freeGb: 3.5 } as never)
  expect(refused(await $.tool.call(START_PIE as never))).toContain('free RAM is 3.5 GB, under the 5 GB PIE start gate')
  await $.tool.call({ tool: EDITOR, action: 'status', freeGb: 20 } as never)
  expect(refused(await $.tool.call(START_PIE as never))).toBeUndefined()
  expect(w.read(`${HF}/orchestrate.log`)).toContain('PIE start: the RAM probe failed twice; the agent read 20 GB of RAM available')
})

test('A88 (c): the probe failing while this session\'s PIE runs tells the holder to read RAM itself (no silent pass of the 3 GB abort)', opts(), async ($, on) => {
  const git: Record<string, { stdout: string; deny?: string }> = {}
  const w = world(on, { git })
  on('turn.complete', async () => ({ text: '' }))
  w.put(LOCK, `1006-me-s1 (this lane) since 14:30, expected end 15:10. session ${ME8}\n`)
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'mcp__unreal-mcp__call_tool', name: 'McpPieToolset.StartPIE' } as never))).toBeUndefined()
  await idle($)
  git['ConvertTo-Json'] = { stdout: '', deny: 'probe failed' }
  for (let n = 0; n < 2; n += 1) await w.clock.advance(MIN)
  const said = (w.calls['prompt.submit'] ?? []).map(e => String((e as { text?: string }).text)).join('\n')
  expect(said).toContain(`A5R · RAM — the RAM probe did not answer while your PIE runs, so the 3 GB PIE abort cannot be checked → read free RAM with ${READ_CMD} now and stop PIE if it is under 3 GB`)
})

// ---------- F-8 race (re-review): a line written meanwhile wins over A5R's FREE line; the requester keeps its request ----------
test('F-8 (re-review): a lock line another writer puts while A5R probes for a missing lock wins; this session keeps its request and waits', opts(), async ($, on) => {
  let release = () => {}
  const hold = new Promise<void>(r => {
    release = r
  })
  const git: Record<string, { stdout: string; hold?: Promise<void> }> = {}
  const w = world(on, { ram: '40', git, procs: [{ ...UE, pid: 777 }] })
  await $.session.start(START)
  // The lock is missing while an Editor runs: this session asks and waits (held by unknown).
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'tail VFX' } as never))).toContain('held by unknown')
  // The Editor exits; at the next minute A5R probes (held open here) while a session without A5R writes the lock.
  w.machine.procs = []
  const runs = w.runs.length
  git['ConvertTo-Json'] = { stdout: JSON.stringify({ freeGb: 40, diskGb: 40, procs: [] }), hold }
  await w.clock.advance(MIN)
  for (let n = 0; n < 100 && !w.runs.slice(runs).some(r => r.includes('ConvertTo-Json')); n += 1) await sleep(10)
  w.put(LOCK, 'held by walker since 14:00 until 15:30\n')
  release()
  await sleep(100)
  expect(w.read(LOCK)).toBe('held by walker since 14:00 until 15:30\n') // the later line wins
  expect(JSON.parse(w.read(`${HF}/editor/${ME8}.json`)).want?.what).toBe('tail VFX') // the request is kept
  expect(out(await $.tool.call({ tool: EDITOR, action: 'status' } as never))).toContain('walker holds the Editor until 15:30')
})
// ---------- review (PLAUSIBLE, confirmed): an Unreal MCP call is classed by its tool and method, not its arguments ----------
test('MCP kind: unit: the method decides; a read whose arguments mention set_ or run_ stays a read', () => {
  const T = 'mcp__unreal-mcp__call_tool'
  expect(mcpCallKind(T, { name: 'find_assets', arguments: { query: 'set_visibility run_test' } })).toBe('read')
  expect(mcpCallKind(T, { name: 'ActorTools.get_actor', arguments: { label: 'BP_save_assets_marker' } })).toBe('read')
  expect(mcpCallKind(T, { name: 'AssetTools.save_assets', arguments: { paths: ['/Game/X'] } })).toBe('write')
  expect(mcpCallKind(T, { name: 'EditorTools.SaveAll' })).toBe('save-all')
  expect(mcpCallKind(T, { name: 'McpPieToolset.StartPIE' })).toBe('pie')
  expect(mcpCallKind(T, { name: 'McpPieToolset.ExecuteConsoleCommand', arguments: { command: 'Sipher.Bench.Combo.Start' } })).toBe('pie')
  expect(mcpCallKind('mcp__unreal__set_actor_property', { actor: 'x' })).toBe('write')
  expect(mcpCallKind('mcp__unreal__get_level_actors', { filter: 'create_' })).toBe('read')
  // Re-review: a console command, and any method that can quit, close or save, needs the lock.
  expect(mcpCallKind(T, { name: 'McpPieToolset.ExecuteConsoleCommand', arguments: { command: 'stat fps' } })).toBe('write')
  expect(mcpCallKind(T, { name: 'McpPieToolset.ExecuteConsoleCommand', arguments: { command: 'QUIT_EDITOR' } })).toBe('write')
  expect(mcpCallKind(T, { name: 'EditorTools.QuitEditor' })).toBe('write')
  expect(mcpCallKind(T, { name: 'quit_editor' })).toBe('write')
  expect(mcpCallKind(T, { name: 'close_editor' })).toBe('write')
  expect(mcpCallKind(T, { name: 'AssetTools.save_asset' })).toBe('write')
  // Round-2 review: exact names and prefixes, never substrings.
  expect(mcpCallKind(T, { name: 'ActorTools.find_closest_actor' })).toBe('read')
  expect(mcpCallKind('mcp__unreal__find_closest_actor', {})).toBe('read')
})

test('MCP kind: a read while another lane holds the Editor runs even when its arguments mention set_', opts(), async ($, on) => {
  const w = world(on)
  w.put(LOCK, '1006-other-s9 (worker) since 14:30, expected end 15:10. session ffffffff\n')
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'mcp__unreal-mcp__call_tool', name: 'find_assets', arguments: { query: 'set_visibility' } } as never))).toBeUndefined()
  expect(refused(await $.tool.call(SAVE as never))).toContain('A5R · Editor lock')
})

// ---------- F-8 (orchestrator, rev 30, under A84): a missing lock never stalls the queue ----------
for (const empty of [false, true])
  test(`F-8: a ${empty ? 'empty' : 'missing'} lock with no Unreal process running is written FREE by A5R and the request is granted`, opts(), async ($, on) => {
    const w = world(on, { ram: '40' })
    if (empty) w.put(LOCK, '')
    await $.session.start(START)
    const ran = out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'tail VFX' } as never))
    expect(ran).toContain('until 15:10')
    expect(parseLockLine(w.read(LOCK)).id8).toBe(ME8)
    expect(w.read(`${HF}/alerts/lock-missing-${Math.floor(NOW / MIN)}.json`)).toContain(ME8) // the one writer's claim
  })

test('F-8: a missing lock while an Unreal Editor runs is held by unknown (nothing killed); once it exits, FREE is written and the queue goes on', opts(), async ($, on) => {
  const w = world(on, { ram: '40', procs: [{ name: 'UnrealEditor', pid: 777, gb: 26, parentAlive: true }] })
  await $.session.start(START)
  const ran = out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'tail VFX' } as never))
  expect(ran).toContain('an Unreal Editor runs with no lock (PID 777): held by unknown until it ends')
  await w.clock.advance(2 * MIN)
  expect(w.read(LOCK)).toBe('')
  w.machine.procs = [] // the Editor exited
  for (let n = 0; n < 2; n += 1) await w.clock.advance(MIN)
  const lock = parseLockLine(w.read(LOCK))
  expect([lock.kind, lock.id8]).toEqual(['held', ME8])
  expect(w.runs.some(r => /Stop-Process|taskkill|kill\b/i.test(r))).toBe(false)
})

// ---------- round-2 review ----------
test('A84 (round 2): the legacy hand form "<lane> (…) since HH:MM … expected end HH:MM" names its holder lane, end and PID; that session drives it', opts(), async ($, on) => {
  const legacy = parseLockLine('1006-x-s9 (worker) since 14:30, expected end 15:10. Editor PID 4242.\n')
  expect([legacy.isReadable, legacy.heldLane, legacy.end, legacy.pid, legacy.id8]).toEqual([true, '1006-x-s9', '15:10', 4242, ''])
  expect(parseLockLine('editor (testing) busy, do not touch\n').isReadable).toBe(false)
  const w = world(on)
  w.put(LOCK, '3️⃣-Loco-fix (worker) since 14:30, expected end 15:10.\n') // this session's lane (its title)
  await $.session.start(START)
  await w.clock.advance(MIN) // the session file is written: the lane resolves to this session
  expect(refused(await $.tool.call(SAVE as never))).toBeUndefined()
})

test('A84 (round 2): no conversion while any Unreal Editor runs, even one the hand line does not name; the request queues', opts(), async ($, on) => {
  const w = world(on, { ram: '40', procs: [{ ...UE, pid: 999 }] })
  w.put(LOCK, 'held by walker since 14:00 until 15:30\n')
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'tail VFX' } as never))).toContain('walker holds the Editor until 15:30')
  expect(w.read(LOCK)).toBe('held by walker since 14:00 until 15:30\n')
})

test('A84 (round 2): with no process reading the request converts nothing and names the step', opts(), async ($, on) => {
  const w = world(on, { ram: '40', git: { 'ConvertTo-Json': { stdout: '', deny: 'probe failed' } } })
  w.put(LOCK, 'held by walker since 14:00 until 15:30\n')
  await $.session.start(START)
  expect(out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'tail VFX' } as never))).toContain('queued: the line lapses at 16:00 if nothing runs; request again after')
  expect(w.read(LOCK)).toBe('held by walker since 14:00 until 15:30\n')
})

test('round 2: unit: a gone holder\'s lease is never recovered without a process reading (it waits for the next minute)', () => {
  const me = { ...blankSession(ME, 'me', 'me', NOW), want: { minutes: 30, pie: false, build: false, what: 'x', mode: 'interactive' as const, pausable: true, nextSafe: 'after save', requestedAt: NOW - MIN } }
  const holder = { ...blankSession('bbbbbbbb-1', 'gone-lane', 'gone', NOW - 30 * MIN) }
  const lock = parseLockLine(`HELD lane=gone-lane session=gone since=13:00 2026-10-06 pid=none end=14:00 mode=interactive pausable=yes next_safe=after-save note=x · held by gone-lane, session bbbbbbbb, until 14:00\n`)
  const input = { me8: ME8, lock, files: [me, holder], lanes: [], now: NOW, sync: null, gates: { pieGb: 31, nopieGb: 28 } }
  expect(decide({ ...input, probe: null })).toMatchObject({ kind: 'wait', code: 'probe' })
  expect(decide({ ...input, probe: probe([]) })).toEqual({ kind: 'recover', holder: 'bbbbbbbb' })
})
