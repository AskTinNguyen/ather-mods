// Ather Automata: what keeping the prompt cache warm stores, and what the two halves say to each other about it.
// The session's choice (moves with its lane after /clear) and the machine's ledger go through state.mjs's change
// queue; the view and the toggle are this session's, in memory. Both halves import this module, so they share them.

import { WARM_KEYS, serial } from './state.mjs'
import { OFF_VIEW, addLedger, emptyLedger } from './warm.mjs'

/** @typedef {import('./state.mjs').Io} Io */

/** @param {Io} io @returns {Promise<import('./warm.mjs').WarmChoice>} */
export const readWarm = async io => /** @type {import('./warm.mjs').WarmChoice} */ ((await io.get(WARM_KEYS.choice(await io.sessionId()))) ?? {})

/** @param {Io} io @param {import('./warm.mjs').WarmChoice} fields */
export const setWarm = (io, fields) =>
  serial(async () => {
    const key = WARM_KEYS.choice(await io.sessionId())
    await io.set(key, { .../** @type {object} */ ((await io.get(key)) ?? {}), ...fields })
  })

/** @param {Io} io @returns {Promise<import('./warm.mjs').Ledger>} */
export const readWarmLedger = async io => ({ ...emptyLedger(), .../** @type {object} */ ((await io.get(WARM_KEYS.ledger)) ?? {}) })

/** @param {Io} io @param {import('./warm.mjs').LedgerChange} change */
export const noteWarm = (io, change) =>
  serial(async () => {
    if (Object.keys(change).length === 0) return
    await io.set(WARM_KEYS.ledger, addLedger(await readWarmLedger(io), change))
  })

// What keep-warm is doing now, as watch.mjs last said, for the row above the prompt and the pane (console.mjs).
// Redrawing for it never bumps state.mjs's version, so the console's model is not read again.
let view = OFF_VIEW
export const readWarmView = () => view

/** @param {Io} io @param {import('./warm.mjs').WarmView} next */
export const showWarm = (io, next) => {
  if (JSON.stringify(next) === JSON.stringify(view)) return
  view = next
  io.redraw()
}

// The row's ◔ and the pane's button turn keep-warm on or off through the half that runs it, which answers with what
// to say. One per session: the last session.start's.
/** @type {((isOn: boolean) => Promise<string>) | null} */
let toggler = null
/** @param {(isOn: boolean) => Promise<string>} handler */
export const onWarmToggle = handler => void (toggler = handler)

/** @param {boolean} isOn @returns {Promise<string>} */
export const toggleWarm = isOn => {
  if (!toggler) return Promise.reject(new Error('keep-warm has not started in this session'))
  return toggler(isOn)
}
