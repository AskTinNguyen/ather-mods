// @ts-check
// Ather Board: the game's core modules, and which intents work on which. The modules come from the
// repository's .ather/board.json ("modules": [{ "key", "name", "hint" }]), else S2's default list for an
// Unreal checkout, else the intents' own Areas. Sonnet sorts intents into modules (one to three each);
// each answer is kept with the intent's fingerprint (title, area, goal) and asked again only when that
// changes, or when the list of modules does. Modules made from Areas need no model: an intent sits in its
// area. Pure: no `$`; assist.mjs makes the calls and keeps the answers.

import { MODEL, jsonOf } from './brief.mjs'

/**
 * @typedef {import('./views.mjs').BoardRecord} BoardRecord
 * @typedef {{ key: string, name: string, hint: string }} Module what the model reads: `hint` says what belongs in it
 * @typedef {{ modules: Module[], byArea: boolean }} Modules `byArea`: made from the Areas, so no model is asked
 * @typedef {Record<string, string[]>} Mapping intent key → its module keys
 * @typedef {{ list: string, entries: Record<string, { print: string, modules: string[] }> }} Kept what is kept across sessions: the module list it was asked against, and each intent's answer with its fingerprint
 */

// S2's core modules: the game's systems and the work around them, in the order the map rings them.
export const S2_MODULES = /** @type {readonly Module[]} */ ([
  { key: 'mc-locomotion', name: 'Main character locomotion', hint: 'movement, sprint, dodge, traversal, jumps, camera follow' },
  { key: 'mc-combat', name: 'Main character combat', hint: 'attacks, combos, parry, hit reactions, lock-on, damage' },
  { key: 'mc-ninetails', name: 'Nine-tail abilities', hint: 'the main character’s tails, tail skills and transformations' },
  { key: 'mc-look', name: 'Main character look', hint: 'model, materials, customization, body, animation art' },
  { key: 'enemy-locomotion', name: 'Enemy locomotion', hint: 'how enemies move, navigate and animate' },
  { key: 'enemy-ai', name: 'Enemy AI', hint: 'behaviour trees, perception, decisions, encounter logic' },
  { key: 'enemy-abilities', name: 'Enemy abilities', hint: 'enemy attacks, projectiles, skills, hitboxes' },
  { key: 'bosses', name: 'Bosses', hint: 'boss fights, phases, boss abilities' },
  { key: 'quests', name: 'Quests and encounters', hint: 'quests, encounter design, scripted events, level scripting' },
  { key: 'env-presets', name: 'Environment presets', hint: 'weather, time of day, fog, lighting and look presets' },
  { key: 'env-levels', name: 'Environment levels', hint: 'level layout, world building, HLOD, streaming, foliage' },
  { key: 'vfx', name: 'VFX', hint: 'Niagara and visual effects' },
  { key: 'cinematics', name: 'Cinematics', hint: 'cutscenes, sequences, shots' },
  { key: 'audio', name: 'Audio', hint: 'sound, music, audio tools' },
  { key: 'ui', name: 'UI', hint: 'HUD, menus, front end' },
  { key: 'performance', name: 'Performance', hint: 'optimization, profiling, memory, platform budgets' },
  { key: 'tooling', name: 'Tooling', hint: 'editor tools, validators, pipeline, automation, agent tooling' },
])

// The one module of an intent's own Area, for modules made from Areas.
/** @param {string} area */
const areaKey = area => area.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unsorted'

/**
 * The modules of a repository: its own list from .ather/board.json (`settings`), else S2's for the Unreal
 * pack, else the Areas its intents use.
 * @param {string} packId @param {Record<string, any> | null} settings @param {readonly BoardRecord[]} records @returns {Modules}
 */
export const modulesFor = (packId, settings, records) => {
  const own = Array.isArray(settings?.modules) ? settings.modules.filter((/** @type {any} */ one) => typeof one?.key === 'string' && typeof one?.name === 'string').map((/** @type {any} */ one) => ({ key: one.key, name: one.name, hint: typeof one.hint === 'string' ? one.hint : '' })) : []
  if (own.length > 0) return { modules: own, byArea: false }
  if (packId === 'unreal') return { modules: [...S2_MODULES], byArea: false }
  return { modules: [...new Set(records.map(one => one.area))].sort().map(area => ({ key: areaKey(area), name: area, hint: '' })), byArea: true }
}

// What a module answer depends on: when the intent says something else of itself, it is asked again.
/** @param {BoardRecord} record */
export const fingerprint = record => `${record.title}|${record.area}|${record.goal}`

/** @param {readonly Module[]} modules */
export const listKey = modules => modules.map(one => one.key).join(',')

/**
 * Every intent's modules: by area when the modules are the Areas, else what was kept for it while its
 * fingerprint holds. `missing`: the intents to ask the model about.
 * @param {readonly BoardRecord[]} records @param {Modules} set @param {Kept | null} kept
 * @returns {{ mapping: Mapping, missing: BoardRecord[] }}
 */
export const mappingOf = (records, set, kept) => {
  /** @type {Mapping} */
  const mapping = {}
  /** @type {BoardRecord[]} */
  const missing = []
  const valid = kept && kept.list === listKey(set.modules) ? kept.entries : {}
  for (const record of records) {
    const entry = valid[record.key]
    if (set.byArea) mapping[record.key] = [areaKey(record.area)]
    else if (entry && entry.print === fingerprint(record)) mapping[record.key] = entry.modules
    else missing.push(record)
  }
  return { mapping, missing }
}

// How many intents one request sorts: about 60 lines of digest in, a short JSON object out.
export const BATCH = 60

/** @param {readonly BoardRecord[]} records @param {readonly Module[]} modules */
export const mappingRequest = (records, modules) => ({
  model: MODEL,
  maxTokens: 4000,
  system: 'You sort a game studio’s work items ("intents") into the game’s core modules. Pick the one to three modules each intent mainly works on, most central first. Use only the module keys given; never invent one. An intent about a tool for a module belongs to that module and to tooling.',
  prompt: `The modules (key: name, what belongs in it):\n${modules.map(one => `${one.key}: ${one.name}${one.hint ? `, ${one.hint}` : ''}`).join('\n')}\n\nThe intents (key | title | area | goal):\n${records.map(one => [one.key, one.title, one.area, one.goal].join(' | ')).join('\n')}\n\nReply with JSON only, no prose around it: {"<intent key>": ["<module key>", ...], ...} for every intent above.`,
})

/**
 * The model's sorting, checked: known intents and modules only, at most three each, once each. An
 * intent the reply leaves out stays missing, to be asked again.
 * @param {string} text @param {readonly BoardRecord[]} records @param {readonly Module[]} modules @returns {Mapping}
 */
export const parseMapping = (text, records, modules) => {
  const reply = jsonOf(text)
  if (!reply) return {}
  const known = new Set(modules.map(one => one.key))
  /** @type {Mapping} */
  const mapping = {}
  for (const record of records) {
    const value = reply[record.key]
    const picked = Array.isArray(value) ? [...new Set(value.filter(key => typeof key === 'string' && known.has(key)))].slice(0, 3) : []
    if (picked.length > 0) mapping[record.key] = picked
  }
  return mapping
}

// What is kept once the model has answered for some intents.
/** @param {Kept | null} kept @param {readonly Module[]} modules @param {readonly BoardRecord[]} records @param {Mapping} answered @returns {Kept} */
export const keep = (kept, modules, records, answered) => {
  const list = listKey(modules)
  const entries = kept && kept.list === list ? { ...kept.entries } : {}
  for (const record of records) {
    const answer = answered[record.key]
    if (answer) entries[record.key] = { print: fingerprint(record), modules: answer }
  }
  return { list, entries }
}
