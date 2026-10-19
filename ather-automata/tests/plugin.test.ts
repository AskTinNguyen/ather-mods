// The plugin as the engine loads it (`claude plugin test ather-automata`). The pure
// modules and their packs are covered by the *.test.mjs files under node; this checks
// that the hooks module, packs included, loads and answers in the engine's own host.
import { expect, mock, test } from 'claude-code/testing'

test('the module loads with its packs, and /ather answers outside a repository with intents', async $ => {
  const ran = await $.command.run({ command: 'ather', args: '' })
  // The pack's own sentence, as every surface shows it.
  expect(ran.text ?? '').toMatch(/Ather Automata works in (S2 checkouts|repositories with intents)/)
  // It names no command: Ather does not set a repository up.
  expect(ran.text ?? '').not.toMatch(/setup/i)
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
})

// Keeping the prompt cache warm (warm.mjs, watch.mjs): the world beneath answers the session's usage, the fork and the
// status line from memory, and the mocked clock moves the idle time on.
const CONTEXT = 150000
const MINUTE = 60000
type Reads = { reads: number[], forks: string[], status: (string | undefined)[], cost: number }

function warmWorld(on: any, world: Reads) {
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }))
  on('session.id', () => ({ value: 'warm-test-session' }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: CONTEXT, window: 200000 }, rateLimits: [], cost: { usd: world.cost } } }))
  on('model.fork', (_$: unknown, e: { prompt: string }) => {
    world.forks.push(e.prompt)
    world.cost += 0.075
    return { value: { isAnswered: true, text: '.', usage: { input_tokens: 20, output_tokens: 1, cache_read_input_tokens: world.reads.shift() ?? CONTEXT, cache_creation_input_tokens: 0 } } }
  })
  on('ui.status', (_$: unknown, e: { text: string | undefined }) => {
    world.status.push(e.text)
    return { value: undefined }
  })
}

const turnUsage = (read: number, written: number) => ({ input_tokens: 50, output_tokens: 200, cache_read_input_tokens: read, cache_creation_input_tokens: written, model: 'claude-opus-5-5' })
const endTurn = ($: any, read = CONTEXT, written = 500) => $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer', usage: turnUsage(read, written) })

test('keep warm on: a ping each 55 minutes up to the cap, then a warm return is counted', { options: { cacheKeepWarm: 'on' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const world: Reads = { reads: [], forks: [], status: [], cost: 0 }
  warmWorld(on, world)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  // Past the session's first turn, whose cache no later request reads.
  await $.prompt.submit({ text: 'first' })
  await endTurn($)
  await $.prompt.submit({ text: 'second' })
  await endTurn($)
  await clock.settle()
  expect(world.status.at(-1) ?? '').toMatch(/^◔ warm 0\/3 · next /)
  await clock.advance(54 * MINUTE)
  expect(world.forks.length).toBe(0)
  await clock.advance(1 * MINUTE)
  expect(world.forks.length).toBe(1)
  expect(world.status.at(-1) ?? '').toMatch(/^◔ warm 1\/3/)
  await clock.advance(55 * MINUTE)
  await clock.advance(55 * MINUTE)
  expect(world.forks.length).toBe(3)
  // The cap: no fourth ping, and the status line is cleared.
  await clock.advance(55 * MINUTE)
  expect(world.forks.length).toBe(3)
  expect(world.status.at(-1)).toBe(undefined)
  // A plugin's own prompt (as an away window's work) is not the person coming back: the reads are counted, no return.
  // A person's return is warm.test.mjs's ("a person's return after reads is counted warm"): the kit's prompts are a plugin's.
  await $.prompt.submit({ text: 'work' })
  await endTurn($)
  await clock.settle()
  const report = (await $.command.run({ command: 'warm', args: '' })).text ?? ''
  expect(report).toMatch(/3 pings · 0 returns warm, 0 cold · \$0\.2[23] spent/)
})

test('after the first turn alone, no read: its cache is never read again', { options: { cacheKeepWarm: 'on' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const world: Reads = { reads: [], forks: [], status: [], cost: 0 }
  warmWorld(on, world)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'only' })
  await endTurn($)
  await clock.advance(120 * MINUTE)
  expect(world.forks.length).toBe(0)
  expect((await $.command.run({ command: 'warm', args: '' })).text ?? '').toMatch(/from your second turn/)
})

test('keep warm is off by default: no ping in two idle hours', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const world: Reads = { reads: [], forks: [], status: [], cost: 0 }
  warmWorld(on, world)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  // Past the session's first turn, whose cache no later request reads.
  await $.prompt.submit({ text: 'first' })
  await endTurn($)
  await $.prompt.submit({ text: 'second' })
  await endTurn($)
  await clock.advance(120 * MINUTE)
  expect(world.forks.length).toBe(0)
  expect((await $.command.run({ command: 'warm', args: '' })).text ?? '').toMatch(/^Keep the cache warm: off\./)
})

test('/warm on turns it on for the session; a ping that misses stops the idle period', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const world: Reads = { reads: [0], forks: [], status: [], cost: 0 }
  warmWorld(on, world)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  // Past the session's first turn, whose cache no later request reads.
  await $.prompt.submit({ text: 'first' })
  await endTurn($)
  await $.prompt.submit({ text: 'second' })
  await endTurn($)
  expect((await $.command.run({ command: 'warm', args: '2h' })).text ?? '').toMatch(/^Keep the cache warm: on; next read at .* \(0 of 2 this idle period\)\. Cap 2 hours, set for this session\./)
  await clock.advance(55 * MINUTE)
  expect(world.forks.length).toBe(1)
  await clock.advance(120 * MINUTE)
  expect(world.forks.length).toBe(1)
  expect((await $.command.run({ command: 'warm', args: '' })).text ?? '').toMatch(/stopped for this idle period[\s\S]*1 missed/)
})

test('a re-write after 20 idle minutes means the five-minute TTL: keep warm pauses', { options: { cacheKeepWarm: 'on' } }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const world: Reads = { reads: [], forks: [], status: [], cost: 0 }
  warmWorld(on, world)
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  // Past the session's first turn, whose cache no later request reads.
  await $.prompt.submit({ text: 'first' })
  await endTurn($)
  await $.prompt.submit({ text: 'second' })
  await endTurn($)
  await clock.advance(20 * MINUTE)
  await $.prompt.submit({ text: 'next' })
  await endTurn($, 0, CONTEXT)
  await clock.advance(120 * MINUTE)
  expect(world.forks.length).toBe(0)
  expect((await $.command.run({ command: 'warm', args: '' })).text ?? '').toMatch(/paused: the cache lives five minutes/)
})
