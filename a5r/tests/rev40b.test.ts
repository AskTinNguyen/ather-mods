import { expect, test } from 'claude-code/testing'
import { DEFAULT_GATES, NO_MANUAL, blankSession, heldLine, heldLineAt, isLockPath, parseLockLine, queueOf, writesLock, type GrantInput, type SessionFile, type Want } from '../hooks/coord.ts'
import { queueView, queuedLine } from '../hooks/lease.ts'
import { NO_ORDER, applyOrder, isPersonPath, manualOf, writesPersonFile, type OrderAction, type QueueOrder } from '../hooks/order.ts'
import { LOCK, ME, NOW, PROJ, opts, refused, world } from './world.ts'

// Rev 40, the Fable adversary review of 6e53ce9/9391de7/6dc277d ("fix first"): D1 the person's order file is guarded the
// other way round (only readers may name it); D2 a move keeps the pin of a placed session that is not in the queue this
// minute; D3 a resize rewrites the HELD line's trailing `until`, never one inside a note; D4 no resize of a gone holder;
// and a placed head that waits for memory says nobody passes it.
const P = 'E:/s2/Saved/A5R/queue-order.json'
const MIN = 60_000
const ME8 = ME.slice(0, 8)
const want = (o: Partial<Want> = {}): Want => ({ minutes: 30, pie: false, build: false, what: 'x', mode: 'unattended', pausable: true, nextSafe: 'after save', requestedAt: NOW - 30 * MIN, ...o })
const file = (id8: string, o: Partial<SessionFile> = {}): SessionFile => ({ ...blankSession(`${id8}-1111-4000-8000-000000000000`, `lane-${id8}`, `title ${id8}`, NOW), lastTurnAt: NOW - 2 * MIN, ...o })
const FREE = parseLockLine('FREE since=14:00 2026-10-06 by=x note=none background=none · free since 14:00\n')
const input = (files: SessionFile[], o: Partial<GrantInput> = {}): GrantInput => ({ me8: ME8, lock: FREE, files, lanes: [], now: NOW, sync: null, probe: { freeGb: 45, diskGb: 40, procs: [] }, gates: DEFAULT_GATES, manual: NO_MANUAL, focus: null, ...o })
const PRESSER = { by: 'the person (panel in tail)', titleOf: () => '' }
const apply = (files: SessionFile[], a: OrderAction, order: QueueOrder = NO_ORDER, o: Partial<GrantInput> = {}) => applyOrder(input(files, o), order, a, PRESSER)

test('Fable review D1: every measured write of the order file is refused (one-liners, copies and renames into Saved/A5R, a path in a variable); its readers run', () => {
  const writes = [
    `python -c "open('${P}','w').write('{}')"`,
    `node -e "require('fs').writeFileSync('${P}','{}')"`,
    'python -c "import os; open(os.path.join(\'E:/s2/Saved/A5R\', \'queue-order.json\'), \'w\')"',
    `pwsh -c "Set-Content ${P} '{}'"`,
    'python -c "import glob; [open(f, \'w\') for f in glob.glob(\'E:/s2/Saved/A5R/*.json\')]"', // names only the folder
    'node -e "process.chdir(\'E:/s2/Saved/A5R\')"',
    `cp prepared.json E:/s2/Saved/A5R/`,
    'Copy-Item prepared.json -Destination E:\\s2\\Saved\\A5R\\',
    'Copy-Item -Path prepared.json -Destination:E:\\s2\\Saved\\A5R',
    'robocopy C:\\tmp E:\\s2\\Saved\\A5R queue-order.json',
    'xcopy prepared.json E:\\s2\\Saved\\A5R\\',
    'mv prepared.json E:/s2/Saved/A5R/other.json',
    'ren E:\\s2\\Saved\\A5R\\x.json queue-order.json',
    'Rename-Item -Path E:\\s2\\Saved\\A5R\\x.json -NewName y.json',
    "$p='E:/s2/Saved/A5R/queue-order.json'; Set-Content $p '{}'",
    'cd E:/s2/Saved/A5R && cp ../x.json .',
    `cd E:/s2/Saved/A5R && echo '{}' > queue-order.json`,
    `jq . x.json > ${P}`,
    `printf '{}' | tee ${P}`,
    `bash -c "echo '{}' > ${P}"`,
    `New-Item -Path ${P} -Value '{}' -Force`,
    `[IO.File]::WriteAllText('${P}','{}')`,
    `sort -o ${P} x.json`,
    'pushd E:/s2/Saved/A5R && popd && cd E:/s2/Saved/A5R && Move-Item ../x.json y.json',
  ]
  for (const c of writes) expect([c, writesPersonFile(c)]).toEqual([c, true])
  const reads = [`cat ${P}`, `type ${P.replace(/\//g, '\\')}`, `Get-Content ${P}`, `gc ${P} | ConvertFrom-Json`, `jq .placed ${P}`, `rg moved ${P}`, `head -c 200 ${P}`, `Select-String -Path ${P} -Pattern placed`, `ls -la E:/s2/Saved/A5R`, 'git grep queue-order.json -- a5r', 'cp E:/s2/Saved/A5R/probe.json C:/tmp/', 'python -c "print(1)"', 'Copy-Item a.json -Destination E:/s2/Saved/other/', 'pushd E:/s2/Saved/A5R && popd && cp x.json .', 'cp a5r/tests/fixtures/my-queue-order.json C:/tmp/']
  for (const c of reads) expect([c, writesPersonFile(c)]).toEqual([c, false])
  // The lock keeps its writer list (agents read it with many tools); its measured writers are still refused.
  expect([writesLock('cat E:/s2/Saved/EDITOR_OWNER.txt'), writesLock("python -c \"print(open('E:/s2/Saved/EDITOR_OWNER.txt').read())\""), writesLock('echo x > E:/s2/Saved/EDITOR_OWNER.txt'), writesLock('cp x E:/s2/Saved/EDITOR_OWNER.txt')]).toEqual([false, false, true, true])
  expect([isPersonPath('E:/s2/Saved//A5R/queue-order.json'), isPersonPath('E:/s2/Saved/A5R/./queue-order.json'), isPersonPath('E:/s2/Saved/A5R/queue-order.json.tmp'), isPersonPath('E:/s2/Saved/X/../A5R/queue-order.json'), isLockPath('E:/s2/Saved/X/../EDITOR_OWNER.txt')]).toEqual([true, true, false, true, true])
})

test('Fable review D1: a model\'s one-liner writing the order file is refused at the call, with how to read it instead', opts(), async ($, on) => {
  world(on, { ram: '40' })
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  const deny = refused(await $.tool.call({ tool: 'Bash', command: `python -c "open('${P}','w').write('{}')"` } as never))
  expect(deny).toBe("A5R · Editor order — Saved/A5R/queue-order.json and editor-focus.json are the person's: only his press on the A5R panel or his own /a5r editor or /a5r focus command changes them (and a focus session's own focus_done) → request the Editor with the editor tool (action request) and wait for your turn; to read a file, use cat, Get-Content, jq or rg")
  expect(refused(await $.tool.call({ tool: 'PowerShell', command: 'Copy-Item prepared.json -Destination E:\\s2\\Saved\\A5R\\' } as never))).toContain('Editor order')
  expect(refused(await $.tool.call({ tool: 'Bash', command: `jq .placed ${P}` } as never))).toBeUndefined()
})

test('Fable review D2: a move keeps the pin of a placed session that is not in the queue this minute; it is back in the person\'s order when it is', () => {
  const A = file('aaaaaaaa', { want: want({ requestedAt: NOW - 50 * MIN }) })
  const B = file('b2b2b2b2', { want: want({ requestedAt: NOW - 40 * MIN }) })
  const C = file('c3c3c3c3', { want: want({ requestedAt: NOW - 30 * MIN }) })
  const top = apply([A, B, C], { kind: 'move', how: 'top', who: { id8: C.id8 } })
  if (!('kind' in top) || top.kind !== 'order') throw new Error(JSON.stringify(top))
  const stale = { ...C, heartbeatAt: NOW - 20 * MIN } // C's session misses its heartbeat this minute: out of the queue
  const next = apply([A, B, stale], { kind: 'move', how: 'top', who: { id8: B.id8 } }, top.order)
  if (!('kind' in next) || next.kind !== 'order') throw new Error(JSON.stringify(next))
  expect(next.order.placed.map(p => [p.id8, p.at])).toEqual([[B.id8, NOW], [A.id8, NOW], [C.id8, NOW]])
  expect(next.order.placed.find(p => p.id8 === C.id8)).toEqual(top.order.placed.find(p => p.id8 === C.id8)) // unchanged
  expect(queueOf([A, B, C], [], NOW, null, manualOf(next.order, [A, B, C], NOW)).map(f => f.id8)).toEqual([B.id8, A.id8, C.id8])
})

test('Fable review D3: a resize rewrites the HELD line\'s trailing `until`, never an `until` inside its note', () => {
  const lock = parseLockLine('HELD lane=x session=y since=14:00 2026-10-06 pid=none end=15:00 mode=interactive pausable=yes next_safe=after-save note=PIE until 15:00 · held by x, session aaaaaaaa, until 15:00')
  expect(heldLineAt(lock, new Date(2026, 9, 6, 15, 30).getTime())).toBe('HELD lane=x session=y since=14:00 2026-10-06 pid=none end=15:30 mode=interactive pausable=yes next_safe=after-save note=PIE until 15:00 · held by x, session aaaaaaaa, until 15:30')
})

test('Fable review D4: a resize of a holder whose session is gone is refused (its lease lapses by itself)', () => {
  const holder = file('d4d4d4d4', { heartbeatAt: NOW - 25 * MIN, holding: { since: NOW - 60 * MIN, end: NOW + 10 * MIN, extended: 0 } })
  const lock = parseLockLine(heldLine({ lane: 'lane-d4d4d4d4', sessionName: 'd', id8: 'd4d4d4d4', since: NOW - 60 * MIN, pid: null, end: NOW + 10 * MIN, mode: 'interactive', pausable: true, nextSafe: 'after save', note: 'x' }))
  expect(apply([holder], { kind: 'time', who: { id8: 'd4d4d4d4' }, change: { add: 60 } }, NO_ORDER, { lock })).toEqual({ refusal: 'A5R · Editor order — lane-d4d4d4d4: its session is gone → its lease lapses by itself once nothing runs' })
  expect('kind' in apply([{ ...holder, heartbeatAt: NOW }], { kind: 'time', who: { id8: 'd4d4d4d4' }, change: { add: 60 } }, NO_ORDER, { lock })).toBe(true) // alive: accepted
})

test('design note: a placed head that waits for memory says nobody passes it', () => {
  const head = file('e5e5e5e5', { want: want({ requestedAt: NOW - 40 * MIN }) })
  const build = file('f6f6f6f6', { want: want({ build: true, launch: false, requestedAt: NOW - 10 * MIN }) })
  const order: QueueOrder = { v: 1, placed: [{ id8: head.id8, requestedAt: NOW - 40 * MIN, isKept: false, at: NOW - MIN, by: 'p' }], sized: [], changes: [] }
  const rows = queueView(input([head, build], { probe: { freeGb: 27, diskGb: 40, procs: [] }, manual: manualOf(order, [head, build], NOW) })).rows
  expect(rows.map(queuedLine)).toEqual(['waiting 40 min · 30 min · placed by hand · needs 28 GB, 27 free; placed by hand: nobody passes it', 'waiting 10 min · 30 min · build']) // decide's own reason
  expect(LOCK).toBe('E:/s2/Saved/EDITOR_OWNER.txt')
})
