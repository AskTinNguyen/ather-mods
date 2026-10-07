import { expect, test } from 'claude-code/testing'
import { blankSession, heldLine, newSync, titleFromRecord, type SessionFile } from '../hooks/coord.ts'
import { LOCK, ME, NOW, PANE, PROJ, all, atherTree, find, minWidth, opts, text, world } from './world.ts'

// A26: the session overview is a short named list: one row per live S2 session (title, intent, what it holds or
// waits for, how recently active; "no a5" when it runs without a5), six rows at most then "+N more", under a
// one-line header. Eight sessions here: this one, five with a5, two with only Ather.
const HF = 'E:/s2/Saved/A5'
const LANES = 'E:/s2/Saved/AtherAutomata/lanes'
const RECORDS = 'C:/Users/hai.huynh/.claude/projects/E--s2'
const MIN = 60_000
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const sid = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const lane = (id8: string, intent: string, activeMinAgo: number) => JSON.stringify({ sessionId: sid(id8), intent, branch: 'HaiHuynh/x', updatedAt: NOW, lastActiveAt: NOW - activeMinAgo * MIN, hasEnded: false })
const file = (id8: string, title: string, o: Partial<SessionFile> = {}) => JSON.stringify({ ...blankSession(sid(id8), `lane-${id8}`, title, NOW), ...o })
const CLIENTS = JSON.stringify([
  { sessionId: 'local_9', title: 'Mods', cwd: 'D:\\Projects\\ather-mods', isArchived: false, isRunning: true, lastActivityAt: new Date(NOW - MIN).toISOString() },
])

const machine = (w: ReturnType<typeof world>) => {
  // a5 sessions
  w.put(`${HF}/editor/bbbbbbbb.json`, file('bbbbbbbb', 'Walker capture', { holding: { since: T(14, 30), end: T(15, 10), extended: 0 } }))
  w.put(`${LANES}/${sid('bbbbbbbb')}.json`, lane('bbbbbbbb', 'walker', 2))
  w.put(LOCK, `${heldLine({ lane: 'lane-bbbbbbbb', sessionName: 'Walker capture', id8: 'bbbbbbbb', since: T(14, 30), pid: null, end: T(15, 10), mode: 'interactive', pausable: false, nextSafe: 'after save', note: 'capture' })}\n`)
  w.put(`${HF}/editor/cccccccc.json`, file('cccccccc', 'Tail glow', { want: { minutes: 20, pie: true, build: false, what: 'PIE proof', mode: 'interactive', pausable: true, nextSafe: 'now', requestedAt: NOW - 5 * MIN } }))
  w.put(`${LANES}/${sid('cccccccc')}.json`, lane('cccccccc', 'tail-vfx', 1))
  w.put(`${HF}/editor/ffffffff.json`, file('ffffffff', 'Sync lane'))
  w.put(`${LANES}/${sid('ffffffff')}.json`, lane('ffffffff', '', 40))
  w.put(`${HF}/sync.json`, JSON.stringify(newSync(T(16, 0), { session: sid('ffffffff'), id8: 'ffffffff', lane: 'lane-ffffffff' }, 'lane-ffffffff', NOW)))
  w.put(`${HF}/editor/11111111.json`, file('11111111', 'Docs pass'))
  w.put(`${LANES}/${sid('11111111')}.json`, lane('11111111', 'docs', 90))
  w.put(`${HF}/editor/22222222.json`, file('22222222', 'Old review'))
  w.put(`${LANES}/${sid('22222222')}.json`, lane('22222222', '', 200))
  // Ather only: one with a record that names it, one with no record at all
  w.put(`${LANES}/${sid('dddddddd')}.json`, lane('dddddddd', 'loco', 3))
  w.put(`${RECORDS}/${sid('dddddddd')}.jsonl`, '{"type":"summary"}\n{"customTitle":"Loco walk fix"}\n')
  w.put(`${LANES}/${sid('eeeeeeee')}.json`, lane('eeeeeeee', 'fx-sand', 7))
}

test('A26: unit: a title from Claude Code\'s record, the last one set by a person before the generated one', () => {
  expect(titleFromRecord('"aiTitle":"Fix loco"\n"customTitle":"Loco walk"\n"aiTitle":"Later"')).toBe('Loco walk')
  expect(titleFromRecord('"aiTitle":"Fix \\u00e9 loco"')).toBe('Fix é loco')
  expect(titleFromRecord('')).toBe('')
})

for (const surface of ['terminal', 'desktop'] as const)
  test(`A26 (${surface}): eight sessions → a header, six named rows (holders and queue first), "+2 more"; no single long line`, opts(), async ($, on) => {
    const w = world(on, { out: { mcp__ccd_session_mgmt__list_sessions: CLIENTS }, git: { [sid('dddddddd')]: { stdout: '"customTitle":"Loco walk fix"\n' } } })
    machine(w)
    on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
    await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
    const P = { ...PANE, surface, props: { ...PANE.props, bodyColumns: 44 } } as never
    await $.ui.render(P)
    await w.clock.advance(50) // titles are looked up off the render
    const tree = await $.ui.render(P)
    expect(text(find(tree, 'hai-overview-head'))).toBe('Sessions · 8 in S2 · 1 elsewhere')
    const rows = (find(tree, 'hai-overview')?.children ?? []).map(c => text(c))
    expect(rows.slice(1)).toEqual([
      '●3️⃣ Loco fix (this session)no intent · active now',
      '●Tail glowtail-vfx · Editor queue #1 · active 1m ago',
      '●Walker capturewalker · Editor until 15:10 · active 2m ago',
      '●Sync laneno intent · sync 16:00 · active 40m ago',
      '●Loco walk fixloco · active 3m agono a5',
      '●eeeeeeeefx-sand · active 7m agono a5',
      '+2 more',
    ])
    // Each row and the header wrap inside the narrow pane; nothing is one long line or cut.
    for (const node of find(tree, 'hai-overview')?.children ?? []) expect(minWidth(node) <= 44).toBe(true)
    expect(all(find(tree, 'hai-overview')).filter(n => String(n.props?.wrap ?? '').startsWith('truncate'))).toEqual([])
    expect(find(tree, `hai-session-${ME.slice(0, 8)}`)?.props?.flexWrap).toBe('wrap')
  })

test('A26: A5 off shows no sessions list (Ather as it ships)', opts(), async ($, on) => {
  const w = world(on, { a5: false })
  machine(w)
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  expect(find(await $.ui.render(PANE as never), 'hai-overview')).toBeUndefined()
})
