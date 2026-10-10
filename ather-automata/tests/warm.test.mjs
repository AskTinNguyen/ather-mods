// @ts-check
import { describe, expect, test } from 'claude-code/testing'

import { AVOIDED_PER_PING, MIN_CONTEXT_TOKENS, WARM_MARGIN_MS, addLedger, emptyLedger, hoursOf, isHit, isRewrite, learnTtl, maxPings, modeOf, newPeriod, nextPingAt, parseWarmArgs, returnChange, skipReason, statusText, ttlMs, warmReport } from '../hooks/warm.mjs'

const MIN = 60 * 1000
const HOUR = 60 * MIN
const CONTEXT = 150000

/** @param {Partial<import('../hooks/warm.mjs').Facts>} [fields] @returns {import('../hooks/warm.mjs').Facts} */
const facts = (fields = {}) => ({ mode: 'on', hours: 3, ttl: '1h', isBusy: false, isInteractive: true, away: { phase: 'off', untilDone: false, wakeAt: 0 }, quota: 0, ...fields })
const usage = (read = 0, written = 0) => ({ input_tokens: 10, output_tokens: 2, cache_read_input_tokens: read, cache_creation_input_tokens: written })

describe('keep warm: timing (A3)', () => {
  test('a ping is due five minutes before the hour, and the cap counts 55-minute steps', () => {
    expect(nextPingAt(newPeriod(0, CONTEXT), '1h')).toBe(HOUR - WARM_MARGIN_MS)
    expect(maxPings(3, '1h')).toBe(3)
    expect(maxPings(1, '1h')).toBe(1)
    expect(maxPings(6, '1h')).toBe(6)
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
    expect(skipReason({ ...period, isStopped: true }, at, facts())).toBe('stopped')
    expect(skipReason(period, at, facts({ ttl: '5m' }))).toBe('short-ttl')
    expect(skipReason(period, at, facts({ isBusy: true }))).toBe('busy')
    expect(skipReason(newPeriod(0, MIN_CONTEXT_TOKENS - 1), at, facts())).toBe('small')
    expect(skipReason({ ...period, pings: 3 }, at, facts())).toBe('cap')
    expect(skipReason(period, at, facts({ quota: 86 }))).toBe('quota')
    expect(skipReason(period, at, facts({ quota: 85 }))).toBe('')
  })

  test('an away window: until done never pings; a window ending within the cap does, one ending after it does not', () => {
    expect(skipReason(period, at, facts({ away: { phase: 'running', untilDone: true, wakeAt: 0 } }))).toBe('away')
    expect(skipReason(period, at, facts({ away: { phase: 'running', untilDone: false, wakeAt: 2 * HOUR } }))).toBe('')
    expect(skipReason(period, at, facts({ away: { phase: 'running', untilDone: false, wakeAt: 9 * HOUR } }))).toBe('away')
    // A window under review: the person may be back any moment.
    expect(skipReason(period, at, facts({ away: { phase: 'review', untilDone: false, wakeAt: 9 * HOUR } }))).toBe('')
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
    expect(parseWarmArgs('please')).toBe(null)
  })
})
