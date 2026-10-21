// Ather Automata: a prompt between the press and the session, and which session it is for. Pure: no `$`;
// console.mjs gives the outbox the engine as closures, one set per press.
//
// The engine queues a plugin's prompt and starts a turn of its own with it once the session is idle: it is
// never folded into a running turn, and $.prompt.submit resolves as that turn starts, not when the prompt is
// queued (seen on Claude Code 2.1.296: two prompts submitted 19 and 16 seconds before a turn's end both
// resolved 190 ms after it, in one turn). A press while a turn runs therefore waits as long as the turn
// does, and no plugin can shorten that. The outbox knows what waits: the pane says queued, not sent; a
// second press of the same thing sends nothing; and what follows a prompt happens when the session has it.

import { cutWords } from './model.mjs'

/**
 * What a press did: 'sent' with the session idle, 'queued' behind a running turn, 'pending' nothing (it
 * already waits).
 * @typedef {'sent' | 'queued' | 'pending'} Handed
 * @typedef {{ keys: readonly string[], at: number, isQueued: boolean, idleAt: number }} Waiting `idleAt`: when a turn first ended while it waited (0: none has)
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
// The engine starts a waiting prompt's turn as the running one ends. One still waiting this long after a turn
// ended may never arrive (it never settles when the engine drops it), so it no longer stops a second press.
export const GONE_MS = 10000

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
      const isGone = (/** @type {Waiting | undefined} */ one) => one !== undefined && one.idleAt > 0 && now() - one.idleAt > GONE_MS
      if (keys.some(key => waiting.has(key) && !isGone(waiting.get(key)))) {
        host.log(`pressed again while it waits, nothing sent: ${name}`)
        return 'pending'
      }
      if (keys.some(key => waiting.has(key))) host.log(`not delivered ${GONE_MS} ms after a turn ended, sent again: ${name}`)
      /** @type {Waiting} */
      const entry = { keys, at: now(), isQueued: host.isBusy(), idleAt: 0 }
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
    // A turn ended: what waits now should be delivered with the next turn's start.
    /** @param {number} [at] */
    idle: (at = Date.now()) => {
      for (const one of waiting.values()) if (one.idleAt === 0) one.idleAt = at
    },
    reset: () => waiting.clear(),
  }
}

// ---------------------------------------------------------------- which session

/**
 * A session as the desktop app knows it: its id there (`local_…`, not the CLI's session id), its title, and the
 * link that opens it in the app from anywhere ('' where the app gives none).
 * @typedef {{ id: string, title: string, link: string }} AppSession
 */

// One of the desktop app's tools (mcp__ccd_…), called by Ather itself (`call`: console.mjs's or watch.mjs's
// `$.tool.call` of it): whether it did what was asked, and its words. Outside the app the tool is absent and the call
// rejects; that, a refusal and an error all read as not done.
/** @param {() => Promise<{ deny?: string, text?: string, isError?: boolean }>} call @returns {Promise<{ isDone: boolean, text: string }>} */
export const appTool = async call => {
  /** @type {{ deny?: string, text?: string, isError?: boolean }} */
  const ran = await call().catch(error => ({ deny: String(error) }))
  return { isDone: ran.deny === undefined && ran.isError !== true, text: (ran.deny ?? ran.text ?? '').trim() }
}

/** @param {unknown} value */
const textOf = value => (typeof value === 'string' ? value.trim() : '')

// The app's answer to its session tool's `get_session` (JSON with `sessionId`, `title` and `link`); null when it is
// not one (another client, a refusal, an error's words).
/** @param {string} text @returns {AppSession | null} */
export const appSessionOf = text => {
  try {
    const { sessionId, title, link } = JSON.parse(text)
    return typeof sessionId === 'string' && sessionId !== '' ? { id: sessionId, title: textOf(title), link: textOf(link) } : null
  } catch {
    return null
  }
}

// The best guess for an intent no live session tracks (A3b), from the app's `search_session_transcripts` for its
// folder name: of the sessions whose transcript mentions it, the most recently active one that is not archived and is
// not this one (`selfId`, its app id); '' when there is none. The app answers a line of words, then the hits as a JSON
// list (`sessionId`, `title`, `isArchived`, `lastActivityAt`, and a `snippet` of the transcript, never read here);
// with none, only words ("No matching sessions found.").
/** @param {string} text @param {string} selfId */
export const guessedSession = (text, selfId) => {
  /** @type {unknown} */
  let hits = []
  try {
    hits = JSON.parse(text.slice(text.indexOf('[')))
  } catch {
    return ''
  }
  if (!Array.isArray(hits)) return ''
  return (
    hits
      .map(hit => ({ id: textOf(hit?.sessionId), at: Date.parse(String(hit?.lastActivityAt ?? '')) || 0, isArchived: hit?.isArchived === true }))
      .filter(hit => hit.id !== '' && hit.id !== selfId && !hit.isArchived)
      .sort((a, b) => b.at - a.at)[0]?.id ?? ''
  )
}

// Whether the app's `send_message` took the message: every answer ends "(delivery: …; message_id: …)", and only
// delivered (its turn started) or queued (behind its current work) means it is there.
/** @param {string} text */
export const isSentReply = text => /\(delivery:\s*(delivered|queued)\b/i.test(text)

/**
 * Where an intent is worked on (A1): this session; another live session that tracks it (its CLI id, its app id and
 * link, '' when it recorded none, and its name as the row says it); a session that probably works on it, found by the
 * app's transcript search (A3b: shown, never sent to); or none.
 * @typedef {{ kind: 'here' } | { kind: 'none' } | { kind: 'other', sessionId: string, appId: string, link: string, name: string, slug: string } | { kind: 'guess', link: string, name: string }} Place
 */

/** @type {Place} */
const HERE = Object.freeze({ kind: 'here' })
// No session works on it (and an intent the pane has not read).
/** @type {Place} */
export const NO_PLACE = Object.freeze({ kind: 'none' })

// A session's name as a row says it: its app title, cut and quoted; `fallback` without one.
/** @param {string} title @param {string} fallback */
const sessionName = (title, fallback) => (title ? `"${cutWords(title, 36)}"` : fallback)

// The session that works on an intent. This one when it tracks the intent; else the live session on the intent's
// checkout that tracks it, the most recently active of several, named by its app title (never its CLI id), else
// by its branch; else none. A press about the intent goes to that other session (console.mjs): a decision put
// into a session that does not track the intent has two sessions editing one intent folder.
/**
 * @param {string} slug the intent's slug in its checkout @param {boolean} isTrackedHere
 * @param {readonly { sessionId: string, intent: string | null, branch?: string, updatedAt: number, lastActiveAt?: number, app?: Partial<AppSession> }[]} peers the other live sessions on that checkout (state.readPeers)
 * @returns {Place}
 */
export const placeOf = (slug, isTrackedHere, peers) => {
  if (isTrackedHere) return HERE
  const [lane] = peers
    .filter(one => slug !== '' && one.intent === slug && typeof one.sessionId === 'string' && one.sessionId !== '')
    .sort((a, b) => Number(b.lastActiveAt ?? b.updatedAt) - Number(a.lastActiveAt ?? a.updatedAt))
  if (!lane) return NO_PLACE
  const { id = '', title = '', link = '' } = lane.app ?? {}
  return { kind: 'other', sessionId: lane.sessionId, appId: id, link, name: sessionName(title, lane.branch ? `a session on ${lane.branch}` : 'another session'), slug }
}

// The guess (A3b) as a place: the session the app found, by its title and link.
/** @param {AppSession} app @returns {Place} */
export const guessPlace = app => ({ kind: 'guess', link: app.link, name: sessionName(app.title, 'another session') })

// The link that opens a place's session in the app ('' for this session, none, or a session that recorded none).
/** @param {Place} place */
export const placeLink = place => (place.kind === 'other' || place.kind === 'guess' ? place.link : '')

// What a decision's row says of its place: where it is worked on, "Sent to …" once a press of it went to the
// session that still works on it (`sentTo`: the CLI id of the session it went to), "probably in …" for a guess.
/** @param {Place} place @param {string} [sentTo] */
export const placeText = (place, sentTo = '') => {
  if (place.kind === 'here') return 'in this session'
  if (place.kind === 'none') return 'no session tracks it'
  if (place.kind === 'guess') return `probably in ${place.name}`
  return `${sentTo === place.sessionId ? 'Sent to' : 'in'} ${place.name}`
}

// What the other session reads. The engine frames it as a message from another session and that session
// decides what it makes of one: this only says where the press was made and why it came there.
/** @param {{ from: string, slug: string, text: string }} press `from`: this session, as its tab names it */
export const routedText = ({ from, slug, text }) =>
  `From the Ather pane of ${from}: the person pressed this there, and it came to your session because it tracks intent ${slug} and that one does not.\n\n${text}`
