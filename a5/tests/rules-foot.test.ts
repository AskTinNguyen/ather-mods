import { expect, test } from 'claude-code/testing'
import { LOCK, A5PANE, PANE, PENDING, PROJ, all, atherTree, find, keys, opts, text, world } from './world.ts'

// A27 (A29 since 0.9): the five rules are the A5 pane's last block (Ather's pane carries none), a small "A5 · Năm điều" heading then one rule per line, in the quietest text the surface offers
// (quiet grey, dimmed), with rule 1's tổ quốc / project switch kept.
const RULE_LINES = ['Học tập tốt, lao động tốt', 'Đoàn kết tốt, kỷ luật tốt', 'Giữ gìn vệ sinh thật tốt', 'Khiêm tốn, thật thà, dũng cảm']

for (const surface of ['terminal', 'desktop'] as const)
  for (const home of [true, false])
    test(`A27 (${surface}, ${home ? 'home' : 'another view'}): the rules are the last block, a heading and five lines, dim; rule 1 still switches`, opts(), async ($, on) => {
      world(on, { a5: true })
      on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(home))
      await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
      const tree = await $.ui.render({ ...A5PANE, surface } as never)
      expect(keys(tree).at(-1)).toBe('hai-a5-rules')
      expect(find(await $.ui.render({ ...PANE, surface } as never), 'hai-a5-rules')).toBeUndefined() // none in Ather's pane, any view
      const rules = find(tree, 'hai-a5-rules')
      expect(rules?.props?.flexDirection).toBe('column')
      const lines = (rules?.children ?? []).map(c => (c as { props?: { key?: string } }).props?.key)
      expect(lines).toEqual(['hai-a5-rules-head', 'hai-a5-rule1', 'hai-a5-rule2', 'hai-a5-rule3', 'hai-a5-rule4', 'hai-a5-rule5'])
      expect(text(find(tree, 'hai-a5-rules-head'))).toBe('A5 · Năm điều')
      for (const [n, words] of RULE_LINES.entries()) expect(text(find(tree, `hai-a5-rule${n + 2}`))).toBe(`${n + 2} ${words}`)
      expect(text(find(tree, 'hai-a5-rule1'))).toBe('1 , yêu đồng bào') // the word itself is the Client's
      expect(find(tree, 'hai-rule1')?.type).toBe('Client')
      expect((find(tree, 'hai-rule1')?.props?.props as { dim?: boolean } | undefined)?.dim).toBe(true)
      const texts = all(rules).filter(n => n.type === 'Text')
      expect(texts.length).toBeGreaterThan(5)
      expect(texts.filter(n => n.props?.dimColor !== true && n.props?.color !== '#E8B84A')).toEqual([]) // only a gold hit count is not dim
    })

test('A27: motion off keeps the same block with "1 Yêu Project, yêu đồng bào" as a plain dim line', { options: { a5WhenPresent: 'deny', editorLock: LOCK, pendingFile: PENDING, motion: 'off' } }, async ($, on) => {
  world(on, { a5: true })
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  const tree = await $.ui.render({ ...A5PANE, surface: 'desktop' } as never)
  expect(text(find(tree, 'hai-a5-rule1'))).toBe('1 Yêu Project, yêu đồng bào')
  expect(find(tree, 'hai-a5-rule1')?.children?.[0]).toMatchObject({ type: 'Text', props: { dimColor: true } })
  expect(keys(tree).at(-1)).toBe('hai-a5-rules')
})
