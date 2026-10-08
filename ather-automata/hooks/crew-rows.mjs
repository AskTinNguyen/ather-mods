// @ts-check
// Ather Automata: the pane's workers, drawn as a tree (each worker under the one that started it),
// with the elements the pane is handed (`el`). Pure: no `$`; a press on a worker arrives as a
// closure from console.mjs.

import { crewHeading, crewTree } from './crew.mjs'
import { KINDS, PROP_WORDS, STATE_COLOURS, STATE_GLYPHS, avatarSvg, crewWords, isLive, propSvg, trailWords } from './squad.mjs'
import { AMBER, QUIET, fit, label, section } from './rows.mjs'

/** @typedef {import('./crew.mjs').Crew} Crew */
/** @typedef {import('./crew.mjs').CrewLine} CrewLine */

// The live workers' tree under "Workers · Running N · Waiting on M", then the last few done with theirs.
/** @param {any} el @param {{ crew: readonly Crew[], width: number, isClicked: boolean, onWorker: (one: Crew) => () => void }} look */
export const crewSections = (el, look) => {
  const tree = crewTree(look.crew)
  const doneCount = tree.done.filter(line => line.kind === 'worker' && line.depth === 0).length
  const sections = []
  if (tree.live.length > 0) sections.push(section(el, 'workers', [label(el, 'workers-label', crewHeading(tree), look.width), ...tree.live.map(line => crewLine(el, look, line))]))
  if (tree.done.length > 0) sections.push(section(el, 'workers-done', [label(el, 'workers-done-label', `Done ${doneCount}`, look.width), ...tree.done.map(line => crewLine(el, look, line))]))
  return sections
}

// How deep a line sits: on the desktop a left pad, in the terminal "└ " under its parent (two more spaces a level).
/** @param {any} el @param {string} key @param {number} depth */
const indent = (el, key, depth) => el.Text({ key: `${key}-indent`, color: QUIET, children: `${'  '.repeat(depth - 1)}└` })

/** @param {any} el @param {{ width: number, isClicked: boolean, onWorker: (one: Crew) => () => void }} look @param {CrewLine} line */
const crewLine = (el, look, line) => {
  if (line.kind === 'fold') {
    const words = el.Text({ key: `fold-${line.key}-text`, color: QUIET, children: `+${line.count} finished` })
    return look.isClicked
      ? el.Box({ key: `fold-${line.key}`, paddingLeft: line.depth * 4, marginTop: 1, children: [words] })
      : el.Box({ key: `fold-${line.key}`, flexDirection: 'row', gap: 1, children: [indent(el, `fold-${line.key}`, line.depth), words] })
  }
  const lead = line.depth > 0 && !look.isClicked ? [indent(el, `tree-${line.one.id}`, line.depth)] : []
  const row = crewRow(el, look, line.one, look.width - line.depth * 2, lead)
  return line.depth > 0 && look.isClicked ? el.Box({ key: `tree-${line.one.id}`, paddingLeft: line.depth * 4, width: '100%', children: [row] }) : row
}

// `lead`: what the terminal draws before the state glyph (the tree's indent).
/** @param {any} el @param {{ isClicked: boolean, onWorker: (one: Crew) => () => void }} look @param {Crew} one @param {number} width @param {any[]} lead */
const crewRow = (el, { isClicked, onWorker }, one, width, lead) => {
  const look = KINDS[one.kind]
  const { doing, line } = crewWords(one)
  const kindLine = el.Box({ key: `${one.id}-kind`, flexDirection: 'row', children: [el.Text({ color: look.fill, bold: true, children: look.word }), el.Text({ color: QUIET, children: ` · ${[one.model, doing].filter(Boolean).join(' · ')}` })] })
  const how = isLive(one.state)
    ? el.Text({ key: `${one.id}-how`, color: QUIET, wrap: 'wrap', children: line })
    : el.Box({
        key: `${one.id}-how`,
        flexDirection: 'row',
        children: [
          ...(isClicked && one.trail.length > 0
            ? one.trail.flatMap((prop, index) => [...(index > 0 ? [el.Text({ color: QUIET, children: ' → ' })] : []), el.Svg({ source: propSvg(prop), alt: PROP_WORDS[prop], width: 22, height: 22 })])
            : one.trail.length > 0 ? [el.Text({ color: QUIET, children: trailWords(one.trail) })] : []),
          el.Text({ color: STATE_COLOURS[one.state], children: `${one.trail.length > 0 ? ' ' : ''}${STATE_GLYPHS[one.state]}` }),
          ...(line ? [el.Text({ color: QUIET, children: ` · ${line}` })] : []),
        ],
      })
  // What it waits on and a call that has run too long, in amber: facts from the calls in flight.
  const amber = [one.wait, one.stuck].filter(Boolean).map((text, index) => el.Text({ key: `${one.id}-wait-${index}`, color: AMBER, wrap: 'wrap', children: isClicked ? text : fit(text, Math.max(10, width - 2)) }))
  const words = el.Box({
    key: `${one.id}-words`,
    flexDirection: 'column',
    flexGrow: 1,
    children: [el.Button({ key: `worker-${one.id}`, label: fit(one.title, width - 8), plain: true, onPress: onWorker(one) }), kindLine, how, ...amber],
  })
  const glyph = el.Text({ key: `${one.id}-glyph`, color: STATE_COLOURS[one.state], children: STATE_GLYPHS[one.state] })
  // The desktop draws the worker's avatar; the terminal leads with its state glyph.
  return isClicked
    ? el.Box({ key: `crew-${one.id}`, flexDirection: 'row', gap: 2, width: '100%', alignItems: 'center', marginTop: 1, children: [el.Svg({ source: avatarSvg(one.kind, one.prop, one.state), alt: `${look.word}, ${one.state}`, width: 40, height: 40, isInteractive: one.state === 'running' ? true : undefined }), words, glyph] })
    : el.Box({ key: `crew-${one.id}`, flexDirection: 'row', gap: 1, children: [...lead, glyph, words] })
}
