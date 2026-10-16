import { expect, test } from 'claude-code/testing'
import { A5R } from '../hooks/a5r.ts'
import { blankSession, lapseOf, namesHolder, newSync, parseLockLine, resolveLock, type SessionFile } from '../hooks/coord.ts'
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
  const x = { lock, files: [], lanes: [], waiting: [] }
  expect(lapseOf({ ...x, now: D(13, 20), probe: probe([]) })?.kind).toBe('lapsed') // past 13:06 + 10 min, PID 21832 gone
  expect(lapseOf({ ...x, now: D(13, 20), probe: probe([UE]) })).toBeNull() // its Editor still runs
  expect(lapseOf({ ...x, now: D(13, 20), probe: probe([{ ...UE, pid: 4444, name: 'UnrealBuildTool' }]) })).toBeNull() // a build runs
  expect(lapseOf({ ...x, now: D(13, 10), probe: probe([]) })).toBeNull() // inside the 10 min
  // A live holder (its a5r's fresh heartbeat) keeps it past its end and hears the overrun.
  expect(lapseOf({ ...x, files: [{ ...holder, heartbeatAt: D(13, 19) }], lock: resolveLock(lock, [holder], [], D(13, 20)), now: D(13, 20), probe: probe([]) })).toBeNull()
  // A line naming nobody: held until its end, or 2 h after it was written, then free when nothing runs.
  const blind = parseLockLine('editor busy - do not touch\n')
  expect([blind.kind, blind.isReadable]).toEqual(['held', false])
  expect(lapseOf({ ...x, lock: blind, writtenAt: D(11, 0), now: D(12, 59), probe: probe([]) })).toBeNull()
  expect(lapseOf({ ...x, lock: blind, writtenAt: D(11, 0), now: D(13, 0), probe: probe([]) })?.kind).toBe('lapsed')
  expect(lapseOf({ ...x, lock: blind, writtenAt: D(11, 0), now: D(13, 0), probe: probe([{ ...UE, pid: 9 }]) })).toBeNull()
  const timed = parseLockLine('testing the editor until 12:00, do not touch\n')
  expect(lapseOf({ ...x, lock: timed, writtenAt: D(9, 0), now: D(12, 0), probe: probe([]) })?.kind).toBe('lapsed')
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
  while (w.clock.now() < D(13, 10)) {
    if (w.clock.now() >= D(12, 50)) w.machine.procs = [] // the avian lane closed its Editor
    await w.clock.advance(MIN)
  }
  expect(w.read(LOCK)).toBe(LINE) // 13:10: inside the 10 min past its end
  while (w.clock.now() < D(13, 20)) await w.clock.advance(MIN)
  const lock = parseLockLine(w.read(LOCK))
  expect([lock.kind, lock.id8]).toEqual(['held', ME8])
  expect(w.read(`${HF}/orchestrate.log`)).toContain('lapsed hand-written lock of avian wing-kit (session-9b53d3): ended 13:06')
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

// ---------- A85: the kit's own checks run from anywhere ----------
test('A85: unit: claude plugin test|validate, tsc -p, node/bun on the kit\'s tests run from any folder; writes into the live kit stay refused', () => {
  const KIT = 'D:/Projects/ather-mods/a5r'
  const a5r = new A5R(CONFIG, { KIT, HOME: 'C:/Users/hai.huynh', USERPROFILE: 'C:/Users/hai.huynh', TEMP: 'C:/Users/HAI~1.HUY/AppData/Local/Temp', LOCALAPPDATA: 'C:/Users/hai.huynh/AppData/Local' })
  const pre = (c: string) => a5r.preShell(c, PROJ, {})?.key ?? null
  for (const c of [
    `claude plugin test ${KIT}`,
    `claude plugin validate ${KIT}`,
    `npx -y -p typescript@5.6 tsc -p ${KIT}`,
    `node --experimental-strip-types ${KIT}/tests/scan-old-names.mjs`,
    `bun test ${KIT}/tests`,
    `git -C ${KIT} log -3 --oneline`,
    `claude plugin test ${KIT} > C:/tmp/a5r-test.txt`,
  ])
    expect([c, pre(c)]).toEqual([c, null])
  for (const c of [
    `cp x.ts ${KIT}/hooks/x.ts`,
    `claude plugin test ${KIT} > ${KIT}/out.txt`,
    `git -C ${KIT} commit -m x`,
    `node -e "require('fs').writeFileSync('${KIT}/x', '')"`,
    `npm install --prefix ${KIT}`,
    `rm ${KIT}/hooks/x.ts`,
    `sed -i s/a/b/ ${KIT}/rules/config.json`,
  ])
    expect([c, pre(c)]).toEqual([c, 'kit'])
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

// ---------- A88 (c): a failed RAM probe never makes a wait nobody can end, nor a silent pass ----------
test('A88 (c): with no RAM reading at all, the probe is run once more and the slot is granted with a warning (the launch gate unchecked)', opts(), async ($, on) => {
  const w = world(on, { git: { 'ConvertTo-Json': { stdout: '', deny: 'probe failed' } } })
  w.put(LOCK, 'FREE since=14:00 2026-10-06 by=x note=none background=none · free since 14:00\n')
  await $.session.start(START)
  const ran = out(await $.tool.call({ tool: EDITOR, action: 'request', minutes: 30, what: 'tail VFX' } as never))
  expect(ran).toContain('the RAM probe did not answer twice, so the launch gate was not checked')
  expect(ran).toContain('read free RAM yourself first')
  expect(parseLockLine(w.read(LOCK)).id8).toBe(ME8)
})

test('A88 (c): the PIE check retries a failed probe once, then lets PIE start with a warning (as the launch gate does)', opts(), async ($, on) => {
  const w = world(on, { git: { '[math]::Round((Get-CimInstance': { stdout: '', deny: 'probe failed' } } })
  w.put(LOCK, `1006-me-s1 (this lane) since 14:30, expected end 15:10. session ${ME8}\n`)
  await $.session.start(START)
  const pie = (await $.tool.call({ tool: 'mcp__unreal-mcp__call_tool', name: 'McpPieToolset.StartPIE' } as never)) as { deny?: string; context?: string[] }
  expect(refused(pie)).toBeUndefined()
  expect(w.runs.filter(r => r.includes('[math]::Round((Get-CimInstance')).length).toBe(2)
  expect((pie.context ?? []).join('\n')).toContain('the RAM probe did not answer twice, so the 5 GB PIE start gate was not checked for this PIE start')
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
})

test('MCP kind: a read while another lane holds the Editor runs even when its arguments mention set_', opts(), async ($, on) => {
  const w = world(on)
  w.put(LOCK, '1006-other-s9 (worker) since 14:30, expected end 15:10. session ffffffff\n')
  await $.session.start(START)
  expect(refused(await $.tool.call({ tool: 'mcp__unreal-mcp__call_tool', name: 'find_assets', arguments: { query: 'set_visibility' } } as never))).toBeUndefined()
  expect(refused(await $.tool.call(SAVE as never))).toContain('A5R · Editor lock')
})
