// @ts-check
// Ather Automata: the tool calls in flight, per model loop (a worker's, or the main loop's), as the
// watch half sees them: what each call is, when it started, whether it waits on a permission
// decision, and for a foreground Agent call the worker it started. A call is recorded when the
// tool.call hook passes it on and cleared when that settles (it ran, was refused, or threw), when
// the hook's dispatch is aborted, or when its loop's turn ends. So a long build is never read as a
// quiet worker, and a call waiting on permission is never read as running. Pure: no `$`.

/**
 * `loop`: the worker's agent id, '' for the main loop. `what`: the call's own description, or a short
 * form of its command. `childId`: the worker a foreground Agent call started, once agent.spawn reports it.
 * `askedAt`: when a permission dialog for the call was shown (classic.PermissionRequest); kept until the call
 * settles, since no event says the dialog was answered: words built on it say only that it was asked.
 * @typedef {{ token: number, loop: string, toolUseId: string, tool: string, what: string, command: string, startedAt: number, childId?: string, askedAt?: number }} Call
 */

/** @type {Map<number, Call>} */
const calls = new Map()
let nextToken = 1
// A runaway session keeps at most this many open calls (with aborts and turn ends clearing loops, rarely reached).
const MOST = 200

export const resetCalls = () => {
  calls.clear()
  nextToken = 1
}

// What a call is, in its own words: the description the model gave it, or its command's first line, cut.
/** @param {string} tool @param {Record<string, unknown>} input */
export const callWhat = (tool, input) => {
  const description = String(input.description ?? '').trim()
  if (description) return description
  const command = String(input.command ?? '').split(/\r?\n/)[0]?.trim() ?? ''
  return command ? (command.length <= 60 ? command : `${command.slice(0, 59)}…`) : tool
}

// Over the cap, the call let go first: the oldest still asking, else the oldest in the loop holding the most
// calls (a leak piles up in one loop), so one long live call is never dropped for leaked ones.
const evict = () => {
  const open = [...calls.values()]
  const asking = open.filter(one => one.askedAt !== undefined)
  const perLoop = new Map()
  for (const one of open) perLoop.set(one.loop, (perLoop.get(one.loop) ?? 0) + 1)
  const busiest = [...perLoop.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const victim = asking[0] ?? open.find(one => one.loop === busiest)
  if (victim) calls.delete(victim.token)
}

// A call goes out; its token clears it.
/** @param {{ loop?: string, toolUseId?: string, tool: string, input: Record<string, unknown>, at: number }} call @returns {number} */
export const startCall = ({ loop = '', toolUseId = '', tool, input, at }) => {
  const token = nextToken++
  calls.set(token, { token, loop, toolUseId, tool, what: callWhat(tool, input), command: typeof input.command === 'string' ? input.command : '', startedAt: at })
  while (calls.size > MOST) evict()
  return token
}

/** @param {number} token */
export const endCall = token => void calls.delete(token)

// A loop's turn ended: nothing in it is in flight any more, whatever did not settle.
/** @param {string} loop */
export const endLoop = loop => {
  for (const one of [...calls.values()]) if (one.loop === loop) calls.delete(one.token)
}

// The call `run` makes is in flight until it settles, whichever way (an answer, a refusal or a throw), or until
// `signal` aborts (the person's Esc: a pending call is not sure to settle). `onSettled` runs after, also
// whichever way, and never throws into the call.
/** @template T @param {Parameters<typeof startCall>[0]} call @param {() => Promise<T>} run @param {() => void} [onSettled] @param {AbortSignal} [signal] @returns {Promise<T>} */
export const during = async (call, run, onSettled, signal) => {
  const token = startCall(call)
  const onAbort = () => endCall(token)
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) endCall(token)
  try {
    return await run()
  } finally {
    endCall(token)
    signal?.removeEventListener('abort', onAbort)
    try {
      onSettled?.()
    } catch {
      // Bookkeeping only: the call's own answer stands.
    }
  }
}

// A permission dialog was shown to the person (classic.PermissionRequest, which names no tool_use_id): the call it
// is for waits on their decision, not running. It is the loop's newest call of that tool not yet asking, the one
// with the same command when there is one. Nothing matches: nothing is marked.
/** @param {{ loop?: string, tool: string, input: unknown, at: number }} dialog */
export const markAsking = ({ loop = '', tool, input, at }) => {
  const command = input && typeof input === 'object' && typeof (/** @type {{ command?: unknown }} */ (input)).command === 'string' ? String(/** @type {{ command: string }} */ (input).command) : ''
  const open = callsIn(loop).filter(one => one.tool === tool && one.askedAt === undefined)
  const call = (command ? open.filter(one => one.command === command).at(-1) : undefined) ?? open.at(-1)
  if (call) call.askedAt = at
}

// agent.spawn reported the worker an Agent call started: the call that waits on it, by the call's id,
// or else the loop's latest Agent call not yet linked. A background spawn is waited on by nobody.
/** @param {{ loop?: string, toolUseId?: string, childId: string, isBackground?: boolean }} spawn */
export const linkChild = ({ loop = '', toolUseId = '', childId, isBackground = false }) => {
  if (isBackground || !childId) return
  const open = [...calls.values()].filter(one => one.tool === 'Agent')
  const call = (toolUseId ? open.find(one => one.toolUseId === toolUseId) : undefined) ?? open.filter(one => one.loop === loop && !one.childId).at(-1)
  if (call) call.childId = childId
}

// The loop's calls in flight, oldest first, asking ones included.
/** @param {string} [loop] @returns {Call[]} */
export const callsIn = (loop = '') => [...calls.values()].filter(one => one.loop === loop).sort((a, b) => a.startedAt - b.startedAt)

// The loop's calls waiting on a permission decision, oldest first.
/** @param {string} [loop] */
export const askingIn = (loop = '') => callsIn(loop).filter(one => one.askedAt !== undefined)

// Something is running in the loop: a call in flight that is not waiting on permission.
/** @param {string} [loop] */
export const isInFlight = (loop = '') => [...calls.values()].some(one => one.loop === loop && one.askedAt === undefined)

// The one rule for a quiet worker, in the pane and in the stuck-permission toast: nothing running,
// and nothing heard for the threshold. A call running is never quiet, however long it runs.
/** @param {{ isInFlight: boolean, lastAt: number, now: number, quietMs: number }} one */
export const isSilent = ({ isInFlight, lastAt, now, quietMs }) => !isInFlight && now - lastAt > quietMs

export const LONG_CALL_MS = 60000
export const STUCK_CALL_MS = 25 * 60000

// A shell or Monitor call running (not asking) for more than a minute, the oldest, if any.
/** @param {readonly Call[]} open oldest first @param {number} now */
export const longShell = (open, now) => open.find(one => one.askedAt === undefined && /^(Bash|PowerShell|Monitor)$/.test(one.tool) && now - one.startedAt > LONG_CALL_MS)

/** @param {number} ms */
const agoText = ms => (ms < 60000 ? 'just now' : `${Math.floor(ms / 60000)} min ago`)

/**
 * What a worker waits on, from facts only: `wait`, the amber ⏳ line (a call permission was asked for, and when;
 * a foreground Agent call's worker; or a shell or Monitor call past a minute, quoted as described, with the pack's
 * lock line when the command names its lock file); `stuck`, the ⚠ line when one call has gone on 25 minutes or more.
 * @param {readonly Call[]} open the loop's calls in flight, oldest first @param {number} now
 * @param {(childId: string) => string} titleOf @param {(command: string) => string} [lockOf]
 * @returns {{ wait: string, stuck: string }}
 */
export const waitWords = (open, now, titleOf, lockOf = () => '') => {
  const asking = open.find(one => one.askedAt !== undefined)
  const running = open.filter(one => one.askedAt === undefined)
  const agent = running.find(one => one.tool === 'Agent' && one.childId)
  const shell = longShell(running, now)
  const lock = shell && shell.command ? lockOf(shell.command) : ''
  const wait = asking ? `⏳ asked permission ${agoText(now - (asking.askedAt ?? now))}: ${asking.what}` : agent?.childId ? `⏳ waiting on ${titleOf(agent.childId)}` : shell ? `⏳ ${shell.what}${lock ? ` · ${lock}` : ''}` : ''
  // A call asked about is still a call: an approved build that runs on still warns.
  const [oldest] = open
  const stuck = oldest && now - oldest.startedAt >= STUCK_CALL_MS ? `⚠ one call running ${Math.floor((now - oldest.startedAt) / 60000)} min` : ''
  return { wait, stuck }
}
