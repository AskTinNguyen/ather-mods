import { expect, test, type Mounted } from 'claude-code/testing'
import { shown } from '../hooks/rule1.ts'
import { LOCK, A5PANE, PENDING, PROJ, atherTree, find, opts, text, world } from './world.ts'

// A20: the footer's first rule switches "Yêu tổ quốc" / "Yêu project" at random intervals while A5 and motion are
// on, in a Client of its own (so a switch redraws that word only); motion off shows "Yêu Project" and no Client.
for (const surface of ['terminal', 'desktop'] as const) {
  test(`A20 (${surface}): over a mocked frame clock rule 1 shows both words, and nothing else of the footer changes`, opts(), async ($, on) => {
    world(on, { a5: true })
    on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
    await $.session.start({ cwd: PROJ, surface, isInteractive: true } as never)
    const ui = (await $.ui.mount({ plugin: 'a5', surface, component: 'Pane', requestId: 'a5', props: A5PANE.props } as never)) as unknown as Mounted<'terminal'>
    const words = new Set<string>()
    const rest = new Set<string>()
    for (let n = 0; n < 60; n += 1) {
      await ui.advance(500)
      const word = (await ui.find({ in: 'hai-rule1', text: /Yêu/ } as never))?.text
      if (word && /^Yêu (tổ quốc|project)$/.test(word)) words.add(word)
      rest.add(String((await ui.findAll({ type: 'Text', text: /Năm điều/ } as never)).map(f => f.text).join('|'))) // A32: the heading the word rides
    }
    expect([...words].sort()).toEqual(['Yêu project', 'Yêu tổ quốc'])
    expect(rest.size).toBe(1) // the rest of the footer never moved
    await ui.unmount() // the pane closes: the Client and its timer go with it
  })
}

test('A20: with motion off the footer says "Yêu Project" and holds no switching element', { options: { a5WhenPresent: 'deny', editorLock: LOCK, pendingFile: PENDING, motion: 'off' } }, async ($, on) => {
  world(on, { a5: true })
  on('ui.render', { component: 'Pane', requestId: 'ather' }, async () => atherTree(true))
  await $.session.start({ cwd: PROJ, surface: 'desktop', isInteractive: true } as never)
  const tree = await $.ui.render({ ...A5PANE, surface: 'desktop' } as never)
  expect(text(find(tree, 'hai-a5-rules-head'))).toBe('Năm điều·Yêu Project') // A32: rule 1's motto rides the seals' heading
  expect(find(tree, 'hai-rule1')).toBeUndefined()
})

test('A20: the desktop flip is a short dither over the letters; the terminal swaps plain text', () => {
  expect(shown(1, 0, true)).toBe('Yêu tổ quốc')
  expect(shown(1, 1, true)).not.toBe('Yêu tổ quốc')
  expect(shown(1, 1, true)).toMatch(/▓/)
  expect(shown(1, 3, true)).toMatch(/░/)
  expect(shown(1, 2, false)).toBe('Yêu tổ quốc')
  expect(shown(0, 4, true)).toBe('Yêu project')
})
