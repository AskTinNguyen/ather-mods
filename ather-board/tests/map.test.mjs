// @ts-check
// Ather Board's map (rev 3): the game's modules (A15), which intents work on which (the model's sorting,
// checked and kept by fingerprint), how intents name each other, the Modules view and the network.
// The intents are made up here; none is S2's.
import { describe, expect, test } from 'claude-code/testing'

import { unreal } from '../hooks/ather/packs/unreal.mjs'
import { UNMAPPED, graphOf, layoutGraph, moduleSections } from '../hooks/map.mjs'
import { S2_MODULES, fingerprint, keep, listKey, mappingOf, mappingRequest, modulesFor, parseMapping } from '../hooks/modules.mjs'
import { mentionsOf, toRecord } from '../hooks/records.mjs'
import { DAY_MS } from '../hooks/views.mjs'

const NOW = Date.UTC(2026, 9, 13, 12)
const SLUGS = new Set(['dodge-roll', 'boss-ai', 'snow-preset'])

/** @param {string} slug @param {string} title @param {string} area @param {string} body @param {number} age */
const record = (slug, title, area, body, age) => toRecord({ slug, prompt: `# ${title}\n\n- Status: active\n- Area: ${area}\n- Owner: Tin Nguyen\n\n## Goal\n\n${title} for the game. ${body}\n\n## Acceptance\n\n- A1: Done.\n`, progress: '', findings: '', files: [], hasDebrief: false, updatedAt: NOW - age * DAY_MS, source: 'main', firstAuthor: '' }, { pack: unreal, createdAt: 0, now: NOW, slugs: SLUGS })

const RECORDS = [
  record('dodge-roll', 'Dodge roll', 'Combat', 'Needs boss-ai to read it.', 1),
  record('boss-ai', 'Boss AI', 'Bosses', 'Reacts to dodge-roll.', 2),
  record('snow-preset', 'Snow preset', 'World & Levels', 'No links.', 9),
]
const MODULES = [{ key: 'mc-locomotion', name: 'Main character locomotion', hint: '' }, { key: 'bosses', name: 'Bosses', hint: '' }, { key: 'env-presets', name: 'Environment presets', hint: '' }]

describe('the modules (A15)', () => {
  test('a repository’s own list wins; else S2’s for an Unreal checkout; else the Areas, which need no model', () => {
    expect(modulesFor('unreal', { modules: [{ key: 'x', name: 'X' }, { name: 'no key' }] }, RECORDS)).toEqual({ modules: [{ key: 'x', name: 'X', hint: '' }], byArea: false })
    expect(modulesFor('unreal', null, RECORDS).modules.map(one => one.key)).toEqual(S2_MODULES.map(one => one.key))
    expect(S2_MODULES.map(one => one.key)).toContain('mc-ninetails')
    expect(modulesFor('web', null, RECORDS)).toEqual({ modules: [{ key: 'bosses', name: 'Bosses', hint: '' }, { key: 'combat', name: 'Combat', hint: '' }, { key: 'world-levels', name: 'World & Levels', hint: '' }], byArea: true })
  })
  test('by area every intent sits in its own area’s module, and nothing is asked', () => {
    const { mapping, missing } = mappingOf(RECORDS, modulesFor('web', null, RECORDS), null)
    expect([mapping['dodge-roll'], missing.length]).toEqual([['combat'], 0])
  })
})

describe('sorting intents into modules (A15)', () => {
  test('the request lists every module with its hint and every intent; Sonnet is asked', () => {
    const request = mappingRequest(RECORDS, MODULES)
    expect(request.model).toBe('sonnet')
    expect(request.prompt).toContain('mc-locomotion: Main character locomotion')
    expect(request.prompt).toContain('dodge-roll | Dodge roll | Combat | Dodge roll for the game')
  })
  test('a reply is checked: known intents and modules only, at most three, once each; one left out stays missing', () => {
    const reply = 'Sure:\n' + JSON.stringify({ 'dodge-roll': ['mc-locomotion', 'mc-locomotion', 'made-up', 'bosses', 'env-presets', 'bosses'], 'ghost': ['bosses'], 'boss-ai': 'bosses' })
    expect(parseMapping(reply, RECORDS, MODULES)).toEqual({ 'dodge-roll': ['mc-locomotion', 'bosses', 'env-presets'] })
    expect(parseMapping('no json', RECORDS, MODULES)).toEqual({})
  })
  test('an answer is kept with the intent’s fingerprint: asked again only when the intent or the list of modules changes', () => {
    const set = { modules: MODULES, byArea: false }
    const kept = keep(null, MODULES, RECORDS, { 'dodge-roll': ['mc-locomotion'], 'boss-ai': ['bosses'] })
    expect(kept.list).toBe(listKey(MODULES))
    expect(kept.entries['dodge-roll']).toEqual({ print: fingerprint(RECORDS[0] ?? RECORDS[1]), modules: ['mc-locomotion'] })
    const first = mappingOf(RECORDS, set, kept)
    expect([first.mapping, first.missing.map(one => one.key)]).toEqual([{ 'dodge-roll': ['mc-locomotion'], 'boss-ai': ['bosses'] }, ['snow-preset']])
    const renamed = RECORDS.map(one => (one.key === 'boss-ai' ? { ...one, title: 'Boss brain' } : one))
    expect(mappingOf(renamed, set, kept).missing.map(one => one.key)).toEqual(['boss-ai', 'snow-preset'])
    expect(mappingOf(RECORDS, { modules: [...MODULES, { key: 'ui', name: 'UI', hint: '' }], byArea: false }, kept).missing.length).toBe(3)
  })
})

describe('how intents relate, and the map (A15)', () => {
  test('an intent names another when its files use that intent’s folder name', () => {
    expect([RECORDS[0]?.mentions, RECORDS[2]?.mentions]).toEqual([['boss-ai'], []])
    expect(mentionsOf({ slug: 'a-b', prompt: 'See boss-ai and Dodge-Roll, not dodge.', progress: '', findings: 'snow-preset-2', files: [], hasDebrief: false, updatedAt: 0, source: 'main', firstAuthor: '' }, SLUGS)).toEqual(['boss-ai', 'dodge-roll'])
  })
  const MAPPING = { 'dodge-roll': ['mc-locomotion', 'bosses'], 'boss-ai': ['bosses'] }
  test('Modules: a group per module with intents, in the list’s order; an intent on two is under both; unmapped last', () => {
    const parts = moduleSections(RECORDS, MODULES, MAPPING, 'recent', NOW)
    expect(parts.map(part => part.kind === 'intents' && `${part.title}: ${part.rows.map(row => row.record.slug).join(',')}`)).toEqual(['Main character locomotion: dodge-roll', 'Bosses: dodge-roll,boss-ai', `${UNMAPPED.name}: snow-preset`])
  })
  test('the network: hubs with intents, a link from each intent to each module, one link per pair that names each other', () => {
    const graph = graphOf(RECORDS, MODULES, MAPPING)
    expect(graph.hubs.map(hub => `${hub.key}:${hub.count}`)).toEqual(['mc-locomotion:1', 'bosses:2', 'unmapped:1'])
    expect(graph.links.filter(link => link.kind === 'names')).toEqual([{ from: 'dodge-roll', to: 'boss-ai', kind: 'names' }])
    expect(graph.links.filter(link => link.kind === 'in').length).toBe(4)
  })
  test('the layout: the same every time, everything inside the drawing, each intent nearer its own module than another', () => {
    const graph = graphOf(RECORDS, MODULES, MAPPING)
    const at = layoutGraph(graph, 1000, 660)
    expect(JSON.stringify(layoutGraph(graph, 1000, 660))).toBe(JSON.stringify(at))
    expect(Object.values(at).every(p => p.x >= 0 && p.x <= 1000 && p.y >= 0 && p.y <= 660)).toBe(true)
    const distance = (/** @type {string} */ a, /** @type {string} */ b) => Math.hypot((at[a]?.x ?? 0) - (at[b]?.x ?? 0), (at[a]?.y ?? 0) - (at[b]?.y ?? 0))
    expect(distance('snow-preset', 'hub:unmapped') < distance('snow-preset', 'hub:bosses')).toBe(true)
    expect(distance('boss-ai', 'hub:bosses') < distance('boss-ai', 'hub:mc-locomotion')).toBe(true)
  })
})
