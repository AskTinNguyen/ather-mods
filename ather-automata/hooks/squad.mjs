// @ts-check
// Ather Automata: the worker squad. What kind of worker each background agent is (fixed when it
// is dispatched), what it is doing now (from its latest tool call), and how it is drawn: a ring
// for its state, a body and colour for its kind, the prop it holds. Pure: no `$`.

import { isAutomationCommand, isBuildCommand, mcpKind } from './guards.mjs'

/** @typedef {'editor' | 'builder' | 'tester' | 'scout' | 'reviewer' | 'general'} Kind */
/** @typedef {'reading' | 'editing' | 'building' | 'testing' | 'editor' | 'reviewing' | 'profiling' | 'asking' | 'idle'} Prop `asking`: a question to the person in flight; `idle`: computed silence */
/** @typedef {'running' | 'done' | 'failed' | 'waiting'} WorkerState */
/** @typedef {'seen' | 'adopted' | 'unknown'} Origin how much Ather knows of a worker: saw it dispatched, found it running later, or neither */

// One body and one colour per kind: colour reads from across the room, the shape still reads
// for colour-blind teammates and at small sizes.
export const KINDS = /** @type {const} */ ({
  editor: { word: 'Editor', body: 'pill', fill: '#f08a3c', light: true },
  builder: { word: 'Builder', body: 'square', fill: '#2f8cf0', light: false },
  tester: { word: 'Tester', body: 'starfish', fill: '#2fbfa8', light: true },
  scout: { word: 'Scout', body: 'cloud', fill: '#c9b3ee', light: true },
  reviewer: { word: 'Reviewer', body: 'moon', fill: '#f2d27a', light: true },
  general: { word: 'General', body: 'blob', fill: '#ec5fa4', light: false },
})

export const STATE_COLOURS = /** @type {const} */ ({ running: '#ddff00', done: '#3ccf7a', failed: '#ff5a45', waiting: '#6b6e67' })
export const STATE_GLYPHS = /** @type {const} */ ({ running: '●', done: '✓', failed: '✗', waiting: '○' })

export const PROP_WORDS = /** @type {const} */ ({
  reading: 'reading', editing: 'editing files', building: 'building', testing: 'testing', editor: 'in the Editor', reviewing: 'reviewing', profiling: 'profiling', asking: 'asking you', idle: 'quiet',
})
const TRAIL_WORDS = /** @type {const} */ ({ reading: 'read', editing: 'edit', building: 'build', testing: 'test', editor: 'Editor', reviewing: 'review', profiling: 'profile', asking: 'ask', idle: 'wait' })

// ---------------------------------------------------------------- what kind, what now

// The kind, from the dispatch: the agent type first, then its short description, then the brief.
// The description says what the worker is for: "Thermo round 1 fixes" fixes what a review found,
// a builder, though its brief quotes the review throughout.
/** @param {{ subagentType: string, prompt: string, description?: string }} spawn @returns {Kind} */
export const classifyWorker = ({ subagentType, prompt, description = '' }) => {
  if (/^(explore|plan)$/i.test(subagentType)) return 'scout'
  return kindOf(description) ?? kindOf(prompt) ?? 'general'
}

// A worker known only by its type and description (no brief seen).
/** @param {string} type @param {string} description */
export const kindOfAgent = (type, description) => classifyWorker({ subagentType: type, prompt: '', description })

/** @param {string} text @returns {Kind | null} */
const kindOf = text => {
  if (/\b(review|reviewer|verify|verification|critique|audit|thermo-nuclear|fresh[- ]eyes|adversarial)\b/i.test(text)) return 'reviewer'
  if (/EDITOR_OWNER|Editor owner lock|only Editor MCP user|\bunreal-mcp\b|Editor MCP/i.test(text)) return 'editor'
  if (/\b(test|tests|testing|PIE|simulation|TALab|automation|prove|proof)\b/i.test(text)) return 'tester'
  if (/\b(build|implement|edit|write|fix|fixes|refactor|code|port|migrate)\b/i.test(text)) return 'builder'
  return null
}

// What a worker is doing, from one of its tool calls; null keeps what it was doing.
/** @param {string} tool @param {Record<string, unknown>} input @returns {Prop | null} */
export const propForTool = (tool, input) => {
  if (/^(Read|Grep|Glob|LS|WebFetch|WebSearch|NotebookRead)$/.test(tool)) return 'reading'
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return 'editing'
  // A question waits on the person. A message sent is not waiting on anything: SendMessage does not wait for a reply.
  if (tool === 'AskUserQuestion') return 'asking'
  if (tool === 'Skill') return /review|thermo/i.test(String(input.skill ?? '')) ? 'reviewing' : null
  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = String(input.command ?? '')
    if (isAutomationCommand(command)) return 'testing'
    if (isBuildCommand(command)) return 'building'
    if (/insights|stat (unit|fps)|profil|memreport|Bench\.Combo/i.test(command)) return 'profiling'
    if (/\b(grep|rg|findstr|Select-String|cat|type|ls|dir|git (log|show|diff|status))\b/i.test(command)) return 'reading'
    return null
  }
  if (tool.startsWith('mcp__')) {
    const kind = mcpKind(`${tool} ${JSON.stringify(input).slice(0, 4000)}`)
    if (kind === 'pie') return 'testing'
    return /unreal|editor/i.test(tool) ? 'editor' : 'reading'
  }
  return null
}

// "read → edit → build → test": the distinct steps a worker went through, in order.
/** @param {readonly Prop[]} trail */
export const trailWords = trail => trail.map(prop => TRAIL_WORDS[prop]).join(' → ')

// Running, or queued to run (Claude Code's pending): not finished.
/** @param {WorkerState} state */
export const isLive = state => state === 'running' || state === 'waiting'

/** @param {string} status @returns {WorkerState} */
export const workerState = status => (status === 'running' ? 'running' : status === 'completed' ? 'done' : /fail|kill|error|cancel/i.test(status) ? 'failed' : 'waiting')

/** @param {string} model */
export const modelWord = model => (/opus/i.test(model) ? 'Opus' : /sonnet/i.test(model) ? 'Sonnet' : /haiku/i.test(model) ? 'Haiku' : /fable/i.test(model) ? 'Fable' : model)

// "6:40", or "1:02h" past an hour.
/** @param {number} ms */
export const durationText = ms => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}h` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * What a worker row says, from what is known of the worker. `origin`: 'seen' (Ather saw it
 * dispatched), 'adopted' (found running later; start from Claude Code's record), 'unknown' (no record).
 * `elapsed` null: its time is not known. `via`: the worker that started it when that one is not drawn
 * above it ("Thermo round 1 fixes", "Thermo round 1 fixes (finished)"), or ''.
 * @param {{ state: WorkerState, prop: Prop | null, origin: Origin, elapsed: number | null, tools: number, via: string }} one
 * @returns {{ doing: string, line: string }}
 */
export const crewWords = one => {
  const isRunning = isLive(one.state)
  const isFresh = one.origin === 'seen' && one.elapsed !== null && one.elapsed < 60000
  // Claude Code's pending status (not running yet) reads "queued": "waiting" is kept for a worker waiting on something (⏳).
  const isQueued = one.state === 'waiting'
  const doing = !isRunning ? (one.state === 'done' ? 'finished' : 'stopped') : isQueued ? 'queued' : one.prop ? PROP_WORDS[one.prop] : isFresh ? 'starting' : 'working'
  const liveWord = isQueued ? 'queued' : 'running'
  const time = one.elapsed === null ? (isRunning ? `${liveWord} · start unknown` : '') : `${isRunning ? liveWord : one.state === 'done' ? 'took' : 'stopped at'} ${durationText(one.elapsed)}`
  // Counted only for a worker Ather saw start: one found later shows no count rather than too few.
  const tools = one.origin === 'seen' ? `${one.tools} tool call${one.tools === 1 ? '' : 's'}` : ''
  return { doing, line: [time, tools, one.via ? `started by ${one.via}` : ''].filter(Boolean).join(' · ') }
}

// ---------------------------------------------------------------- drawing

const BODIES = {
  blob: { shape: (/** @type {string} */ f) => `<ellipse cx="50" cy="88" rx="36" ry="46" fill="${f}"/>`, eyes: [[40, 64], [59, 64]] },
  square: { shape: (/** @type {string} */ f) => `<rect x="19" y="44" width="62" height="74" rx="17" fill="${f}" transform="rotate(-8 50 76)"/>`, eyes: [[39, 64], [58, 61]] },
  pill: { shape: (/** @type {string} */ f) => `<rect x="28" y="30" width="44" height="96" rx="22" fill="${f}"/>`, eyes: [[42, 52], [58, 52]], tall: true },
  starfish: { shape: (/** @type {string} */ f) => `<path d="M50 50 L57.6 69.5 L78.5 70.7 L62.4 84 L67.6 104.3 L50 93 L32.4 104.3 L37.6 84 L21.5 70.7 L42.4 69.5 Z" fill="${f}" stroke="${f}" stroke-width="10" stroke-linejoin="round"/>`, eyes: [[44.5, 77], [55.5, 77]] },
  cloud: { shape: (/** @type {string} */ f) => `<g fill="${f}"><circle cx="32" cy="72" r="18"/><circle cx="50" cy="60" r="21"/><circle cx="68" cy="72" r="18"/><rect x="18" y="72" width="64" height="44" rx="14"/></g>`, eyes: [[42, 74], [59, 74]] },
  moon: { shape: (/** @type {string} */ f) => `<defs><mask id="moon"><rect width="100" height="130" fill="#fff"/><circle cx="80" cy="62" r="29" fill="#000"/></mask></defs><circle cx="50" cy="86" r="42" fill="${f}" mask="url(#moon)"/>`, eyes: [[28, 76], [41, 74]] },
}

const OUT = 'stroke="#111" stroke-width="1.6" stroke-linejoin="round"'
const PROP_ART = {
  reading: `<g transform="translate(55 70) rotate(-10)"><rect width="32" height="24" rx="2" fill="#f1ede2" ${OUT}/><rect x="4" y="4" width="9" height="8" fill="#8d8d86"/><path d="M16 5h12M16 9h12M4 15h24M4 19h24" stroke="#8d8d86" stroke-width="2"/></g>`,
  editing: `<g transform="translate(57 66) rotate(-8)"><rect width="23" height="28" rx="2" fill="#4b1f5c" ${OUT}/><path d="M12 32 L34 4" stroke="#111" stroke-width="7" stroke-linecap="round"/><path d="M12 32 L34 4" stroke="#e8b21c" stroke-width="4.5" stroke-linecap="round"/></g>`,
  building: `<g transform="translate(54 66)"><path d="M10 7 V2 H24 V7" fill="none" stroke="#111" stroke-width="5"/><path d="M10 7 V2 H24 V7" fill="none" stroke="#9a2a20" stroke-width="2.6"/><rect y="7" width="34" height="19" rx="3" fill="#d6402f" ${OUT}/><rect x="14" y="13" width="6" height="4" fill="#f3c1b9"/></g>`,
  testing: `<g transform="translate(57 70) rotate(-8)"><rect width="26" height="24" rx="2" fill="#f3e27a" ${OUT}/><path d="M6 12 l5 6 l10 -12" fill="none" stroke="#1a1a1a" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></g>`,
  editor: `<g transform="translate(66 60) rotate(32)"><rect x="-3" y="10" width="7" height="30" rx="2" fill="#2d2d2d" ${OUT}/><rect x="-4.5" y="3" width="10" height="9" fill="#bdbdb6" ${OUT}/><path d="M0.5 -16 C -9 -4, -6 4, 0.5 4 C 7 4, 10 -4, 0.5 -16 Z" fill="#ff7ab8" ${OUT}/></g>`,
  reviewing: `<g transform="translate(58 62)"><path d="M20 20 L32 32" stroke="#111" stroke-width="8" stroke-linecap="round"/><path d="M20 20 L32 32" stroke="#6b4a2a" stroke-width="5" stroke-linecap="round"/><circle cx="13" cy="13" r="11" fill="#cfe9ff" fill-opacity=".85" stroke="#111" stroke-width="5"/><circle cx="13" cy="13" r="11" fill="none" stroke="#9aa3ad" stroke-width="2.4"/></g>`,
  profiling: `<g transform="translate(55 70) rotate(-6)"><rect width="31" height="24" rx="2" fill="#f1ede2" ${OUT}/><path d="M5 19 L12 12 L17 15 L26 6" fill="none" stroke="#2f9a4a" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 5 h6 v6" fill="none" stroke="#2f9a4a" stroke-width="3.2" stroke-linecap="round"/></g>`,
  asking: `<g transform="translate(56 64)"><path d="M3 2 h26 a3 3 0 0 1 3 3 v14 a3 3 0 0 1 -3 3 h-15 l-7 6 v-6 h-4 a3 3 0 0 1 -3 -3 v-14 a3 3 0 0 1 3 -3 z" fill="#f4f4ef" ${OUT}/><path d="M12 8 q4 -4 8 0 q2 3 -3 5 v3" fill="none" stroke="#1a1a1a" stroke-width="2.6" stroke-linecap="round"/><circle cx="17" cy="19.5" r="1.6" fill="#1a1a1a"/></g>`,
  idle: `<g transform="translate(60 74)"><circle cx="20" cy="9" r="5.5" fill="none" stroke="#111" stroke-width="5"/><circle cx="20" cy="9" r="5.5" fill="none" stroke="#f4f4ef" stroke-width="2.4"/><rect width="20" height="19" rx="4" fill="#f4f4ef" ${OUT}/><path d="M6 -4 q3 -4 0 -8 M12 -4 q3 -4 0 -8" stroke="#bdbdb6" stroke-width="2" fill="none" stroke-linecap="round"/></g>`,
}

// One worker's avatar as an SVG document: each is drawn isolated, so its ids never clash. A running avatar is drawn in a
// sandboxed frame (for its bob): the desktop wraps the markup in an HTML page of its own, and the browser paints that
// page opaque (white) when the page's colour scheme differs from the app's. Only the page's root decides it, so the
// avatar carries a style sheet that sets the root to "light dark": the page then takes the app's scheme and stays
// transparent around the round badge. In a still image the same rule names the svg itself and changes nothing.
export const FRAME_SCHEME = '<style>:root{color-scheme:light dark;background:transparent}</style>'
/** @param {Kind} kind @param {Prop | null} prop @param {WorkerState} state */
export const avatarSvg = (kind, prop, state) => {
  const look = KINDS[kind]
  const body = BODIES[look.body]
  const eye = look.light ? '#1b1b1b' : '#f6f0e0'
  const eyes = body.eyes.map(([x, y]) => ('tall' in body ? `<rect x="${x - 3}" y="${y - 7}" width="6" height="14" rx="3" fill="${eye}"/>` : `<ellipse cx="${x}" cy="${y}" rx="4.6" ry="6" fill="${eye}"/>`)).join('')
  const bob = state === 'running' ? '<animateTransform attributeName="transform" type="translate" values="0 0;0 -2.5;0 0" dur="1.8s" repeatCount="indefinite"/>' : ''
  const held = prop ? `<g transform="translate(67 75) scale(1.22) translate(-70 -82)">${PROP_ART[prop]}</g>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="color-scheme: light dark; background: transparent">${FRAME_SCHEME}<defs><clipPath id="round"><circle cx="50" cy="50" r="43"/></clipPath></defs><circle cx="50" cy="50" r="43" fill="#17181a"/><g clip-path="url(#round)"><g><g transform="translate(50 106) scale(1.32) translate(-50 -106)">${body.shape(look.fill)}${eyes}</g>${held}${bob}</g></g><circle cx="50" cy="50" r="45.5" fill="none" stroke="${STATE_COLOURS[state]}" stroke-width="6"/></svg>`
}

// A prop on its own, for the trail under a finished worker.
/** @param {Prop} prop */
export const propSvg = prop => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="48 50 52 52">${PROP_ART[prop]}</svg>`
