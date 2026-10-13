// @ts-check
// Ather Board: the engine half of the model's help (brief.mjs and modules.mjs build the requests and check
// the replies). Three jobs, each run by one `latestJob`: the brief, once per read of origin/<base> (its
// commit, or the local folders when there is none) and again on ↻ (D7); a question, when asked; and the
// module mapping, once per read and list of modules. A newer run of a job cancels the older; a failed run
// says why and keeps what the job last had. The engine comes in as closures (Io), built in index.mjs
// where `$` lives.

import { askRequest, briefRequest, parseAnswer, parseBrief } from './brief.mjs'
import { BATCH, keep, listKey, mappingOf, mappingRequest, parseMapping } from './modules.mjs'

/**
 * @typedef {{
 *   complete: (request: { model: string, system: string, prompt: string, maxTokens: number }, signal: AbortSignal) => Promise<{ text: string, error: string }>,
 *   redraw: () => void, load: () => Promise<import('./modules.mjs').Kept | null>, save: (kept: import('./modules.mjs').Kept) => Promise<void>,
 * }} Io `complete`: one model completion, its text or why it gave none; `redraw`: draw the pane again;
 *   `load`, `save`: the module answers kept across sessions
 * @typedef {import('./snapshot.mjs').Board} Board
 * @typedef {import('./brief.mjs').Brief} Brief
 * @typedef {import('./brief.mjs').Answer} Answer
 * @typedef {{ mapping: import('./modules.mjs').Mapping, missing: number }} Mapped `missing`: intents still to sort
 */

/**
 * Where a job stands: `key` what it was run for (a commit, a question), `value` its last result
 * (kept through a failed run), `at` when that came in.
 * @template T
 * @typedef {{ state: 'idle' | 'running' | 'ready' | 'failed', key: string, value: T, error: string, at: number }} Job
 */

/**
 * One job that keeps only its latest run. `run` starts `work` unless a run for the same key is already
 * in or under way (then it returns that one; `force` starts anew), cancelling an older one; `work` gets
 * the run's signal and `show`, to publish a partial value. A run resolves once it is over.
 * @template T @param {T} empty
 */
const latestJob = empty => {
  /** @type {Job<T>} */
  let job = { state: 'idle', key: '', value: empty, error: '', at: 0 }
  /** @type {AbortController | null} */
  let stop = null
  /** @type {Promise<void>} */
  let running = Promise.resolve()
  return {
    get: () => job,
    /** @param {Io} io @param {string} key @param {boolean} force @param {(signal: AbortSignal, show: (value: T) => void) => Promise<T>} work */
    run: (io, key, force, work) => {
      if (!force && job.key === key && job.state !== 'idle') return running
      stop?.abort()
      const mine = new AbortController()
      stop = mine
      job = { ...job, state: 'running', key, error: '' }
      io.redraw()
      const show = (/** @type {T} */ value) => {
        if (mine.signal.aborted) return
        job = { ...job, value }
        io.redraw()
      }
      running = (async () => {
        try {
          const value = await work(mine.signal, show)
          if (!mine.signal.aborted) job = { ...job, state: 'ready', value, at: Date.now() }
        } catch (error) {
          if (!mine.signal.aborted) job = { ...job, state: 'failed', error: error instanceof Error ? error.message : String(error) }
        } finally {
          if (stop === mine) stop = null
          io.redraw()
        }
      })()
      return running
    },
    clear: () => {
      stop?.abort()
      stop = null
      job = { state: 'idle', key: '', value: empty, error: '', at: 0 }
    },
  }
}

// A completion's checked result, or a failure that says why there is none.
/** @template T @param {{ text: string, error: string }} reply @param {(text: string) => T | null} parse @param {string} what @returns {T} */
const resultOf = (reply, parse, what) => {
  if (reply.error) throw new Error(reply.error)
  const read = parse(reply.text)
  if (read === null) throw new Error(`the reply held no ${what}`)
  return read
}

const brief = latestJob(/** @type {Brief | null} */ (null))
const asked = latestJob(/** @type {Answer | null} */ (null))
const mapped = latestJob(/** @type {Mapped} */ ({ mapping: {}, missing: 0 }))

export const briefState = brief.get
export const askState = asked.get
export const mapState = mapped.get

// What a read of the board is: the commit read, or the checkout's own folders by their count and last change.
/** @param {Board} board */
const keyOf = board => board.sha || `local:${board.records.length}:${Math.max(0, ...board.records.map(one => one.updatedAt))}`

/**
 * The brief for this read of the board; `force` asks again. Resolves once it is in (or failed).
 * @param {Io} io @param {Board} board @param {string} me @param {boolean} [force]
 */
export const runBrief = (io, board, me, force = false) =>
  brief.run(io, keyOf(board), force, async signal => resultOf(await io.complete(briefRequest(board.records, me, Date.now()), signal), text => parseBrief(text, board.records, me), 'brief'))

/**
 * Asks the model a question about the board; `onAnswer` applies the cut of the board it picked.
 * @param {Io} io @param {string} question @param {Board} board @param {string} me @param {(answer: Answer) => void} onAnswer
 */
export const ask = (io, question, board, me, onAnswer) =>
  question.trim() === ''
    ? Promise.resolve()
    : asked.run(io, question.trim(), true, async signal => {
        const answer = resultOf(await io.complete(askRequest(question, board.records, me, Date.now()), signal), text => parseAnswer(text, board.records), 'answer')
        if (!signal.aborted) onAnswer(answer)
        return answer
      })

// Puts the question away (and stops one still running).
export const clearAsk = asked.clear

/**
 * Which intents work on which modules: what was kept for them, then Sonnet for the rest, a batch at a
 * time, each answer kept as it comes so a later session does not ask again. Once per read of the board
 * and list of modules; `force` asks again for those still missing.
 * @param {Io} io @param {Board} board @param {import('./modules.mjs').Modules} set @param {boolean} [force]
 */
export const runMapping = (io, board, set, force = false) =>
  mapped.run(io, `${keyOf(board)}|${listKey(set.modules)}`, force, async (signal, show) => {
    let kept = await io.load()
    const { mapping, missing } = mappingOf(board.records, set, kept)
    /** @type {Mapped} */
    let now = { mapping, missing: missing.length }
    show(now)
    for (let at = 0; at < missing.length && !signal.aborted; at += BATCH) {
      const batch = missing.slice(at, at + BATCH)
      const answered = resultOf(await io.complete(mappingRequest(batch, set.modules), signal), text => parseMapping(text, batch, set.modules), 'mapping')
      kept = keep(kept, set.modules, batch, answered)
      await io.save(kept)
      now = { mapping: { ...now.mapping, ...answered }, missing: now.missing - Object.keys(answered).length }
      show(now)
    }
    return now
  })
