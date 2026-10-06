import { expect, test } from 'claude-code/testing'
import { blankSession, heldLine, newSync, parseSyncFile } from '../hooks/coord.ts'
import { LOCK, ME, NOW, PANE, PROJ, atherTree, find, keys, opts, text, world } from './world.ts'

// A2: with A5 on, one row of three tiles right under Ather's strip (Editor holder, Memory, Sync main), each with
// what it must show and, for Memory and Sync main, the controls Hai uses (D4, D5), on the terminal and the desktop.
const HF = 'E:/s2/Saved/HaiFlow'
const ME8 = ME.slice(0, 8)
const T = (h: number, m: number) => new Date(2026, 9, 6, h, m).getTime()
const label = (tree: unknown, key: string): string => String((find(tree, key)?.props as { label?: unknown } | undefined)?.label ?? '')

for (const surface of ['terminal', 'desktop'] as const) {
  test(`A2 pane (${surface}): Editor holder · Memory · Sync main under Ather's strip, with the gate and sync controls`, opts(), async ($, on) => {
    const w = world(on, { ram: '28.5', procs: [{ name: 'python', pid: 7, gb: 0.4, parentAlive: true }] })
    const PANE_AT = { ...PANE, surface } as never
    w.put(LOCK, `${heldLine({ lane: 'walker', sessionName: 'walker', id8: 'bbbbbbbb', since: T(14, 30), pid: null, end: T(15, 10), mode: 'interactive', pausable: false, nextSafe: 'after save', note: 'capture' })}\n`)
    w.put(`${HF}/editor/bbbbbbbb.json`, JSON.stringify({ ...blankSession('bbbbbbbb-1111', 'walker', '', NOW), holding: { since: T(14, 30), end: T(15, 10), extended: 0 } }))
    on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
    await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
    await $.tool.call({ tool: 'mcp__hai-flow__editor', action: 'request', minutes: 20, what: 'PIE proof', pie: true } as never)
    await $.ui.render(PANE_AT)
    await w.clock.advance(50) // the branch read runs off the render
    let tree = await $.ui.render(PANE_AT)
    expect(keys(tree)).toEqual(['head-words', 'strip', 'hai-tiles', 'hai-overview', 'hai-a5-rules', 'foot'])
    // Editor holder: who, until when, this session's place.
    const editor = text(find(tree, 'hai-tile-editor'))
    for (const want of ['walker', 'until 15:10 · 30 min left', 'you: next']) expect(editor).toContain(want)
    // Memory: free RAM against the launch gate and the PIE gate, with − / + controls.
    const memory = text(find(tree, 'hai-tile-memory'))
    for (const want of ['28.5 GB free', 'a launch fits without PIE', 'PIE ≥ 5 GB ok', surface === 'desktop' ? 'launch ≥ 31 GB with PIE · 28 GB without' : 'gate 31/28 GB']) expect(memory).toContain(want)
    expect([label(tree, 'hai-gate-down'), label(tree, 'hai-gate-up')]).toEqual(surface === 'desktop' ? ['− 1 GB', '+ 1 GB'] : ['−1', '+1'])
    expect(find(tree, 'hai-gate-reset')).toBeUndefined()
    // Sync main: branch behind/ahead, no sync yet, plan presets.
    const main = text(find(tree, 'hai-tile-main'))
    for (const want of ['12 behind', '3 ahead', 'no sync planned']) expect(main).toContain(want)
    expect(label(tree, 'hai-sync-plan-0')).toBe(surface === 'desktop' ? 'Plan 15:30' : '15:30')

    // D5: Hai moves the launch gate for every session (the plugin store), and can put it back.
    await $.ui.press({ plugin: 'hai-flow', key: 'hai-gate-up', surface })
    tree = await $.ui.render(PANE_AT)
    expect(text(find(tree, 'hai-tile-memory'))).toContain(surface === 'desktop' ? 'launch ≥ 32 GB with PIE · 29 GB without (set here)' : 'gate 32/29 GB')
    expect(text(find(tree, 'hai-tile-memory'))).toContain('under the launch gate')
    await $.ui.press({ plugin: 'hai-flow', key: 'hai-gate-reset', surface })
    tree = await $.ui.render(PANE_AT)
    expect(text(find(tree, 'hai-tile-memory'))).toContain(surface === 'desktop' ? 'launch ≥ 31 GB with PIE · 28 GB without' : 'gate 31/28 GB')

    // D4: Hai plans a sync at a preset; this session holds it; it can be moved or cancelled.
    await $.ui.press({ plugin: 'hai-flow', key: 'hai-sync-plan-0', surface })
    expect(parseSyncFile(w.read(`${HF}/sync.json`))?.holder.id8).toBe(ME8)
    tree = await $.ui.render(PANE_AT)
    expect(text(find(tree, 'hai-tile-main'))).toContain('next sync 15:30 by this session · cutoff 15:00')
    expect([label(tree, 'hai-sync-earlier'), label(tree, 'hai-sync-later'), label(tree, 'hai-sync-cancel')]).toEqual(['−30 min', '+30 min', 'Cancel'])
    await $.ui.press({ plugin: 'hai-flow', key: 'hai-sync-later', surface })
    expect(parseSyncFile(w.read(`${HF}/sync.json`))?.at).toBe(T(16, 0))
    await $.ui.press({ plugin: 'hai-flow', key: 'hai-sync-cancel', surface })
    expect(parseSyncFile(w.read(`${HF}/sync.json`))?.state).toBe('cancelled')
    tree = await $.ui.render(PANE_AT)
    expect(text(find(tree, 'hai-tile-main'))).toContain('last sync 16:00 cancelled')
    expect(find(tree, 'hai-sync-plan-0')).toBeDefined()
  })

  test(`A2 pane (${surface}): a sync held elsewhere shows its phase and conflicts, without controls that are not this session's`, opts(), async ($, on) => {
    const w = world(on)
    const PANE_AT = { ...PANE, surface } as never
    w.put(`${HF}/sync.json`, JSON.stringify({ ...newSync(T(15, 0), { session: 'bbbbbbbb-1', id8: 'bbbbbbbb', lane: 'sync-lane' }, 'sync-lane', NOW), conflicts: [{ path: 'Source/S2/Foo.cpp', kind: 'self', match: 'abc' }, { path: 'Content/X.uasset', kind: 'foreign' }], conflictsAt: NOW, conflictsSource: 'merge-tree' }))
    w.put(`${HF}/editor/bbbbbbbb.json`, JSON.stringify(blankSession('bbbbbbbb-1', 'sync-lane', '', NOW)))
    on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
    await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
    const tree = await $.ui.render(PANE_AT)
    const main = text(find(tree, 'hai-tile-main'))
    expect(main).toContain('sync 15:00 by sync-lane · cutoff: commit, release the Editor by 14:50')
    expect(main).toContain('conflicts: 2 (1 self, 1 foreign)')
    for (const k of ['hai-sync-plan-0', 'hai-sync-later', 'hai-sync-cancel', 'hai-sync-done', 'hai-sync-takeover']) expect(find(tree, k)).toBeUndefined()
    expect(find(tree, 'hai-sync-refresh')).toBeDefined()
  })
}
