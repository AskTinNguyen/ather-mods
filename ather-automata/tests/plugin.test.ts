// The plugin as the engine loads it (`claude plugin test ather-automata`). The pure
// modules and their packs are covered by the *.test.mjs files under node; this checks
// that the hooks module, packs included, loads and answers in the engine's own host.
import { expect, mock, test } from 'claude-code/testing'

test('the module loads with its packs, and /ather answers outside a repository with intents', async $ => {
  const ran = await $.command.run({ command: 'ather', args: '' })
  expect(ran.text ?? '').toMatch(/Ather Automata works in (S2 checkouts|repositories with intents)/)
  // Where nobody answers the setup question, the answer still names the way in.
  expect(ran.text ?? '').toMatch(/\/ather setup/)
})

test('/away answers the same way, and changes nothing', async $ => {
  const ran = await $.command.run({ command: 'away', args: 'tonight' })
  expect(ran.text ?? '').toMatch(/Ather Automata works in/)
  // The pack's own sentence, as every surface shows it: it names no command.
  expect(ran.text ?? '').not.toMatch(/\/ather setup/)
})

test('/ather setup hands the session one prompt that names the steps shipped beside hooks/ and the public repository', async ($, on) => {
  const clock = mock.clock(on)
  const sent: string[] = []
  on('prompt.submit', async (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  await $.command.run({ command: 'ather', args: 'setup' })
  await clock.advance(1000)
  expect(sent.length).toBe(1)
  expect(sent[0]).toMatch(/[\\/]ather-automata[\\/]templates[\\/]intent-setup[\\/]SETUP\.md/)
  expect(sent[0]).toContain('https://github.com/AskTinNguyen/intent')
  expect(sent[0]).not.toContain('.zip')
})
