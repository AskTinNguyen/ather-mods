// @ts-check
import { describe, expect, test } from 'claude-code/testing'

import { AVOIDED_PER_PING, IDLE_ENV, MAX_AWAY_HOURS, MIN_CONTEXT_TOKENS, awayHours, OFF_VIEW, initialWarm, stepWarm, WARM_MARGIN_MS, addLedger, emptyLedger, hoursOf, isHit, isRewrite, learnTtl, maxPings, modeOf, newPeriod, nextPingAt, parseWarmArgs, returnChange, skipReason, statusText, toggleText, ttlMs, viewOf, warmBadge, warmPaneText, warmReport } from '../hooks/warm.mjs'

const MIN = 60 * 1000
const HOUR = 60 * MIN
const CONTEXT = 150000

/** @param {Partial<import('../hooks/warm.mjs').Facts>} [fields] @returns {import('../hooks/warm.mjs').Facts} */
const facts = (fields = {}) => ({ mode: 'on', hours: 3, ttl: '1h', isBusy: false, isInteractive: true, turns: 4, away: { phase: 'off', untilDone: false, startedAt: 0, wakeAt: 0 }, quota: 0, byAway: false, ...fields })
const usage = (read = 0, written = 0) => ({ input_tokens: 10, output_tokens: 2, cache_read_input_tokens: read, cache_creation_input_tokens: written })

describe('keep warm: timing (A3)', () => {
  test('a ping is due five minutes before the hour, and the cap counts 55-minute steps', () => {
    expect(nextPingAt(newPeriod(0, CONTEXT), '1h')).toBe(HOUR - WARM_MARGIN_MS)
    expect(maxPings(3, '1h')).toBe(3)
    expect(maxPings(1, '1h')).toBe(1)
    expect(maxPings(6, '1h')).toBe(6)
    expect(maxPings(3, '5m')).toBe(0)
    expect(ttlMs('5m')).toBe(5 * MIN)
  })

  test('a timer that fires at or past the TTL (the machine slept) does not ping', () => {
    const period = newPeriod(0, CONTEXT)
    expect(skipReason(period, 55 * MIN, facts())).toBe('')
    expect(skipReason(period, HOUR, facts())).toBe('lapsed')
    expect(skipReason(period, 3 * HOUR, facts())).toBe('lapsed')
  })
})

describe('keep warm: guards (A4)', () => {
  const period = newPeriod(0, CONTEXT)
  const at = 55 * MIN

  test('each guard has its reason', () => {
    expect(skipReason(period, at, facts({ mode: 'off' }))).toBe('off')
    expect(skipReason(period, at, facts({ mode: 'ask' }))).toBe('off')
    expect(skipReason(period, at, facts({ isInteractive: false }))).toBe('unattended')
    expect(skipReason(null, at, facts())).toBe('no-turn')
    expect(skipReason(period, at, facts({ turns: 1 }))).toBe('first-turn')
    expect(skipReason({ ...period, isStopped: true }, at, facts())).toBe('stopped')
    expect(skipReason(period, at, facts({ ttl: '5m' }))).toBe('short-ttl')
    expect(skipReason(period, at, facts({ isBusy: true }))).toBe('busy')
    expect(skipReason(newPeriod(0, MIN_CONTEXT_TOKENS - 1), at, facts())).toBe('small')
    expect(skipReason({ ...period, pings: 3 }, at, facts())).toBe('cap')
    expect(skipReason(period, at, facts({ quota: 86 }))).toBe('quota')
    expect(skipReason(period, at, facts({ quota: 85 }))).toBe('')
  })

  test('an away window: until done never pings; a window ending within the cap does, one ending after it does not', () => {
    expect(skipReason(period, at, facts({ away: { phase: 'running', untilDone: true, startedAt: 0, wakeAt: 0 } }))).toBe('away')
    expect(skipReason(period, at, facts({ away: { phase: 'running', untilDone: false, startedAt: 0, wakeAt: 2 * HOUR } }))).toBe('')
    expect(skipReason(period, at, facts({ away: { phase: 'running', untilDone: false, startedAt: 0, wakeAt: 9 * HOUR } }))).toBe('away')
    // A window under review: the person may be back any moment.
    expect(skipReason(period, at, facts({ away: { phase: 'review', untilDone: false, startedAt: 0, wakeAt: 9 * HOUR } }))).toBe('')
  })
})

describe('keep warm: reading usage (A5, A6)', () => {
  test('a hit is a read of at least 90% of the context; a re-write is a write of at least 80%', () => {
    expect(isHit(usage(CONTEXT * 0.95), CONTEXT)).toBe(true)
    expect(isHit(usage(CONTEXT * 0.5, CONTEXT * 0.5), CONTEXT)).toBe(false)
    expect(isHit(usage(0), 0)).toBe(false)
    expect(isRewrite(usage(0, CONTEXT), CONTEXT)).toBe(true)
    expect(isRewrite(usage(CONTEXT, 2000), CONTEXT)).toBe(false)
  })

  test('the TTL is five minutes when a turn re-wrote after a gap the hour should have covered', () => {
    expect(learnTtl(20 * MIN, usage(0, CONTEXT), CONTEXT)).toBe('5m')
    expect(learnTtl(20 * MIN, usage(CONTEXT), CONTEXT)).toBe(null)
    // Under five minutes nothing lapses either way; past 55 the hour may have.
    expect(learnTtl(3 * MIN, usage(0, CONTEXT), CONTEXT)).toBe(null)
    expect(learnTtl(58 * MIN, usage(0, CONTEXT), CONTEXT)).toBe(null)
  })
})

describe('keep warm: the ledger (A1, A7)', () => {
  const pinged = { ...newPeriod(2 * HOUR, CONTEXT), pings: 2, lastPingUsd: 0.08 }

  test('a return after pings is warm (and saves 19 pings\' worth), cold, or wasted when the cache had lapsed', () => {
    expect(returnChange(pinged, 2 * HOUR + 20 * MIN, usage(CONTEXT), '1h')).toEqual({ returnsWarm: 1, avoidedUsd: 0.08 * AVOIDED_PER_PING })
    expect(returnChange(pinged, 2 * HOUR + 20 * MIN, usage(0, CONTEXT), '1h')).toEqual({ returnsCold: 1 })
    expect(returnChange(pinged, 4 * HOUR, usage(0, CONTEXT), '1h')).toEqual({ wasted: 2, returnsCold: 1 })
    expect(returnChange(newPeriod(0, CONTEXT), 10 * MIN, usage(0, CONTEXT), '1h')).toEqual({})
  })

  test('changes add up', () => {
    const ledger = addLedger(addLedger(emptyLedger(), { pings: 1, pingUsd: 0.05 }), { pings: 1, pingUsd: 0.05, returnsWarm: 1 })
    expect(ledger.pings).toBe(2)
    expect(ledger.returnsWarm).toBe(1)
    expect(Math.round(ledger.pingUsd * 100)).toBe(10)
  })

  test('the status line and /warm say what is on and what it came to', () => {
    // 21:55 at UTC+7 for a period that ended at 21:00.
    const period = { ...newPeriod(Date.UTC(2026, 9, 10, 14, 0), CONTEXT), pings: 1 }
    expect(statusText(period, facts(), 7 * 60)).toBe('◔ warm 1/3 · next 21:55')
    const report = warmReport({ reason: '', period, facts: facts(), tz: 7 * 60, ledger: { ...emptyLedger(), pings: 4, returnsWarm: 1, pingUsd: 0.3, avoidedUsd: 1.43 }, source: 'set for this session' })
    expect(report).toMatch(/^Keep the cache warm: on; next read at 21:55 \(1 of 3 this idle period\)\. Cap 3 hours, set for this session\./)
    expect(report).toMatch(/On this machine: 4 pings · 1 return warm, 0 cold · \$0\.30 spent, ~\$1\.43 re-write avoided\./)
    expect(warmReport({ reason: 'off', period: null, facts: facts({ mode: 'off' }), tz: 0, ledger: emptyLedger(), source: 'from the plugin settings' })).toBe('Keep the cache warm: off. Cap 3 hours, from the plugin settings.\n/warm on keeps it warm while you are idle; /warm 2h sets the cap.')
  })
})

describe('keep warm: settings and /warm (A2)', () => {
  test('options read safely', () => {
    expect(modeOf('on')).toBe('on')
    expect(modeOf('ask')).toBe('ask')
    expect(modeOf('yes')).toBe('off')
    expect(hoursOf('6')).toBe(6)
    expect(hoursOf('')).toBe(3)
    expect(hoursOf('40')).toBe(12)
  })

  test('/warm words', () => {
    expect(parseWarmArgs('')).toEqual({})
    expect(parseWarmArgs('on')).toEqual({ mode: 'on' })
    expect(parseWarmArgs('OFF')).toEqual({ mode: 'off' })
    expect(parseWarmArgs('2h')).toEqual({ hours: 2, mode: 'on' })
    expect(parseWarmArgs('on 90m')).toEqual({ mode: 'on', hours: 1.5 })
    expect(parseWarmArgs('off 2h')).toEqual({ mode: 'off', hours: 2 })
    // A space before the unit, as people type it; 12 hours at most.
    expect(parseWarmArgs('10 hours')).toEqual({ hours: 10, mode: 'on' })
    expect(parseWarmArgs('on 10 h')).toEqual({ mode: 'on', hours: 10 })
    expect(parseWarmArgs('90 min')).toEqual({ hours: 1.5, mode: 'on' })
    expect(parseWarmArgs('20 hours')).toEqual({ hours: 12, mode: 'on' })
    expect(parseWarmArgs('10 apples')).toBe(null)
    expect(parseWarmArgs('please')).toBe(null)
  })
})

describe('keep warm: the row above the prompt and the pane', () => {
  const at = Date.UTC(2026, 9, 10, 14, 0) // 21:00 at UTC+7
  const armed = viewOf({ ...newPeriod(at, CONTEXT), pings: 1 }, facts(), '', 7 * 60)

  test('the view says on, reads of the cap and the next read', () => {
    expect(armed).toEqual({ isOn: true, pings: 1, cap: 3, reason: '', next: '21:55' })
    expect(viewOf(null, facts({ mode: 'off' }), 'off', 0)).toEqual({ ...OFF_VIEW, cap: 3 })
  })

  test('the row: a dim ◔ when off or paused, the count in amber while a read is due', () => {
    expect(warmBadge(OFF_VIEW)).toEqual({ label: '◔', isDim: true, count: '' })
    expect(warmBadge(armed)).toEqual({ label: '◔', isDim: false, count: '1/3' })
    expect(warmBadge({ ...armed, reason: 'busy', next: '' })).toEqual({ label: '◔', isDim: false, count: '' })
    expect(warmBadge({ ...armed, reason: 'short-ttl', next: '' })).toEqual({ label: '◔ –', isDim: true, count: '' })
  })

  test('a press says what it did', () => {
    const period = newPeriod(at, CONTEXT)
    expect(toggleText(true, '', period, facts(), 7 * 60)).toBe('Keep-warm on for this session: the cache is read at 21:55, for up to 3 hours. /warm 2h changes the cap.')
    expect(toggleText(true, 'first-turn', period, facts({ hours: 1 }), 0)).toBe("Keep-warm on for this session, for up to 1 hour: from your second turn (a session's first turn leaves nothing the next one reads).")
    expect(toggleText(false, 'off', period, facts(), 0)).toBe('Keep-warm off. The cache lapses an hour after your last turn.')
    expect(toggleText(true, 'short-ttl', period, facts({ ttl: '5m' }), 0)).toMatch(/^The cache lives five minutes in this session/)
  })

  test("the pane's Stepping out? line and button", () => {
    expect(warmPaneText(OFF_VIEW).action).toBe('Keep the cache warm')
    expect(warmPaneText(armed)).toEqual({ text: 'Kept warm: 1 of 3 reads done, the next at 21:55.', action: 'Stop keeping warm' })
    expect(warmPaneText({ ...armed, reason: 'busy', next: '' })).toEqual({ text: 'Keep-warm is on; a turn is running.', action: 'Stop keeping warm' })
    expect(warmPaneText({ ...armed, reason: 'short-ttl', next: '' }).action).toBe('')
  })
})

describe('keep warm: an away window hands it over', () => {
  const window = (hours, fields = {}) => ({ phase: 'running', untilDone: false, startedAt: 0, wakeAt: hours * HOUR, ...fields })

  test('a window of so many hours keeps it warm one hour past its end, up to 17; until done and no window give none', () => {
    expect(awayHours(window(8))).toBe(9)
    expect(awayHours(window(4))).toBe(5)
    expect(awayHours(window(0.5))).toBe(2)
    expect(awayHours(window(16))).toBe(MAX_AWAY_HOURS)
    expect(awayHours(window(8, { phase: 'review' }))).toBe(9)
    expect(awayHours(window(24, { untilDone: true }))).toBe(0)
    expect(awayHours({ phase: 'off', untilDone: false, startedAt: 0, wakeAt: 0 })).toBe(0)
  })

  test("with the window's cap, reads go on while it runs: idle from hour 2 of an 8-hour window, the reads reach past its end", () => {
    const period = newPeriod(2 * HOUR, CONTEXT)
    const during = facts({ hours: awayHours(window(8)), byAway: true, away: window(8) })
    expect(maxPings(during.hours, '1h')).toBe(9)
    expect(skipReason(period, 2 * HOUR + 55 * MIN, during)).toBe('')
    // Seven reads in, the window has ended (it waits for review) and the eighth is still due: the person is due back.
    expect(skipReason({ ...period, lastAt: 8 * HOUR + 25 * MIN, pings: 7 }, 9 * HOUR + 20 * MIN, { ...during, away: window(8, { phase: 'review' }) })).toBe('')
  })
})

describe('keep warm: the state machine (stepWarm)', () => {
  /** @param {number} now @param {Partial<import('../hooks/warm.mjs').WarmEnv>} [fields] */
  const env = (now, fields = {}) => ({ ...IDLE_ENV, now, context: CONTEXT, ...fields })
  const hitUsage = { cache_read_input_tokens: CONTEXT, cache_creation_input_tokens: 0 }
  /** @param {import('../hooks/warm.mjs').WarmEffect[]} effects @param {string} type */
  const of = (effects, type) => effects.filter(one => one.type === type)
  // Runs events in order from a state, collecting every effect; each event at its own time.
  /** @param {import('../hooks/warm.mjs').WarmState} from @param {[import('../hooks/warm.mjs').WarmEvent, number][]} events */
  const run = (from, events) => {
    let state = from
    /** @type {import('../hooks/warm.mjs').WarmEffect[]} */
    const effects = []
    let reply = ''
    for (const [event, now] of events) {
      const step = stepWarm(state, event, env(now))
      state = step.state
      effects.push(...step.effects)
      reply = step.reply
    }
    return { state, effects, reply }
  }
  /** @param {boolean} isPerson @returns {[import('../hooks/warm.mjs').WarmEvent, number][]} */
  const turn = (isPerson, at, usage = hitUsage) => [[{ type: 'turnStart', isPerson }, at], [{ type: 'turnEnd', usage }, at]]
  // A session with keep-warm on, past its second turn at minute 0.
  const warmed = () => run(initialWarm('on', 3), [[{ type: 'start', attended: true, choice: {} }, 0], ...turn(true, 0), ...turn(true, 0)])

  test('past the second turn a read is armed 55 minutes out, and the status line and the view say so', () => {
    const { state, effects } = warmed()
    const arm = of(effects, 'arm').at(-1)
    expect(arm).toEqual({ type: 'arm', id: state.period?.id ?? -1, delay: 55 * MIN })
    expect(of(effects, 'view').at(-1)).toEqual({ type: 'view', view: { isOn: true, pings: 0, cap: 3, reason: '', next: '00:55' } })
    expect(of(run(initialWarm('on', 3), [[{ type: 'start', attended: true, choice: {} }, 0], ...turn(true, 0)]).effects, 'arm').length).toBe(0)
  })

  test('a timer fires a fork; a kept read counts a ping and arms the next; a stale timer or read changes nothing but the last read', () => {
    const { state } = warmed()
    const id = state.period?.id ?? -1
    const fired = stepWarm(state, { type: 'fire', id }, env(55 * MIN))
    expect(fired.effects).toEqual([{ type: 'fork', id, context: CONTEXT }])
    const read = stepWarm(fired.state, { type: 'read', id, context: CONTEXT, usage: hitUsage, reason: '', usd: 0.02 }, env(55 * MIN))
    expect(read.state.period?.pings).toBe(1)
    expect(of(read.effects, 'note')).toEqual([{ type: 'note', change: { pings: 1, pingUsd: 0.02 } }])
    expect(of(read.effects, 'arm').at(-1)?.delay).toBe(55 * MIN)
    expect(stepWarm(state, { type: 'fire', id: id + 7 }, env(55 * MIN)).effects).toEqual([])
    const stale = stepWarm(state, { type: 'read', id: id + 7, context: CONTEXT, usage: hitUsage, reason: '', usd: 0 }, env(55 * MIN))
    expect(stale.effects).toEqual([])
    expect(stale.state.lastRead?.read).toBe(CONTEXT)
  })

  test('a read that misses stops the idle period, counted missed', () => {
    const { state } = warmed()
    const id = state.period?.id ?? -1
    const missed = stepWarm(state, { type: 'read', id, context: CONTEXT, usage: { cache_read_input_tokens: 30000, cache_creation_input_tokens: 120000 }, reason: '', usd: 0.08 }, env(55 * MIN))
    expect(missed.state.period?.isStopped).toBe(true)
    expect(of(missed.effects, 'note')).toEqual([{ type: 'note', change: { missed: 1, pingUsd: 0.08 } }])
    expect(of(missed.effects, 'arm')).toEqual([])
  })

  test("a person's return after reads is counted warm; a plugin's turn is not a return and keeps the count", () => {
    const { state } = warmed()
    const id = state.period?.id ?? -1
    const afterRead = stepWarm(state, { type: 'read', id, context: CONTEXT, usage: hitUsage, reason: '', usd: 0.02 }, env(55 * MIN)).state
    const plugin = run(afterRead, turn(false, 70 * MIN))
    expect(of(plugin.effects, 'note')).toEqual([])
    expect(plugin.state.period?.pings).toBe(1)
    const person = run(afterRead, turn(true, 70 * MIN))
    expect(of(person.effects, 'note')).toEqual([{ type: 'note', change: { returnsWarm: 1, avoidedUsd: 0.02 * AVOIDED_PER_PING } }])
    expect(person.state.period?.pings).toBe(0)
  })

  test('a re-write after 20 minutes from the third turn on learns the five-minute TTL: stored, said once, keep-warm paused', () => {
    const { state } = warmed()
    const third = run(state, turn(true, 20 * MIN, { cache_read_input_tokens: 0, cache_creation_input_tokens: CONTEXT }))
    expect(of(third.effects, 'save')).toEqual([{ type: 'save', fields: { ttl: '5m' } }])
    expect(of(third.effects, 'toast').length).toBe(1)
    expect(of(third.effects, 'arm')).toEqual([])
    expect(of(third.effects, 'view').at(-1)).toEqual({ type: 'view', view: { isOn: true, pings: 0, cap: 0, reason: 'short-ttl', next: '' } })
    const toggled = stepWarm(third.state, { type: 'toggle', isOn: true }, env(21 * MIN))
    expect(toggled.effects).toEqual([])
    expect(toggled.reply).toMatch(/^The cache lives five minutes in this session/)
  })

  test('the toggle and /warm store the choice; /warm answers with the ledger; the end counts reads never come back to', () => {
    const off = run(initialWarm('off', 3), [[{ type: 'start', attended: true, choice: {} }, 0], ...turn(true, 0), ...turn(true, 0)])
    expect(of(off.effects, 'arm')).toEqual([])
    const on = stepWarm(off.state, { type: 'toggle', isOn: true }, env(MIN))
    expect(of(on.effects, 'save')).toEqual([{ type: 'save', fields: { mode: 'on' } }])
    expect(on.reply).toBe('Keep-warm on for this session: the cache is read at 00:55, for up to 3 hours. /warm 2h changes the cap.')
    const report = stepWarm(on.state, { type: 'command', args: '', ledger: emptyLedger() }, env(MIN))
    expect(report.reply).toMatch(/^Keep the cache warm: on; next read at 00:55 \(0 of 3 this idle period\)\. Cap 3 hours, set for this session\./)
    expect(stepWarm(on.state, { type: 'command', args: 'please', ledger: emptyLedger() }, env(MIN)).reply).toMatch(/^Usage: \/warm/)
    const id = on.state.period?.id ?? -1
    const pinged = stepWarm(on.state, { type: 'read', id, context: CONTEXT, usage: hitUsage, reason: '', usd: 0.02 }, env(55 * MIN)).state
    const ended = stepWarm(pinged, { type: 'end' }, IDLE_ENV)
    expect(ended.effects).toEqual([{ type: 'note', change: { wasted: 1 } }, { type: 'cancel' }, { type: 'status', text: undefined }, { type: 'view', view: OFF_VIEW }])
    expect(ended.state.turns).toBe(0)
  })

  test('an away window with an end turns it on; /warm off in the session wins; ask mode suggests it once', () => {
    const away = { phase: 'running', untilDone: false, startedAt: 0, wakeAt: 8 * HOUR }
    const start = /** @type {[import('../hooks/warm.mjs').WarmEvent, number][]} */ ([[{ type: 'start', attended: true, choice: {} }, 0]])
    const byAway = stepWarm(run(initialWarm('off', 3), [...start, ...turn(true, 0)]).state, { type: 'turnEnd', usage: hitUsage }, env(0, { away }))
    expect(of(byAway.effects, 'view').at(-1)).toEqual({ type: 'view', view: { isOn: true, pings: 0, cap: 9, reason: '', next: '00:55' } })
    const said = run(initialWarm('off', 3), [[{ type: 'start', attended: true, choice: { mode: 'off' } }, 0], ...turn(true, 0)]).state
    expect(of(stepWarm(said, { type: 'turnEnd', usage: hitUsage }, env(0, { away })).effects, 'arm')).toEqual([])
    const asked = run(initialWarm('ask', 3), [...start, ...turn(true, 0), ...turn(true, 0), ...turn(true, 5 * MIN)])
    expect(of(asked.effects, 'toast').length).toBe(1)
  })
})

