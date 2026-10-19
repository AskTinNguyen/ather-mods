// @ts-check
// Ather Automata: keeping the prompt cache warm while the person is idle. Pure: the
// rules (when to read the cache again, when not to, what the TTL is), the words
// shown, and the state machine that holds them together (stepWarm). watch.mjs feeds
// it the session's events and carries out the effects it returns; warm-store.mjs
// keeps what is stored.
//
// The cache holds a session's context for its TTL after the last read (an hour;
// five minutes in usage overage). A read costs a tenth of the input price and
// starts the hour again; once it lapses, the next turn re-writes the whole
// context at twice the price. A ping just before the hour pays 0.1 to save 1.9.

import { clockText } from './model.mjs'

/** @typedef {'off' | 'ask' | 'on'} WarmMode */
/** @typedef {'1h' | '5m'} Ttl */
/**
 * Why no read is due, or '' when one is.
 * @typedef {'' | 'off' | 'unattended' | 'no-turn' | 'first-turn' | 'stopped' | 'short-ttl' | 'busy' | 'small' | 'lapsed' | 'cap' | 'away' | 'quota'} SkipReason
 * This session's keep-warm choice (/warm, the row's ◔) and the TTL it learned; each field absent until set.
 * @typedef {{ mode?: 'on' | 'off', hours?: number, ttl?: Ttl }} WarmChoice
 * @typedef {{ phase: string, untilDone: boolean, startedAt: number, wakeAt: number }} AwayWindow
 * One idle period: from the last response (or the last ping that hit) until the session's next turn. `id` tells a
 * timer or a read that its period has since ended.
 * @typedef {{ id: number, lastAt: number, context: number, pings: number, lastPingUsd: number, isStopped: boolean }} Period
 * What the guards read besides the period.
 * @typedef {{ mode: WarmMode, hours: number, ttl: Ttl, isBusy: boolean, isInteractive: boolean, turns: number, away: AwayWindow, quota: number, byAway: boolean }} Facts
 * Kept for the machine: what keeping warm did and what it came to.
 * @typedef {{ pings: number, missed: number, wasted: number, returnsWarm: number, returnsCold: number, pingUsd: number, avoidedUsd: number }} Ledger
 * The ledger's numbers are summed, so a change is any subset of them.
 * @typedef {Partial<Ledger>} LedgerChange
 * What the last read did: when, the tokens the cache served and wrote, and the context it was to keep; `reason` when no reply came.
 * @typedef {{ at: number, read: number, written: number, context: number, reason: string }} LastRead
 * What the row above the prompt and the pane show: on or off, reads done of the cap, why no read is due ('' while
 * one is), and the next read's clock time ('' when none is due).
 * @typedef {{ isOn: boolean, pings: number, cap: number, reason: SkipReason, next: string }} WarmView
 */

// A ping this long before the TTL: the fork takes seconds, and a timer can fire late on a busy machine.
export const WARM_MARGIN_MS = 5 * 60 * 1000
// Under this the re-write is cheap: not worth reading the cache to keep it.
export const MIN_CONTEXT_TOKENS = 30000
// A rate-limit window fuller than this keeps what is left for the person's own work.
export const QUOTA_CEILING = 85
// A ping hit when the cache served at least this share of the context.
export const HIT_SHARE = 0.9
// A turn re-wrote the context when it wrote at least this share of it to the cache.
export const REWRITE_SHARE = 0.8
// A re-write costs 2x and the turn after a ping still reads at 0.1x: a return to a warm cache saves 1.9x, 19 pings' worth.
export const AVOIDED_PER_PING = 19
export const DEFAULT_HOURS = 3
// The longest cap an away window gives: 18 reads, still under the 19 a re-write costs.
export const MAX_AWAY_HOURS = 17

// An away window hands keep-warm over with the rest of the session: on, its cap stretched over the window, until the
// person has reviewed it. Not for "until done": the return is unknown, and a day of reads costs more than the re-write.
/** @param {{ phase: string, untilDone: boolean, startedAt: number, wakeAt: number }} away @returns {number} the hours, 0 for none */
export const awayHours = away => (away.phase === 'off' || away.untilDone || away.wakeAt <= away.startedAt ? 0 : Math.min(MAX_AWAY_HOURS, Math.ceil((away.wakeAt - away.startedAt) / 3600000) + 1))

/** @returns {Ledger} */
export const emptyLedger = () => ({ pings: 0, missed: 0, wasted: 0, returnsWarm: 0, returnsCold: 0, pingUsd: 0, avoidedUsd: 0 })

/** @param {number} at @param {number} context @param {number} [id] @returns {Period} */
export const newPeriod = (at, context, id = 0) => ({ id, lastAt: at, context, pings: 0, lastPingUsd: 0, isStopped: false })

/** @param {Ttl} ttl */
export const ttlMs = ttl => (ttl === '5m' ? 5 * 60 * 1000 : 60 * 60 * 1000)

/** @param {unknown} value @returns {WarmMode} */
export const modeOf = value => (value === 'on' || value === 'ask' ? value : 'off')

/** @param {unknown} value */
export const hoursOf = value => {
  const hours = Number(value)
  return Number.isFinite(hours) && hours > 0 ? Math.min(12, Math.max(1, hours)) : DEFAULT_HOURS
}

// How many pings one idle period may have: one per TTL less the margin, over the hours allowed. None where the TTL is no
// longer than the margin (five minutes): keep-warm is paused there.
/** @param {number} hours @param {Ttl} ttl */
export const maxPings = (hours, ttl) => (ttlMs(ttl) <= WARM_MARGIN_MS ? 0 : Math.max(1, Math.floor((hours * 3600000) / (ttlMs(ttl) - WARM_MARGIN_MS))))

/** @param {Period} period @param {Ttl} ttl */
export const nextPingAt = (period, ttl) => period.lastAt + ttlMs(ttl) - WARM_MARGIN_MS

// Why no ping now, or '' to ping.
/** @param {Period | null} period @param {number} now @param {Facts} facts @returns {SkipReason} */
export const skipReason = (period, now, facts) => {
  if (facts.mode !== 'on') return 'off'
  if (!facts.isInteractive) return 'unattended'
  if (period === null) return 'no-turn'
  // A session's first turn leaves a cache entry that no later request reads, not even the session's own next turn
  // (Claude Code 2.1.295, F-2): a read would only write it again.
  if (facts.turns < 2) return 'first-turn'
  if (period.isStopped) return 'stopped'
  if (facts.ttl !== '1h') return 'short-ttl'
  if (facts.isBusy) return 'busy'
  if (period.context < MIN_CONTEXT_TOKENS) return 'small'
  // Asleep past the TTL: the entry is gone, and a ping would pay the full re-write for nobody.
  if (now - period.lastAt >= ttlMs(facts.ttl)) return 'lapsed'
  if (period.pings >= maxPings(facts.hours, facts.ttl)) return 'cap'
  if (facts.away.phase === 'running') {
    if (facts.away.untilDone) return 'away'
    const left = maxPings(facts.hours, facts.ttl) - period.pings
    if (facts.away.wakeAt > now + left * (ttlMs(facts.ttl) - WARM_MARGIN_MS) + WARM_MARGIN_MS) return 'away'
  }
  if (facts.quota > QUOTA_CEILING) return 'quota'
  return ''
}

/** @param {{ cache_read_input_tokens: number }} usage @param {number} context */
export const isHit = (usage, context) => context > 0 && usage.cache_read_input_tokens >= HIT_SHARE * context

/** @param {{ cache_creation_input_tokens: number }} usage @param {number} context */
export const isRewrite = (usage, context) => context > 0 && usage.cache_creation_input_tokens >= REWRITE_SHARE * context

// What a main-thread turn says of the TTL: a re-write after a gap the hour should have covered means five minutes
// (or a prefix that changed, which pauses keep-warm just as rightly); null when it says nothing.
/** @param {number} gapMs @param {{ cache_creation_input_tokens: number }} usage @param {number} context @returns {Ttl | null} */
export const learnTtl = (gapMs, usage, context) => (gapMs > ttlMs('5m') && gapMs < ttlMs('1h') - WARM_MARGIN_MS && isRewrite(usage, context) ? '5m' : null)

// The person's first turn after an idle period that had pings: what the pings came to.
/** @param {Period} period @param {number} returnedAt @param {{ cache_creation_input_tokens: number }} usage @param {Ttl} ttl @returns {LedgerChange} */
export const returnChange = (period, returnedAt, usage, ttl) => {
  if (period.pings === 0) return {}
  // The last ping was too long ago: the cache lapsed before the person came back, and the pings bought nothing.
  if (returnedAt - period.lastAt >= ttlMs(ttl)) return { wasted: period.pings, returnsCold: 1 }
  if (isRewrite(usage, period.context)) return { returnsCold: 1 }
  return { returnsWarm: 1, avoidedUsd: period.lastPingUsd * AVOIDED_PER_PING }
}

/** @param {Ledger} ledger @param {LedgerChange} change @returns {Ledger} */
export const addLedger = (ledger, change) => {
  const sum = { ...emptyLedger(), ...ledger }
  for (const [key, value] of Object.entries(change)) sum[/** @type {keyof Ledger} */ (key)] += Number(value) || 0
  return sum
}

// "/warm", "/warm on", "/warm off", "/warm 2h", "/warm on 90m": null when the words are none of these.
/** @param {string} args @returns {{ mode?: 'on' | 'off', hours?: number } | null} */
export const parseWarmArgs = args => {
  // "10 hours" and "90 min" read as "10hours" and "90min": a number and its unit are one word.
  const words = args.trim().toLowerCase().replace(/(\d)\s+(?=(?:h|hrs?|hours?|m|mins?|minutes?)\b)/g, '$1').split(/\s+/).filter(Boolean)
  /** @type {{ mode?: 'on' | 'off', hours?: number }} */
  const choice = {}
  for (const word of words) {
    const hours = /^(\d{1,2}(?:\.\d+)?)\s*h(?:ours?|rs?)?$/.exec(word)
    const minutes = /^(\d{2,3})\s*m(?:in(?:ute)?s?)?$/.exec(word)
    if (word === 'on' || word === 'off') choice.mode = word
    else if (hours) choice.hours = hoursOf(hours[1])
    else if (minutes) choice.hours = hoursOf(Number(minutes[1]) / 60)
    else return null
  }
  // A cap alone turns it on: "/warm 2h" asks for two hours of it.
  if (choice.hours !== undefined && choice.mode === undefined) choice.mode = 'on'
  return choice
}

/** @param {number} usd */
const money = usd => (usd >= 0.995 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(usd >= 0.1 ? 2 : 3)}`)

// The status line while a ping is due: how many of the cap, and when the next.
/** @param {Period} period @param {Facts} facts @param {number} tz */
export const statusText = (period, facts, tz) => `◔ warm ${period.pings}/${maxPings(facts.hours, facts.ttl)} · next ${clockText(nextPingAt(period, facts.ttl), tz)}`

/** @param {SkipReason} reason */
const reasonText = reason =>
  /** @type {Record<SkipReason, string>} */ ({
    '': 'on',
    off: 'off',
    unattended: 'off in a session nobody watches',
    'no-turn': 'on; waiting for the first turn to end',
    'first-turn': "on; from your second turn (a session's first turn leaves nothing the next one reads)",
    stopped: 'stopped for this idle period (the cache was not there to keep)',
    'short-ttl': 'paused: the cache lives five minutes in this session, too short to keep',
    busy: 'on; a turn is running',
    small: `on; the context is under ${MIN_CONTEXT_TOKENS / 1000}k tokens, cheap to rebuild`,
    lapsed: 'on; the cache has already lapsed, so the next turn rebuilds it',
    cap: 'on; the cap for this idle period is reached',
    away: 'on; your away window ends after the cap, so pings would be wasted',
    quota: `on; a rate-limit window is over ${QUOTA_CEILING}%, so it waits`,
  })[reason]

// What `/warm` answers: this session's state, then what keeping warm has done on this machine.
/** @param {number} n */
const tokens = n => n.toLocaleString('en-US')

// One line on the last read: what the cache served of the context it was to keep.
/** @param {LastRead} last @param {number} tz */
export const lastReadText = (last, tz) =>
  last.reason
    ? `Last read at ${clockText(last.at, tz)}: no reply (${last.reason}).`
    : `Last read at ${clockText(last.at, tz)}: ${tokens(last.read)} of ${tokens(last.context)} tokens from the cache${last.written > 0 ? `, ${tokens(last.written)} written` : ''} (${isHit({ cache_read_input_tokens: last.read }, last.context) ? 'kept' : 'not kept'}).`

/** @param {{ reason: SkipReason, period: Period | null, facts: Facts, tz: number, ledger: Ledger, source: string, last: LastRead | null }} view */
export const warmReport = ({ reason, period, facts, tz, ledger, source, last }) => {
  const cap = `${facts.hours} hour${facts.hours === 1 ? '' : 's'}`
  const now = reason === '' && period ? `on; next read at ${clockText(nextPingAt(period, facts.ttl), tz)} (${period.pings} of ${maxPings(facts.hours, facts.ttl)} this idle period)` : reasonText(reason)
  const lines = [`Keep the cache warm: ${now}. Cap ${cap}, ${source}.`]
  if (last) lines.push(lastReadText(last, tz))
  if (facts.mode !== 'on') lines.push('/warm on keeps it warm while you are idle; /warm 2h sets the cap.')
  else lines.push('/warm off stops it; /warm <n>h sets the cap.')
  if (ledger.pings + ledger.missed > 0) {
    const returns = `${ledger.returnsWarm} return${ledger.returnsWarm === 1 ? '' : 's'} warm, ${ledger.returnsCold} cold`
    const spent = ledger.pingUsd > 0 ? ` · ${money(ledger.pingUsd)} spent, ~${money(ledger.avoidedUsd)} re-write avoided` : ''
    const lost = ledger.missed + ledger.wasted > 0 ? ` · ${ledger.missed} missed, ${ledger.wasted} wasted` : ''
    lines.push(`On this machine: ${ledger.pings} ping${ledger.pings === 1 ? '' : 's'} · ${returns}${spent}${lost}.`)
  }
  return lines.join('\n')
}

/** @type {WarmView} */
export const OFF_VIEW = { isOn: false, pings: 0, cap: 0, reason: 'off', next: '' }

/** @param {Period | null} period @param {Facts} facts @param {SkipReason} reason @param {number} tz @returns {WarmView} */
export const viewOf = (period, facts, reason, tz) => ({ isOn: facts.mode === 'on', pings: period?.pings ?? 0, cap: maxPings(facts.hours, facts.ttl), reason, next: reason === '' && period ? clockText(nextPingAt(period, facts.ttl), tz) : '' })

// The row's button: its glyph, whether it is dim, and the count drawn beside it in amber while a read is due.
/** @param {WarmView} view @returns {{ label: string, isDim: boolean, count: string }} */
export const warmBadge = view => {
  if (view.reason === 'short-ttl') return { label: '◔ –', isDim: true, count: '' }
  if (!view.isOn) return { label: '◔', isDim: true, count: '' }
  return { label: '◔', isDim: false, count: view.reason === '' ? `${view.pings}/${view.cap}` : '' }
}

// What a press on the row's button says once it has turned keep-warm on or off (or could not).
/** @param {boolean} isOn @param {SkipReason} reason @param {Period | null} period @param {Facts} facts @param {number} tz */
export const toggleText = (isOn, reason, period, facts, tz) => {
  if (!isOn) return 'Keep-warm off. The cache lapses an hour after your last turn.'
  if (facts.ttl === '5m') return 'The cache lives five minutes in this session, too short to keep warm. Keep-warm stays off.'
  const cap = `${facts.hours} hour${facts.hours === 1 ? '' : 's'}`
  if (reason === '' && period) return `Keep-warm on for this session: the cache is read at ${clockText(nextPingAt(period, facts.ttl), tz)}, for up to ${cap}. /warm 2h changes the cap.`
  return `Keep-warm on for this session, for up to ${cap}: ${reasonText(reason).replace(/^on; /, '')}.`
}

// The pane's "Stepping out?" section: one line on what keep-warm is doing, and its button's label ('' for none).
/** @param {WarmView} view @returns {{ text: string, action: string }} */
export const warmPaneText = view => {
  if (view.reason === 'short-ttl') return { text: 'The cache lives five minutes in this session, too short to keep warm.', action: '' }
  if (!view.isOn) return { text: 'Keep the prompt cache warm while you are away from the keyboard, so your next turn reads the context instead of paying to write it again.', action: 'Keep the cache warm' }
  if (view.reason === '') return { text: `Kept warm: ${view.pings} of ${view.cap} reads done, the next at ${view.next}.`, action: 'Stop keeping warm' }
  return { text: `Keep-warm is on; ${reasonText(view.reason).replace(/^on; /, '')}.`, action: 'Stop keeping warm' }
}

// ---------------------------------------------------------------- the state machine

// The one user message a read sends: it asks for the shortest reply, since a fork takes no output cap.
export const PING_PROMPT = 'Keep-alive check from a plugin; nothing to do. Reply with a single period.'

/**
 * Keep-warm in one session: the plugin settings, this session's choice, whether a person can come back to it, whether
 * a main-thread turn runs, the turns since it (or /clear) began, the idle period and the turn that will end it, the last
 * read, and what was said once.
 * @typedef {{ options: { mode: WarmMode, hours: number }, choice: WarmChoice, attended: boolean, busy: boolean, turns: number,
 *   period: Period | null, turn: { period: Period, at: number, isPerson: boolean } | null, lastId: number,
 *   asked: boolean, shortTold: boolean, lastRead: LastRead | null }} WarmState
 * What the session tells every step, read at once: the time, the person's timezone, the away window, the fullest
 * rate-limit window, and the context the last response was answered over.
 * @typedef {{ now: number, tz: number, away: AwayWindow, quota: number, context: number }} WarmEnv
 * @typedef {{ cache_read_input_tokens: number, cache_creation_input_tokens: number }} CacheUsage
 * @typedef {{ type: 'start', attended: boolean, choice: WarmChoice } | { type: 'attach' } | { type: 'turnStart', isPerson: boolean }
 *   | { type: 'turnEnd', usage: CacheUsage | null } | { type: 'fire', id: number }
 *   | { type: 'read', id: number, context: number, usage: CacheUsage | null, reason: string, usd: number }
 *   | { type: 'command', args: string, ledger: Ledger } | { type: 'toggle', isOn: boolean } | { type: 'end' }} WarmEvent
 * What watch.mjs carries out: the timer (`arm` after `delay`, `cancel`), the fork, the status line, the row's and the
 * pane's view, a toast, the ledger and the stored choice.
 * @typedef {{ type: 'cancel' } | { type: 'arm', id: number, delay: number } | { type: 'fork', id: number, context: number }
 *   | { type: 'status', text: string | undefined } | { type: 'view', view: WarmView } | { type: 'toast', text: string, ms: number }
 *   | { type: 'note', change: LedgerChange } | { type: 'save', fields: WarmChoice }} WarmEffect
 * @typedef {{ state: WarmState, effects: WarmEffect[], reply: string }} WarmStep
 */

/** @param {unknown} mode @param {unknown} hours @returns {WarmState} */
export const initialWarm = (mode, hours) => ({ options: { mode: modeOf(mode), hours: hoursOf(hours) }, choice: {}, attended: false, busy: false, turns: 0, period: null, turn: null, lastId: 0, asked: false, shortTold: false, lastRead: null })

// The environment for a step that reads none of it: the session's end, which must not wait on anything (F-1).
/** @type {WarmEnv} */
export const IDLE_ENV = { now: 0, tz: 0, away: { phase: 'off', untilDone: false, startedAt: 0, wakeAt: 0 }, quota: 0, context: 0 }

// The guards' facts. An away window with an end turns keep-warm on for its length (awayHours), unless the person said
// /warm off in this session; otherwise this session's choice, else the plugin settings.
/** @param {WarmState} state @param {WarmEnv} env @returns {Facts} */
export const factsOf = (state, env) => {
  const byAway = awayHours(env.away) > 0 && state.choice.mode !== 'off'
  const hours = state.choice.hours ?? state.options.hours
  return {
    mode: byAway ? 'on' : (state.choice.mode ?? (state.options.mode === 'on' ? 'on' : 'off')),
    hours: byAway ? Math.max(hours, awayHours(env.away)) : hours,
    byAway,
    ttl: state.choice.ttl ?? '1h',
    isBusy: state.busy,
    isInteractive: state.attended,
    turns: state.turns,
    away: env.away,
    quota: env.quota,
  }
}

// After any change: the timer armed for the next read or cancelled, the status line, the view, and in `ask` mode the
// one suggestion per session.
/** @param {WarmState} state @param {WarmEnv} env @param {WarmEffect[]} [before] @returns {WarmStep} */
const settle = (state, env, before = []) => {
  const facts = factsOf(state, env)
  const reason = skipReason(state.period, env.now, facts)
  /** @type {WarmEffect[]} */
  const effects = [...before, { type: 'cancel' }]
  const isAsking = state.options.mode === 'ask' && !state.asked && state.choice.mode === undefined && skipReason(state.period, env.now, { ...facts, mode: 'on' }) === ''
  if (isAsking && state.period) effects.push({ type: 'toast', text: `this session holds ${Math.round(state.period.context / 1000)}k tokens in its prompt cache. Stepping away? /warm on keeps it warm for up to ${facts.hours} hours.`, ms: 12000 })
  if (reason === '' && state.period) effects.push({ type: 'arm', id: state.period.id, delay: Math.max(0, nextPingAt(state.period, facts.ttl) - env.now) }, { type: 'status', text: statusText(state.period, facts, env.tz) })
  else effects.push({ type: 'status', text: undefined })
  effects.push({ type: 'view', view: viewOf(state.period, facts, reason, env.tz) })
  return { state: isAsking ? { ...state, asked: true } : state, effects, reply: '' }
}

// This session's choice changed (/warm, the row's ◔): stored, then everything settled again.
/** @param {WarmState} state @param {WarmEnv} env @param {WarmChoice} fields */
const choose = (state, env, fields) => settle({ ...state, choice: { ...state.choice, ...fields } }, env, [{ type: 'save', fields }])

// A main-thread turn ended: what it says of the TTL and of the idle period before it, then a new idle period.
/** @param {WarmState} state @param {CacheUsage | null} usage @param {WarmEnv} env */
const endTurn = (state, usage, env) => {
  const from = state.turn
  const turns = state.turns + 1
  /** @type {WarmEffect[]} */
  const effects = []
  let next = { ...state, busy: false, turns, turn: null }
  // A second turn always writes the first one's part again (F-2): only later turns say anything of the TTL.
  if (from && usage && turns > 2 && next.choice.ttl !== '5m' && learnTtl(from.at - from.period.lastAt, usage, from.period.context) === '5m') {
    effects.push({ type: 'save', fields: { ttl: '5m' } })
    if (!next.shortTold && factsOf(next, env).mode === 'on') effects.push({ type: 'toast', text: 'the prompt cache lives five minutes in this session, too short to keep warm. Paused; /warm says more.', ms: 10000 })
    next = { ...next, choice: { ...next.choice, ttl: '5m' }, shortTold: true }
  }
  if (from && usage && from.isPerson) effects.push({ type: 'note', change: returnChange(from.period, from.at, usage, factsOf(next, env).ttl) })
  // A turn the person did not start (a schedule, a wakeup, the away window's own work) read the cache too, but the cap
  // counts from their last turn.
  const id = next.lastId + 1
  next = { ...next, lastId: id, period: { ...newPeriod(env.now, env.context, id), pings: from && !from.isPerson ? from.period.pings : 0 } }
  return settle(next, env, effects)
}

// A read came back: kept (the hour starts again, the next read is armed), or the cache was not there and this idle
// period stops. A read whose period has ended since only becomes the last read.
/** @param {WarmState} state @param {Extract<WarmEvent, { type: 'read' }>} read @param {WarmEnv} env @returns {WarmStep} */
const endRead = (state, read, env) => {
  const lastRead = { at: env.now, read: read.usage?.cache_read_input_tokens ?? 0, written: read.usage?.cache_creation_input_tokens ?? 0, context: read.context, reason: read.reason }
  const period = state.period
  if (period === null || period.id !== read.id) return { state: { ...state, lastRead }, effects: [], reply: '' }
  if (read.reason === 'nothing-to-fork') return settle({ ...state, lastRead, period: { ...period, isStopped: true } }, env)
  if (read.reason === '' && read.usage && isHit(read.usage, period.context)) {
    return settle({ ...state, lastRead, period: { ...period, lastAt: env.now, pings: period.pings + 1, lastPingUsd: read.usd } }, env, [{ type: 'note', change: { pings: 1, pingUsd: read.usd } }])
  }
  return settle({ ...state, lastRead, period: { ...period, isStopped: true } }, env, [{ type: 'note', change: { missed: 1, pingUsd: read.usd } }])
}

// What /warm answers, after any change its words asked for.
/** @param {WarmState} state @param {string} args @param {Ledger} ledger @param {WarmEnv} env @returns {WarmStep} */
const command = (state, args, ledger, env) => {
  const fields = parseWarmArgs(args)
  if (fields === null) return { state, effects: [], reply: 'Usage: /warm, /warm on, /warm off, /warm 2h (keep it warm for at most two hours of idle time).' }
  const step = fields.mode !== undefined || fields.hours !== undefined ? choose(state, env, fields) : { state, effects: [], reply: '' }
  const facts = factsOf(step.state, env)
  const { choice, period, lastRead: last } = step.state
  const source = facts.byAway ? 'with your away window, until you have reviewed it' : choice.mode !== undefined || choice.hours !== undefined ? 'set for this session' : 'from the plugin settings'
  return { ...step, reply: warmReport({ reason: skipReason(period, env.now, facts), period, facts, tz: env.tz, ledger, source, last }) }
}

// The row's ◔ and the pane's button: on or off for this session, as /warm on and off; never on where the cache lives
// five minutes.
/** @param {WarmState} state @param {boolean} isOn @param {WarmEnv} env @returns {WarmStep} */
const toggle = (state, isOn, env) => {
  if (isOn && factsOf(state, env).ttl === '5m') return { state, effects: [], reply: toggleText(true, 'short-ttl', state.period, factsOf(state, env), env.tz) }
  const step = choose(state, env, { mode: isOn ? 'on' : 'off' })
  const facts = factsOf(step.state, env)
  return { ...step, reply: toggleText(isOn, skipReason(step.state.period, env.now, facts), step.state.period, facts, env.tz) }
}

// Keep-warm's one transition: the state after the event, what to carry out, and what to say (for /warm and the ◔).
/** @param {WarmState} state @param {WarmEvent} event @param {WarmEnv} env @returns {WarmStep} */
export const stepWarm = (state, event, env) => {
  switch (event.type) {
    case 'start':
      return settle({ ...initialWarm(state.options.mode, state.options.hours), attended: event.attended, choice: event.choice }, env)
    case 'attach':
      return settle({ ...state, attended: true }, env)
    case 'turnStart':
      return settle({ ...state, busy: true, attended: state.attended || event.isPerson, turn: state.period ? { period: state.period, at: env.now, isPerson: event.isPerson } : null }, env)
    case 'turnEnd':
      return endTurn(state, event.usage, env)
    case 'fire': {
      const period = state.period
      if (period === null || period.id !== event.id) return { state, effects: [], reply: '' }
      return skipReason(period, env.now, factsOf(state, env)) === '' ? { state, effects: [{ type: 'fork', id: event.id, context: period.context }], reply: '' } : settle(state, env)
    }
    case 'read':
      return endRead(state, event, env)
    case 'command':
      return command(state, event.args, event.ledger, env)
    case 'toggle':
      return toggle(state, event.isOn, env)
    case 'end': {
      // Pings the person never came back to. After /clear the session goes on under a new id with no session.start:
      // its next turn is a first turn again.
      /** @type {WarmEffect[]} */
      const wasted = state.period && state.period.pings > 0 ? [{ type: 'note', change: { wasted: state.period.pings } }] : []
      return { state: { ...state, period: null, turn: null, turns: 0 }, effects: [...wasted, { type: 'cancel' }, { type: 'status', text: undefined }, { type: 'view', view: OFF_VIEW }], reply: '' }
    }
  }
}
