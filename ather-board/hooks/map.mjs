// @ts-check
// Ather Board: the intents mapped onto the game's core modules. As sections (the pane's Modules view: a
// group per module, its intents under it), and as a network (the page's Map: modules as hubs on a ring,
// each intent pulled toward the modules it works on and toward the intents it names). Pure: no `$`.
//
// Like views.mjs, the page runs these functions in the browser, written in by their source: every export
// names only other exports of this module or of views.mjs, and the language's own globals.

import { REASONS, WARNINGS, rollup, rollupText, rowOf, sortRecords } from './views.mjs'

/**
 * @typedef {import('./views.mjs').BoardRecord} BoardRecord
 * @typedef {import('./views.mjs').Section} Section
 * @typedef {import('./views.mjs').Sort} Sort
 * @typedef {import('./modules.mjs').Module} Module
 * @typedef {import('./modules.mjs').Mapping} Mapping
 * @typedef {{ key: string, name: string, count: number }} Hub a module on the map, `count` its intents shown
 * @typedef {{ key: string, record: BoardRecord, hubs: string[], isLoud: boolean }} Node an intent on the map; `isLoud`: it needs someone
 * @typedef {{ from: string, to: string, kind: 'in' | 'names' }} Link `in`: an intent works on a module; `names`: one intent names another
 * @typedef {{ hubs: Hub[], nodes: Node[], links: Link[] }} Graph
 */

// Where an intent with no module yet is gathered, on the map and in the list.
export const UNMAPPED = { key: 'unmapped', name: 'Not mapped yet', hint: '' }

// The modules an intent works on as the mapping has them, or the unmapped hub.
/** @param {BoardRecord} record @param {Mapping} mapping */
export const hubsOf = (record, mapping) => (mapping[record.key]?.length ? mapping[record.key] ?? [] : [UNMAPPED.key])

/**
 * The Modules view: a group per module that has intents, in the modules' own order, each with its rollup
 * and its intents (sorted as asked); an intent on several modules is listed under each. Intents not
 * mapped yet come last.
 * @param {readonly BoardRecord[]} records @param {readonly Module[]} modules @param {Mapping} mapping @param {Sort} sort @param {number} now
 * @returns {Section[]}
 */
export const moduleSections = (records, modules, mapping, sort, now) =>
  [...modules, UNMAPPED]
    .map(module => ({ module, list: records.filter(record => hubsOf(record, mapping).includes(module.key)) }))
    .filter(one => one.list.length > 0)
    .map(({ module, list }) => ({
      kind: /** @type {const} */ ('intents'),
      key: `module-${module.key}`,
      title: module.name,
      meta: rollupText(rollup(list), now),
      empty: '',
      hide: /** @type {const} */ (''),
      rows: sortRecords(list, sort).map(record => rowOf(record, WARNINGS)),
    }))

/**
 * The network: the modules that have intents, every intent, a link from each intent to each of its
 * modules, and one link between two intents when either names the other.
 * @param {readonly BoardRecord[]} records @param {readonly Module[]} modules @param {Mapping} mapping @returns {Graph}
 */
export const graphOf = (records, modules, mapping) => {
  const nodes = records.map(record => ({ key: record.key, record, hubs: hubsOf(record, mapping), isLoud: record.stage !== 'done' && record.flags.some(flag => REASONS.some(reason => reason.kind === flag.kind)) }))
  const hubs = [...modules, UNMAPPED].map(module => ({ key: module.key, name: module.name, count: nodes.filter(node => node.hubs.includes(module.key)).length })).filter(hub => hub.count > 0)
  const shown = new Set(nodes.map(node => node.key))
  const pairs = new Set()
  /** @type {Link[]} */
  const links = nodes.flatMap(node => node.hubs.map(hub => ({ from: node.key, to: `hub:${hub}`, kind: /** @type {const} */ ('in') })))
  for (const node of nodes) {
    for (const other of node.record.mentions) {
      const pair = [node.key, other].sort().join('|')
      if (!shown.has(other) || pairs.has(pair)) continue
      pairs.add(pair)
      links.push({ from: node.key, to: other, kind: 'names' })
    }
  }
  return { hubs, nodes, links }
}

// A number from a key, the same every time: where an intent starts before the layout settles it.
/** @param {string} key */
export const seedOf = key => {
  let hash = 2166136261
  for (let index = 0; index < key.length; index += 1) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619) >>> 0
  return hash / 4294967296
}

/**
 * Where everything sits in a `width` × `height` drawing: the hubs evenly on a ring, each intent settled
 * between its hubs and among its neighbours by a small force layout (pulled to its modules and to the
 * intents it names, pushed off the intents around it). The same graph always lays out the same way.
 * @param {Graph} graph @param {number} width @param {number} height
 * @returns {Record<string, { x: number, y: number }>} by intent key, and by `hub:<key>` for the hubs
 */
export const layoutGraph = (graph, width, height) => {
  /** @type {Record<string, { x: number, y: number }>} */
  const at = {}
  const cx = width / 2
  const cy = height / 2
  graph.hubs.forEach((hub, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / Math.max(1, graph.hubs.length)
    at[`hub:${hub.key}`] = { x: cx + Math.cos(angle) * width * 0.33, y: cy + Math.sin(angle) * height * 0.42 }
  })
  const nodes = graph.nodes.map(node => {
    const homes = node.hubs.map(hub => at[`hub:${hub}`]).filter(Boolean)
    const home = homes.reduce((sum, one) => ({ x: sum.x + (one?.x ?? cx) / homes.length, y: sum.y + (one?.y ?? cy) / homes.length }), { x: 0, y: 0 })
    const turn = seedOf(node.key) * 2 * Math.PI
    // Toward the middle from its modules, so the hubs' names stay clear on the outside.
    const point = { x: home.x * 0.78 + cx * 0.22 + Math.cos(turn) * 24, y: home.y * 0.78 + cy * 0.22 + Math.sin(turn) * 24 }
    at[node.key] = point
    return { node, point, homes }
  })
  const names = graph.links.filter(link => link.kind === 'names')
  const margin = 24
  for (let step = 0; step < 160; step += 1) {
    const cool = 1 - step / 160
    for (const { point, homes } of nodes) {
      for (const home of homes) {
        if (!home) continue
        const dx = home.x * 0.78 + cx * 0.22 - point.x
        const dy = home.y * 0.78 + cy * 0.22 - point.y
        point.x += dx * 0.04 * cool
        point.y += dy * 0.04 * cool
      }
    }
    for (const link of names) {
      const a = at[link.from]
      const b = at[link.to]
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      a.x += dx * 0.01 * cool
      a.y += dy * 0.01 * cool
      b.x -= dx * 0.01 * cool
      b.y -= dy * 0.01 * cool
    }
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i]?.point
        const b = nodes[j]?.point
        if (!a || !b) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.hypot(dx, dy) || 0.01
        if (d >= 26) continue
        const push = ((26 - d) / d) * 0.5
        a.x -= dx * push
        a.y -= dy * push
        b.x += dx * push
        b.y += dy * push
      }
    }
    for (const { point } of nodes) {
      point.x = Math.min(width - margin, Math.max(margin, point.x))
      point.y = Math.min(height - margin, Math.max(margin, point.y))
    }
  }
  for (const key of Object.keys(at)) at[key] = { x: Math.round((at[key]?.x ?? 0) * 10) / 10, y: Math.round((at[key]?.y ?? 0) * 10) / 10 }
  return at
}
