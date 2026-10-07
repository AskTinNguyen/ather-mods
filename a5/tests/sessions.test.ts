import { expect, test } from 'claude-code/testing'
import { blankSession, heldLine, newSync, titleFromRecord, type SessionFile } from '../hooks/coord.ts'
import { LOCK, ME, NOW, A5PANE, PROJ, all, atherTree, find, minWidth, opts, text, world } from './world.ts'

// A26 (one line per row since A29; open sessions only since A31): the session overview is a short named list: one row
// per S2 session the app lists as open (★ this one; title, then a status that is never cut: what it holds or waits
// for, "no a5", or its intent, and how long ago it was active), six rows at most then "+N more", under a one-line
// header. Eight live sessions here: this one, five with a5, two with only Ather (one has no title, so the app's list
// cannot match it and it is dropped).
const HF = 'E:/s2/Saved/A5'
const LANES = 'E:/s2/Saved/AtherAutomata/lanes'
const RECORDS = 'C:/Users/hai.huynh/.claude/projects/E--s2'
const MIN = 60_000
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const sid = (id8: string) => `${id8}-1111-4000-8000-000000000000`
const lane = (id8: string, intent: string, activeMinAgo: number) => JSON.stringify({ sessionId: sid(id8), intent, branch: 'HaiHuynh/x', updatedAt: NOW, lastActiveAt: NOW - activeMinAgo * MIN, hasEnded: false })
const file = (id8: string, title: string, o: Partial<SessionFile> = {}) => JSON.stringify({ ...blankSession(sid(id8), `lane-${id8}`, title, NOW), ...o })
const app = (id: string, title: string, o: Record<string, unknown> = {}) => ({ sessionId: `local_${id}`, title, cwd: 'E:\\s2', isArchived: false, isRunning: false, lastActivityAt: new Date(NOW - 5 * MIN).toISOString(), ...o })
const CLIENTS = JSON.stringify([
  app('9', 'Mods', { cwd: 'D:\\Projects\\ather-mods', isRunning: true }),
  ...['Walker capture', 'Tail glow', 'Sync lane', 'Docs pass', 'Old review', 'Loco walk fix'].map((t, n) => app(String(n), t)),
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
  test(`A26/A31 (${surface}): eight live sessions, seven open in the app → a header, six named rows (★ first, holders and queue next), "+1 more"; one line each`, opts(), async ($, on) => {
    const w = world(on, { out: { mcp__ccd_session_mgmt__list_sessions: CLIENTS }, git: { [sid('dddddddd')]: { stdout: '"customTitle":"Loco walk fix"\n' } } })
    machine(w)
    on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
    await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
    const P = { ...A5PANE, surface, props: { ...A5PANE.props, bodyColumns: 44 } } as never
    await $.ui.render(P)
    await w.clock.advance(50) // titles are looked up off the render
    const tree = await $.ui.render(P)
    expect(text(find(tree, 'hai-overview-head'))).toBe('Sessions · 7 open')
    const rows = (find(tree, 'hai-overview')?.children ?? []).map(c => text(c))
    expect(rows.slice(1)).toEqual([
      '★3️⃣ Loco fix' + 'no intent · now',
      '●Tail glow' + 'queue #1 · 1m',
      '●Walker capture' + 'Editor →15:10 · 2m',
      '●Sync lane' + 'sync 16:00 · 40m',
      '●Loco walk fix' + 'no a5 · 3m',
      '●Docs pass' + 'docs · 2h',
      '+1 more',
    ])
    // Each row fits the narrow pane on one line.
    for (const node of find(tree, 'hai-overview')?.children ?? []) expect(minWidth(node) <= 44).toBe(true)
    // A29: rows are one line each (cut with an ellipsis, never wrapped); only the header may wrap.
    expect((find(tree, 'hai-overview')?.children ?? []).filter(c => (c as { props?: { flexWrap?: unknown } }).props?.flexWrap !== undefined)).toEqual([])
    expect(find(tree, `hai-session-${ME.slice(0, 8)}`)?.props?.flexWrap).toBeUndefined() // A29: one line per session
  })

test('A26: A5 off shows no sessions list (Ather as it ships)', opts(), async ($, on) => {
  const w = world(on, { a5: false })
  machine(w)
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  expect(find(await $.ui.render(A5PANE as never), 'hai-overview')).toBeUndefined()
})

// A29: Hai's two row bugs (L-11): a blank title showed a lone "●"; a title with a newline and emoji wrapped over two lines.
const MULTI = '✅ 3️⃣ POC tattoo — TattooDemo BP\nverified in PIE, pushed to PR 32584'
for (const surface of ['terminal', 'desktop'] as const)
  test(`A29 (${surface}): a blank title shows the first 8 hex; a multi-line title is one line, cut with "…"; holds and "no a5" stay`, opts(), async ($, on) => {
    const w = world(on, { git: { [sid('dddddddd')]: { stdout: `"customTitle":${JSON.stringify(MULTI)}\n` } } })
    w.put(`${HF}/editor/bbbbbbbb.json`, file('bbbbbbbb', '   ', { holding: { since: T(14, 30), end: T(15, 10), extended: 0 } }))
    w.put(`${LANES}/${sid('bbbbbbbb')}.json`, lane('bbbbbbbb', 'walker', 2))
    w.put(LOCK, `${heldLine({ lane: 'lane-bbbbbbbb', sessionName: 'x', id8: 'bbbbbbbb', since: T(14, 30), pid: null, end: T(15, 10), mode: 'interactive', pausable: false, nextSafe: 'after save', note: 'capture' })}\n`)
    w.put(`${LANES}/${sid('dddddddd')}.json`, lane('dddddddd', 'tattoo', 3))
    w.put(`${RECORDS}/${sid('dddddddd')}.jsonl`, '{"customTitle":"x"}\n')
    on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
    await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
    const P = { ...A5PANE, surface, props: { ...A5PANE.props, bodyColumns: 44 } } as never
    await $.ui.render(P)
    await w.clock.advance(50)
    const tree = await $.ui.render(P)
    const blank = find(tree, 'hai-session-bbbbbbbb')
    expect(text(blank)).toBe('●bbbbbbbbEditor →15:10 · 2m') // no app list here: live lanes only
    const multi = find(tree, 'hai-session-dddddddd')
    expect(text(find(tree, 'hai-session-dddddddd-title'))).toBe(MULTI.split(String.fromCharCode(10)).join(' ').slice(0, 60).trim()) // one line; the record's title is kept to 60 characters
    expect(text(multi)).not.toContain('\n')
    expect(find(tree, 'hai-session-dddddddd-title')?.children?.[0]).toMatchObject({ type: 'Text', props: { wrap: 'truncate-end' } })
    expect(text(find(tree, 'hai-session-dddddddd-status'))).toBe('no a5 · 3m')
    expect(find(tree, 'hai-session-bbbbbbbb-status')?.props?.flexShrink).toBe(0)
    for (const key of ['hai-session-bbbbbbbb', 'hai-session-dddddddd']) {
      const row = find(tree, key)
      expect([key, row?.props?.flexWrap, minWidth(row) <= 44]).toEqual([key, undefined, true])
    }
  })

// A31: only sessions the app lists as open; the app's current title; ★ for this one; the status at the end never cut.
for (const surface of ['terminal', 'desktop'] as const)
  test(`A31 (${surface}): a closed, an archived and a renamed session: the first two are gone, the third shows its new title`, opts(), async ($, on) => {
    const list = JSON.stringify([app('1', 'Walker capture', { lastActivityAt: new Date(NOW - 2 * MIN).toISOString() }), app('2', 'Docs pass', { isArchived: true }), app('3', 'Renamed task — a long title the row has to cut somewhere')])
    const w = world(on, { out: { mcp__ccd_session_mgmt__list_sessions: list }, git: { [sid('eeeeeeee')]: { stdout: '"aiTitle":"Old name"\n"customTitle":"Renamed task — a long title the row has to cut somewhere"\n' } } })
    w.put(`${HF}/editor/bbbbbbbb.json`, file('bbbbbbbb', 'Walker capture'))
    w.put(`${LANES}/${sid('bbbbbbbb')}.json`, lane('bbbbbbbb', 'walker', 2))
    w.put(`${HF}/editor/cccccccc.json`, file('cccccccc', 'Tail glow')) // closed: live files, but the app no longer lists it
    w.put(`${LANES}/${sid('cccccccc')}.json`, lane('cccccccc', 'tail-vfx', 1))
    w.put(`${HF}/editor/dddddddd.json`, file('dddddddd', 'Docs pass')) // archived in the app
    w.put(`${LANES}/${sid('dddddddd')}.json`, lane('dddddddd', 'docs', 1))
    w.put(`${HF}/editor/eeeeeeee.json`, file('eeeeeeee', 'Old name')) // renamed in the app; its record has the new title
    w.put(`${LANES}/${sid('eeeeeeee')}.json`, lane('eeeeeeee', 'fx-sand', 4))
    w.put(`${RECORDS}/${sid('eeeeeeee')}.jsonl`, '{"customTitle":"x"}\n')
    await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
    const P = { ...A5PANE, surface, props: { ...A5PANE.props, bodyColumns: 44 } } as never
    await $.ui.render(P)
    await w.clock.advance(50) // record titles are looked up off the render
    const tree = await $.ui.render(P)
    expect(text(find(tree, 'hai-overview-head'))).toBe('Sessions · 3 open')
    const ids = (find(tree, 'hai-overview')?.children ?? []).map(c => String((c as { props?: { key?: string } }).props?.key)).slice(1)
    expect(ids).toEqual([`hai-session-${ME.slice(0, 8)}`, 'hai-session-bbbbbbbb', 'hai-session-eeeeeeee'])
    expect(text(find(tree, `hai-session-${ME.slice(0, 8)}`))).toBe('★3️⃣ Loco fix' + 'no intent · now')
    expect(text(find(tree, 'hai-session-eeeeeeee-title'))).toBe('Renamed task — a long title the row has to cut somewhere')
    expect(text(find(tree, 'hai-session-eeeeeeee-status'))).toBe('fx-sand · 4m')
    for (const id of ['bbbbbbbb', 'eeeeeeee']) {
      expect([id, find(tree, `hai-session-${id}-status`)?.props?.flexShrink, find(tree, `hai-session-${id}-title`)?.props?.flexShrink]).toEqual([id, 0, 1])
      expect(minWidth(find(tree, `hai-session-${id}`)) <= 44).toBe(true)
    }
    expect(text(tree)).not.toContain('(this session)')
  })
