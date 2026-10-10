// @ts-check
// A prompt between the press and the session (hooks/handoff.mjs): queued or sent, one press one prompt,
// and what follows a prompt only once the session has it.
import { describe, expect, test } from 'claude-code/testing'

import { LATE_MS, PENDING_TEXT, QUEUED_TEXT, createOutbox, toldText, waitText } from '../hooks/handoff.mjs'
import { needsView, FRESH_ANSWERS } from '../hooks/decide.mjs'
import { choiceRow, needsRows } from '../hooks/rows.mjs'

// The engine as the outbox sees it: each submit waits until the test delivers or fails it, as the engine
// holds a plugin's prompt until the session is idle. Timers run when the test says.
const fakeHost = ({ isBusy = false } = {}) => {
  /** @type {{ text: string, deliver: () => void, fail: (error: Error) => void }[]} */
  const submits = []
  /** @type {{ ms: number, run: () => void }[]} */
  const timers = []
  const said = /** @type {string[]} */ ([])
  const logged = /** @type {string[]} */ ([])
  const at = { now: 1000, changes: 0, isBusy }
  return {
    submits,
    timers,
    said,
    logged,
    at,
    host: {
      submit: (/** @type {string} */ text) => new Promise((resolve, reject) => submits.push({ text, deliver: () => resolve(undefined), fail: reject })),
      after: (/** @type {number} */ ms, /** @type {() => void} */ run) => void timers.push({ ms, run }),
      isBusy: () => at.isBusy,
      onChange: () => void (at.changes += 1),
      say: (/** @type {string} */ text) => void said.push(text),
      log: (/** @type {string} */ line) => void logged.push(line),
      now: () => at.now,
    },
  }
}

// Lets the promise callbacks of a delivery or a failure run.
const settled = () => new Promise(resolve => setTimeout(resolve, 5))

describe('handing a prompt to the session: queued or sent', () => {
  test('with the session idle a press is sent: the prompt goes out once and nothing more is said', async () => {
    const outbox = createOutbox()
    const { host, submits, said } = fakeHost()
    let delivered = 0
    expect(outbox.hand(host, ['next:spawner:brief'], 'Start the work', () => void (delivered += 1))).toBe('sent')
    expect(submits.map(one => one.text)).toEqual(['Start the work'])
    expect([outbox.isWaiting('next:spawner:brief'), outbox.isQueued('next:spawner:brief')]).toEqual([true, false])
    submits[0]?.deliver()
    await settled()
    expect([delivered, outbox.isWaiting('next:spawner:brief'), said.length]).toEqual([1, false, 0])
  })

  test('while a turn runs a press is queued, not sent: it says so, and says sent when the session has it', async () => {
    const outbox = createOutbox()
    const { host, submits, said, at, logged } = fakeHost({ isBusy: true })
    let delivered = 0
    const handed = outbox.hand(host, ['review:1'], 'I am back', () => void (delivered += 1))
    expect(handed).toBe('queued')
    expect(toldText(handed, 'Sent to the session.')).toBe(QUEUED_TEXT)
    expect(QUEUED_TEXT).toMatch(/^Queued until this turn ends/)
    expect([outbox.isQueued('review:1'), outbox.queued()]).toEqual([true, ['review:1']])
    // The turn runs on for 3 minutes 38 seconds: nothing that follows the prompt has happened.
    at.now += 218000
    await settled()
    expect([delivered, said.length]).toEqual([0, 0])
    submits[0]?.deliver()
    await settled()
    expect(delivered).toBe(1)
    expect(said).toEqual(['Sent to the session: it was queued for 3m 38s.'])
    expect([outbox.isWaiting('review:1'), outbox.queued()]).toEqual([false, []])
    // The debug log has the press and the delivery, each with its time.
    expect(logged[0]).toMatch(/^pressed at \d{4}-\d\d-\d\dT[\d:.]+Z, queued behind the running turn: review:1$/)
    expect(logged.at(-1)).toBe('delivered after 218000 ms: review:1')
  })

  test('a press for something that already waits does nothing: one prompt, however often it is pressed', async () => {
    const outbox = createOutbox()
    const { host, submits } = fakeHost({ isBusy: true })
    let delivered = 0
    expect(outbox.hand(host, ['next:web-load-speed:prove'], 'Prove intent web-load-speed', () => void (delivered += 1))).toBe('queued')
    const again = outbox.hand(host, ['next:web-load-speed:prove'], 'Prove intent web-load-speed', () => void (delivered += 1))
    expect(again).toBe('pending')
    expect(toldText(again, 'Sent to the session.')).toBe(PENDING_TEXT)
    expect(outbox.hand(host, ['next:web-load-speed:prove'], 'Prove intent web-load-speed')).toBe('pending')
    expect(submits).toHaveLength(1)
    submits[0]?.deliver()
    await settled()
    expect(delivered).toBe(1)
    // Once the session has it, the same thing can be asked for again.
    expect(outbox.hand(host, ['next:web-load-speed:prove'], 'Prove intent web-load-speed')).toBe('queued')
    expect(submits).toHaveLength(2)
  })

  test('a prompt with no id is known by its text; several ids wait together', async () => {
    const outbox = createOutbox()
    const { host, submits } = fakeHost({ isBusy: true })
    expect(outbox.hand(host, [], 'Explain decision F-3 on web-load-speed')).toBe('queued')
    expect(outbox.hand(host, [], 'Explain decision F-3 on web-load-speed')).toBe('pending')
    expect(outbox.hand(host, [], 'Explain decision F-4 on web-load-speed')).toBe('queued')
    expect(outbox.hand(host, ['lost', 'rule:a'], 'Go through 2 things')).toBe('queued')
    // One of a batch's ids pressed alone while the batch waits sends nothing.
    expect(outbox.hand(host, ['rule:a'], 'Make it a rule')).toBe('pending')
    expect(submits).toHaveLength(3)
  })

  test('a prompt not delivered after a few seconds is shown as queued, even when no turn was seen to start', async () => {
    const outbox = createOutbox()
    const { host, submits, timers, said, at } = fakeHost()
    expect(outbox.hand(host, ['lost'], 'See what a merge lost')).toBe('sent')
    expect(timers.map(one => one.ms)).toEqual([LATE_MS])
    const changes = at.changes
    timers[0]?.run()
    expect([outbox.isQueued('lost'), said, at.changes > changes]).toEqual([true, [QUEUED_TEXT], true])
    at.now += 60000
    submits[0]?.deliver()
    await settled()
    expect(said.at(-1)).toBe('Sent to the session: it was queued for 1m 00s.')
    // Delivered in time: the timer changes nothing.
    const quick = fakeHost()
    outbox.hand(quick.host, ['lost'], 'See what a merge lost')
    quick.submits[0]?.deliver()
    await settled()
    quick.timers[0]?.run()
    expect([outbox.isQueued('lost'), quick.said.length]).toEqual([false, 0])
  })

  test('a prompt that could not be sent is offered again, and says why', async () => {
    const outbox = createOutbox()
    const { host, submits, said } = fakeHost()
    let failed = 0
    let delivered = 0
    outbox.hand(host, ['editor'], 'Ask for the Editor', () => void (delivered += 1), () => void (failed += 1))
    submits[0]?.fail(new Error('the prompt box is busy'))
    await settled()
    expect([failed, delivered, outbox.isWaiting('editor')]).toEqual([1, 0, false])
    expect(said).toEqual(['could not send to the session: Error: the prompt box is busy'])
    expect(outbox.hand(host, ['editor'], 'Ask for the Editor')).toBe('sent')
  })

  test('a new session starts with nothing waiting', () => {
    const outbox = createOutbox()
    const { host } = fakeHost({ isBusy: true })
    outbox.hand(host, ['lost'], 'See what a merge lost')
    outbox.reset()
    expect([outbox.isWaiting('lost'), outbox.queued()]).toEqual([false, []])
  })

  test('how long a prompt waited, in words', () => {
    expect([waitText(86), waitText(42000), waitText(131000), waitText(218000)]).toEqual(['1s', '42s', '2m 11s', '3m 38s'])
  })
})

// Elements as plain nodes, to read what a row draws.
const el = Object.fromEntries(['Box', 'Text', 'Button', 'Input'].map(type => [type, (/** @type {any} */ props = {}) => ({ type, props })]))
/** @param {any} node @returns {string[]} */
const labels = node => (Array.isArray(node) ? node.flatMap(labels) : !node || typeof node !== 'object' ? [] : [...(node.type === 'Button' ? [String(node.props.label)] : []), ...labels(node.props?.children), ...labels(node.props?.below)])

describe('a row handed over while a turn runs', () => {
  test('reads "queued", not "sent", until the session has it', () => {
    const row = { key: 'next', title: 'Prove it', width: 60, onPress: () => undefined }
    expect(labels(choiceRow(el, { ...row, isSent: true, isQueued: true }, false))).toEqual(['⏳ queued · Prove it'])
    expect(labels(choiceRow(el, { ...row, isSent: true }, false))).toEqual(['✓ sent · Prove it'])
    expect(labels(choiceRow(el, row, false))).toEqual(['Prove it'])
  })

  test('in Needs you, the queued thing is marked and the others are not', () => {
    /** @type {any[]} */
    const items = [
      { kind: 'review', id: 'review:1', label: 'Review: 2 decisions', title: 'Review what happened while you were away (2 decisions)', question: '', prompt: 'I am back.' },
      { kind: 'lost', id: 'lost', label: 'See what a merge lost', title: 'A merge dropped your edits', question: '', prompt: '' },
    ]
    const press = () => () => undefined
    const open = items.slice(1)
    const answer = { view: needsView(items, open, { ...FRESH_ANSWERS }, new Set(), 0, true), onOpen: press, onAnswer: press, onExplain: press, onType: press, onTyped: press, onFindings: press, onFold: () => undefined }
    const drawn = labels(needsRows(el, false, { items, open, queued: new Set(['review:1']), opened: new Set(), width: 80, key: () => undefined, onAct: press, onToggle: press, answer: /** @type {any} */ (answer) }))
    expect(drawn).toEqual(['⏳ queued · Review: 2 decisions', 'See what a merge lost'])
  })
})
