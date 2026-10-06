// The plugin as the engine loads it (`claude plugin test ather-automata`). The pure
// modules and their packs are covered by the *.test.mjs files under node; this checks
// that the hooks module, packs included, loads and answers in the engine's own host.
import { expect, test } from 'claude-code/testing'

test('the module loads with its packs, and /ather answers outside a repository with intents', async $ => {
  const ran = await $.command.run({ command: 'ather', args: '' })
  expect(ran.text ?? '').toMatch(/Ather Automata works in (S2 checkouts|repositories with intents)/)
})

test('/away answers the same way, and changes nothing', async $ => {
  const ran = await $.command.run({ command: 'away', args: 'tonight' })
  expect(ran.text ?? '').toMatch(/Ather Automata works in/)
})
