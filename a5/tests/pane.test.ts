import { expect, test } from 'claude-code/testing'
import { blankSession, heldLine, newSync, parseSyncFile } from '../hooks/coord.ts'
import { LOCK, ME, NOW, A5PANE, PROJ, atherTree, find, keys, opts, text, world } from './world.ts'

// A2: with A5 on, the three tools right under Ather's strip (Editor holder, Memory, Sync main), each with what it
// must show, on the terminal and the desktop. Since 0.8 (A25) each tool has at most one action: Sync main's opens one
// dialog (D4); the launch gate (D5) moves with /a5 gate instead of the panel's former ±1 GB buttons.
const HF = 'E:/s2/Saved/A5'
const ME8 = ME.slice(0, 8)
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const label = (tree: unknown, key: string): string => String((find(tree, key)?.props as { label?: unknown } | undefined)?.label ?? '')

for (const surface of ['terminal', 'desktop'] as const) {
  test(`A2 pane (${surface}): Editor holder · Memory · Sync main under Ather's strip; /a5 gate moves the launch gate; Sync ⋯ plans, moves and cancels`, opts(), async ($, on) => {
    const w = world(on, { ram: '28.5', procs: [{ name: 'python', pid: 7, gb: 0.4, parentAlive: true }] })
    const PANE_AT = { ...A5PANE, surface } as never
    w.put(LOCK, `${heldLine({ lane: 'walker', sessionName: 'walker', id8: 'bbbbbbbb', since: T(14, 30), pid: null, end: T(15, 10), mode: 'interactive', pausable: false, nextSafe: 'after save', note: 'capture' })}\n`)
    w.put(`${HF}/editor/bbbbbbbb.json`, JSON.stringify({ ...blankSession('bbbbbbbb-1111', 'walker', '', NOW), holding: { since: T(14, 30), end: T(15, 10), extended: 0 } }))
    on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
    await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
    await $.tool.call({ tool: 'mcp__a5__editor', action: 'request', minutes: 20, what: 'PIE proof', pie: true } as never)
    await $.ui.render(PANE_AT)
    await w.clock.advance(50) // the branch read runs off the render
    let tree = await $.ui.render(PANE_AT)
    expect(keys(tree)).toEqual(['hai-a5-band', 'hai-tiles', 'hai-overview', 'hai-a5-rules']) // A29: the A5 pane, the rules last; A33: the band first
    // Editor holder: who, until when, this session's place.
    const editor = text(find(tree, 'hai-tile-editor'))
    for (const want of ['walker', 'until 15:10 · 30 min left', 'you: next']) expect(editor).toContain(want)
    // Memory: free RAM against the launch gate and the PIE gate; no buttons (A25).
    const memory = text(find(tree, 'hai-tile-memory'))
    for (const want of ['28.5 GB free', 'a launch fits without PIE', 'PIE ≥ 5 GB ok', surface === 'desktop' ? 'launch ≥ 31 GB with PIE · 28 GB without' : 'gate 31/28 GB']) expect(memory).toContain(want)
    expect(find(tree, 'hai-tile-memory-action')).toBeUndefined()
    // Sync main: branch behind/ahead, no sync yet, one "Plan sync".
    const main = text(find(tree, 'hai-tile-main'))
    for (const want of ['12 behind', '3 ahead', 'no sync planned']) expect(main).toContain(want)
    expect(label(tree, 'hai-sync-action')).toBe('Plan sync')

    // D5: /a5 gate moves the launch gate for every session (the plugin store), and /a5 gate reset puts it back.
    expect(String((await $.command.run({ command: 'a5', args: 'gate 32 29' } as never)).text)).toContain('≥ 32 GB with PIE, ≥ 29 GB without')
    tree = await $.ui.render(PANE_AT)
    expect(text(find(tree, 'hai-tile-memory'))).toContain(surface === 'desktop' ? 'launch ≥ 32 GB with PIE · 29 GB without (/a5 gate)' : 'gate 32/29 GB')
    expect(text(find(tree, 'hai-tile-memory'))).toContain('under the launch gate')
    await $.command.run({ command: 'a5', args: 'gate reset' } as never)
    tree = await $.ui.render(PANE_AT)
    expect(text(find(tree, 'hai-tile-memory'))).toContain(surface === 'desktop' ? 'launch ≥ 31 GB with PIE · 28 GB without' : 'gate 31/28 GB')

    // D4: Hai plans a sync at a preset in the one dialog; this session holds it; Sync ⋯ moves or cancels it.
    w.say('Plan 15:30')
    await $.ui.press({ plugin: 'a5', key: 'hai-sync-action', surface })
    expect(parseSyncFile(w.read(`${HF}/sync.json`))?.holder.id8).toBe(ME8)
    tree = await $.ui.render(PANE_AT)
    expect(text(find(tree, 'hai-tile-main'))).toContain('next sync 15:30 by this session · cutoff 15:00')
    expect(label(tree, 'hai-sync-action')).toBe('Sync ⋯')
    const asked = (w.calls.ask ?? []) as { questions?: { options?: { label?: string }[] }[] }[]
    w.say('Move to 16:00')
    await $.ui.press({ plugin: 'a5', key: 'hai-sync-action', surface })
    expect((asked.at(-1)?.questions?.[0]?.options ?? []).map(o => o.label)).toEqual(['Move to 16:00', 'Build: on', 'Cancel the sync', 'Refresh'])
    expect(parseSyncFile(w.read(`${HF}/sync.json`))?.at).toBe(T(16, 0))
    w.say('16:30') // the dialog's Other: a time of Hai's own
    await $.ui.press({ plugin: 'a5', key: 'hai-sync-action', surface })
    expect(parseSyncFile(w.read(`${HF}/sync.json`))?.at).toBe(T(16, 30))
    w.say('Cancel the sync')
    await $.ui.press({ plugin: 'a5', key: 'hai-sync-action', surface })
    expect(parseSyncFile(w.read(`${HF}/sync.json`))?.state).toBe('cancelled')
    tree = await $.ui.render(PANE_AT)
    expect(text(find(tree, 'hai-tile-main'))).toContain('last sync 16:30 cancelled')
    expect(label(tree, 'hai-sync-action')).toBe('Plan sync')
  })

  test(`A2 pane (${surface}): a sync held elsewhere shows its phase and conflicts, without controls that are not this session's`, opts(), async ($, on) => {
    const w = world(on)
    const PANE_AT = { ...A5PANE, surface } as never
    w.put(`${HF}/sync.json`, JSON.stringify({ ...newSync(T(15, 0), { session: 'bbbbbbbb-1', id8: 'bbbbbbbb', lane: 'sync-lane' }, 'sync-lane', NOW), conflicts: [{ path: 'Source/S2/Foo.cpp', kind: 'self', match: 'abc' }, { path: 'Content/X.uasset', kind: 'foreign' }], conflictsAt: NOW, conflictsSource: 'merge-tree' }))
    w.put(`${HF}/editor/bbbbbbbb.json`, JSON.stringify(blankSession('bbbbbbbb-1', 'sync-lane', '', NOW)))
    on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
    await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
    const tree = await $.ui.render(PANE_AT)
    const main = text(find(tree, 'hai-tile-main'))
    expect(main).toContain('sync 15:00 by sync-lane · cutoff: commit, release the Editor by 14:50')
    expect(main).toContain('conflicts: 2 (1 self, 1 foreign)')
    // One "Sync ⋯" whose dialog offers only what this session may do: refresh (the holder is alive).
    expect(label(tree, 'hai-sync-action')).toBe('Sync ⋯')
    w.say('Refresh')
    await $.ui.press({ plugin: 'a5', key: 'hai-sync-action', surface })
    const asked = (w.calls.ask ?? []) as { questions?: { options?: { label?: string }[] }[] }[]
    expect((asked.at(-1)?.questions?.[0]?.options ?? []).map(o => o.label)).toEqual(['Refresh', 'Close'])
  })
}
