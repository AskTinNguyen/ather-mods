// @ts-check
// Ather Automata: a prompt between the press and the session, and which session it is for. Pure: no `$`;
// console.mjs gives the outbox the engine as closures, one set per press.
//
// The engine queues a plugin's prompt and starts a turn of its own with it once the session is idle: it is
// never folded into a running turn, and $.prompt.submit resolves as that turn starts, not when the prompt is
// queued (seen on Claude Code 2.1.296: two prompts submitted 19 and 16 seconds before a turn's end both
// resolved 190 ms after it, in one turn). A press while a turn runs therefore waits as long as the turn
// does, and no plugin can shorten that. The outbox knows what waits: the pane says queued, not sent; a
// second press of the same thing sends nothing; and what follows a prompt happens when the session has it.

/**
 * What a press did: 'sent' with the session idle, 'queued' behind a running turn, 'pending' nothing (it
 * already waits).
 * @typedef {'sent' | 'queued' | 'pending'} Handed
 * @typedef {{ keys: readonly string[], at: number, isQueued: boolean }} Waiting
 * @typedef {{
 *   submit: (text: string) => Promise<unknown>, after: (ms: number, run: () => void) => unknown, isBusy: () => boolean,
 *   onChange: () => void, say: (text: string) => void, log: (line: string) => void, now?: () => number
 * }} Host `submit` resolves once the session has the prompt; `isBusy`: a turn is running; `onChange`: the pane
 *   is drawn again; `say`: a pop-up; `log`: the debug log.
 */

export const QUEUED_TEXT = 'Queued until this turn ends; the session gets it then.'
export const PENDING_TEXT = 'Already queued: the session gets it when this turn ends.'

// A prompt the session does not have after this long waits on something, whether or not a turn was seen
// to start (the module was loaded again mid-turn, or the engine holds prompts for a reason of its own).
export const LATE_MS = 3000

// What a press says: `words` when the session has it at once, else that it waits.
/** @param {Handed} handed @param {string} words */
export const toldText = (handed, words) => (handed === 'sent' ? words : handed === 'queued' ? QUEUED_TEXT : PENDING_TEXT)

// "3m 38s", "42s": how long a prompt waited.
/** @param {number} ms */
export const waitText = ms => {
  const seconds = Math.max(1, Math.round(ms / 1000))
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`
}

// The prompts handed over that the session does not have yet. One per module: it starts empty with each session.
export const createOutbox = () => {
  /** @type {Map<string, Waiting>} */
  const waiting = new Map()
  return {
    /**
     * Hands `text` to the session. `ids`: what the press was for; a prompt without one is known by its text.
     * A press for something that already waits does nothing. `onDelivered` runs once the session has the
     * prompt, `onFailed` when it could not be sent.
     * @param {Host} host @param {readonly string[]} ids @param {string} text
     * @param {() => unknown} [onDelivered] @param {() => unknown} [onFailed] @returns {Handed}
     */
    hand(host, ids, text, onDelivered, onFailed) {
      const now = host.now ?? Date.now
      const keys = ids.length > 0 ? ids : [text]
      const name = keys.map(key => key.slice(0, 60)).join(', ')
      if (keys.some(key => waiting.has(key))) {
        host.log(`pressed again while it waits, nothing sent: ${name}`)
        return 'pending'
      }
      /** @type {Waiting} */
      const entry = { keys, at: now(), isQueued: host.isBusy() }
      for (const key of keys) waiting.set(key, entry)
      const isWaiting = () => keys.some(key => waiting.get(key) === entry)
      const settle = () => {
        for (const key of keys) if (waiting.get(key) === entry) waiting.delete(key)
      }
      host.log(`pressed at ${new Date(entry.at).toISOString()}, ${entry.isQueued ? 'queued behind the running turn' : 'the session is idle'}: ${name}`)
      host.after(LATE_MS, () => {
        if (!isWaiting() || entry.isQueued) return
        entry.isQueued = true
        host.log(`not delivered after ${LATE_MS} ms, shown as queued: ${name}`)
        host.onChange()
        host.say(QUEUED_TEXT)
      })
      void host.submit(text).then(
        async () => {
          const waited = now() - entry.at
          settle()
          host.log(`delivered after ${waited} ms: ${name}`)
          host.onChange()
          if (entry.isQueued) host.say(`Sent to the session: it was queued for ${waitText(waited)}.`)
          // What follows may take its time (an answered row settles after it has shown): nothing above waits on it.
          try {
            await onDelivered?.()
          } catch (error) {
            host.log(`after delivery of ${name}: ${String(error)}`)
          }
          host.onChange()
        },
        async error => {
          settle()
          host.log(`could not be sent: ${name}: ${String(error)}`)
          try {
            await onFailed?.()
          } catch {
            // the failure below is what the person is told
          }
          host.onChange()
          host.say(`could not send to the session: ${String(error)}`)
        },
      )
      host.onChange()
      return entry.isQueued ? 'queued' : 'sent'
    },
    /** @param {string} key an id, or a prompt's text when it had none */
    isWaiting: key => waiting.has(key),
    // Waits behind a running turn, as far as the pane knows.
    /** @param {string} key */
    isQueued: key => waiting.get(key)?.isQueued === true,
    queued: () => [...waiting].filter(([, one]) => one.isQueued).map(([key]) => key),
    reset: () => waiting.clear(),
  }
}

// ---------------------------------------------------------------- which session

// The live sessions a press about an intent could go to instead of this one: those on the intent's checkout
// that track it, most recently active first. None when this session tracks it itself (it answers for its own
// intent) or no other does (the press goes here, as before). When there are some, the person is asked: a
// decision put into a session that does not track the intent has two sessions editing one intent folder.
/**
 * @param {string} slug the intent's slug in its checkout @param {boolean} isTrackedHere
 * @param {readonly { sessionId: string, intent: string | null, updatedAt: number, lastActiveAt?: number }[]} peers the other live sessions on that checkout (state.readPeers)
 */
export const holdersOf = (slug, isTrackedHere, peers) =>
  isTrackedHere || slug === ''
    ? []
    : peers
        .filter(lane => lane.intent === slug && typeof lane.sessionId === 'string' && lane.sessionId !== '')
        .sort((a, b) => Number(b.lastActiveAt ?? b.updatedAt) - Number(a.lastActiveAt ?? a.updatedAt))

// What the other session reads. The engine frames it as a message from another session and that session
// decides what it makes of one: this only says where the press was made and why it came there.
/** @param {{ from: string, slug: string, text: string }} press `from`: this session, as its tab names it */
export const routedText = ({ from, slug, text }) =>
  `From the Ather pane of ${from}: the person pressed this there, and chose to send it to your session because it tracks intent ${slug} and that one does not.\n\n${text}`
