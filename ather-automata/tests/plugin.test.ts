// The plugin as the engine loads it (`claude plugin test ather-automata`). The pure
// modules and their packs are covered by the *.test.mjs files under node; this checks
// that the hooks module, packs included, loads and answers in the engine's own host.
import { expect, mock, test } from 'claude-code/testing'

test('the module loads with its packs, and /ather answers outside a repository with intents', async $ => {
  const ran = await $.command.run({ command: 'ather', args: '' })
  // The pack's own sentence, as every surface shows it.
  expect(ran.text ?? '').toMatch(/Ather Automata works in (S2 checkouts|repositories with intents)/)
})

test('/away answers the same way, and changes nothing', async $ => {
  const ran = await $.command.run({ command: 'away', args: 'tonight' })
  expect(ran.text ?? '').toMatch(/Ather Automata works in/)
})

test('setup typed after /ather there submits no prompt and answers as /ather does', async ($, on) => {
  const clock = mock.clock(on)
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  const plain = await $.command.run({ command: 'ather', args: '' })
  const ran = await $.command.run({ command: 'ather', args: 'setup' })
  await clock.advance(1000)
  expect(sent.length).toBe(0)
  expect(ran.text ?? '').toBe(plain.text ?? '')
  expect(ran.text ?? '').toMatch(/Ather Automata works in/)
})
