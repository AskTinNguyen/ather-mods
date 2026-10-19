import { expect, test } from 'claude-code/testing'
import { ATHER_VERSION, HOMES } from './home.fixture.ts'
import { PANE, PROJ, all, find, opts, world, type Tree } from './world.ts'

// A30 (0.18.3): Ather 0.4.0+ draws Home in two views; Simple leaves out the summary strip (and the workers), and A5R's
// compact line used to go in only after the strip, so in Simple view it vanished. Home here is Ather 0.6.1's REAL Home
// spine (masthead, summary strip, workers, the view toggle) built by its own builders in the order its console.mjs
// assembles it, written to tests/home.fixture.ts by tests/make_home_fixture.mjs under node (the engine's test host
// refuses imports outside the a5r folder), and drawn through A5R's wrapper on both surfaces in both views.
const topKeys = (t: unknown): string[] => ((t as Tree).children ?? []).map(c => String((c as Tree).props?.key ?? ''))
const avatars = (t: unknown) => all(t).filter(n => n.type === 'Svg' && String(n.props?.source).includes('<clipPath id="round">'))

test('A30 (0.18.3): the Home fixture comes from Ather 0.6.1', () => {
  expect(ATHER_VERSION).toBe('0.6.1')
  expect(Object.keys(HOMES).sort()).toEqual(['advanced-desktop', 'advanced-terminal', 'simple-desktop', 'simple-terminal'])
})

for (const view of ['simple', 'advanced'] as const)
  for (const surface of ['desktop', 'terminal'] as const)
    test(`A30 (0.18.3, Ather ${ATHER_VERSION} ${view} view, ${surface}): the compact line, the seal in head-words${view === 'advanced' && surface === 'desktop' ? ' and the scarf on the worker avatar' : ''}`, opts(), async ($, on) => {
      world(on)
      on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => HOMES[`${view}-${surface}`] as never)
      await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
      const tree = await $.ui.render({ ...PANE, surface } as never)
      const keys = topKeys(tree)
      const head = surface === 'desktop' ? 'head' : 'head-words'
      // Advanced: right under the strip; Simple (no strip): right under the head block.
      expect(keys.slice(0, view === 'advanced' ? 3 : 2)).toEqual(view === 'advanced' ? [head, 'strip', 'hai-a5r-line'] : [head, 'hai-a5r-line'])
      expect(find(tree, 'hai-a5r-open')).toBeDefined()
      expect(find(find(tree, 'head-words'), 'hai-brand')).toBeDefined() // the seal beside Ather's brand line
      if (view === 'advanced' && surface === 'desktop') {
        const shown = avatars(tree)
        expect(shown.length).toBe(1)
        expect(String(shown[0]?.props?.source)).toContain('data-a5r="scarf"')
      }
      if (view === 'simple') expect(avatars(tree).length).toBe(0) // Simple view draws no workers
    })

test('A30 (0.18.3): another view of Ather\'s pane (no strip, no view toggle) carries no compact line, as before', opts(), async ($, on) => {
  world(on)
  const other = { type: 'Box', props: { flexDirection: 'column' }, children: [{ type: 'Box', props: { key: 'head-words', flexDirection: 'column' }, children: [{ type: 'Text', props: {}, children: ['tail-vfx'] }] }, { type: 'Box', props: { key: 'foot' }, children: [{ type: 'Text', props: {}, children: ['Esc back'] }] }] }
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => other as never)
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  const tree = await $.ui.render({ ...PANE, surface: 'terminal' } as never)
  expect(find(tree, 'hai-a5r-line')).toBeUndefined()
})

// ---------- 0.18.3: false refusals ----------
import { A5R } from '../hooks/a5r.ts'
import { CONFIG } from './config.fixture.ts'
const refusedText = (ran: { deny?: string; isError?: boolean; text?: string }): string | undefined => ran.deny ?? (ran.isError ? ran.text : undefined)

test('A74 (0.18.3): shared-checkout git checks apply only to the S2 checkout: git in ather-mods and its worktrees runs; the same in E:/s2 is refused naming it', opts(), async ($, on) => {
  const w = world(on)
  w.put('D:/Projects/ather-mods/.git/HEAD', 'ref: refs/heads/intent/a5r')
  w.put('D:/Projects/ather-mods-wt/x/.git', 'gitdir: D:/Projects/ather-mods/.git/worktrees/x')
  w.put('E:/s2/.git/HEAD', 'ref: refs/heads/HaiHuynh/20261005')
  await $.session.start({ cwd: PROJ, surface: 'terminal', isInteractive: true } as never)
  for (const c of ['git -C D:/Projects/ather-mods worktree remove --force D:/Projects/ather-mods-wt/x', 'git -C D:/Projects/ather-mods reset --hard', 'git -C D:/Projects/ather-mods add .', 'git -C D:/Projects/ather-mods-wt/x checkout main'])
    expect([c, refusedText(await $.tool.call({ tool: 'Bash', command: c } as never))]).toEqual([c, undefined])
  const why = refusedText(await $.tool.call({ tool: 'Bash', command: 'git -C E:/s2 worktree remove --force E:/wt/y' } as never)) ?? ''
  expect(why).toContain('(the shared S2 checkout E:/s2)')
  expect(why).not.toContain('(the shared checkout)')
})

test('A85 (0.18.3): unit: copying files OUT of the live kit runs (it only reads the kit); copying INTO it stays refused', () => {
  const KIT = 'D:/Projects/ather-mods/a5r'
  const a5r = new A5R(CONFIG, { KIT, HOME: 'C:/Users/hai.huynh', USERPROFILE: 'C:/Users/hai.huynh', TEMP: 'C:/Users/HAI~1.HUY/AppData/Local/Temp', LOCALAPPDATA: 'C:/Users/hai.huynh/AppData/Local' })
  const pre = (c: string) => a5r.preShell(c, PROJ, {})?.key ?? null
  const OUT = 'D:/Projects/ather-mods-wt/x/a5r/.claude-plugin'
  for (const c of [
    `cp -r ${KIT}/.claude-plugin/types ${OUT}/`,
    `cp ${KIT}/README.md C:/tmp/readme.md`,
    `copy ${KIT}/README.md C:/tmp/readme.md /Y`,
    `Copy-Item -Recurse ${KIT}/.claude-plugin/types -Destination ${OUT}/types`,
    `Copy-Item ${KIT}/README.md C:/tmp/r.md`,
    `robocopy ${KIT}/.claude-plugin/types ${OUT}/types /E`,
    `xcopy ${KIT}/rules C:/tmp/rules /E /I`,
    `cd ${KIT} && cp hooks/editor.ts C:/tmp/editor.ts`,
  ])
    expect([c, pre(c)]).toEqual([c, null])
  for (const c of [
    `cp C:/tmp/x.ts ${KIT}/hooks/x.ts`,
    `cp ${KIT}/hooks/x.ts ${KIT}/hooks/y.ts`,
    `Copy-Item C:/tmp/x.ts -Destination ${KIT}/hooks/x.ts`,
    `robocopy C:/tmp/a5r ${KIT} /E`,
    `xcopy C:/tmp/a5r ${KIT} /E /Y`,
    `mv ${KIT}/hooks/x.ts C:/tmp/x.ts`,
    `cd ${KIT} && cp C:/tmp/x.ts hooks/x.ts`,
  ])
    expect([c, pre(c)]).toEqual([c, 'kit'])
})
