// Ather Board page: draws, in the browser, the sections views.mjs says each view shows (sectionsOf),
// as the pane does in the session: a label over its groups, and each group of intents one panel under
// its title, its rows in Ather's anatomy. The Board view lays its groups out as kanban
// columns, and Pulse is the page's own chart. page.mjs writes views.mjs's exports above this script and
// the board's data into #board-data. The look (view, filters, sort, group) lives in the address's #hash,
// so a link opens the same cut.
/* global collisionFact, collisionOwners, moreText, overlapCount, sideLine, spotLabel, graphOf, layoutGraph, STAGES, SORTS, SORT_KEYS, GROUPS, GROUP_KEYS, VIEW_LABELS, HIDES_DONE, DEFAULT_LOOK, pickLook, recordsFor, sectionsOf, pulse, timeline, summaryText, choices, ageText, miniBarSvg */
;(function () {
  'use strict'
  var DATA = JSON.parse(document.getElementById('board-data').textContent)
  var RECORDS = DATA.records
  var NOW = DATA.now
  var PAGE_VIEWS = ['triage', 'board', 'map', 'table', 'items', 'people', 'areas', 'pulse', 'timeline']
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  // The look as flat hash fields, each with its default.
  var FIELDS = {
    view: DEFAULT_LOOK.view, words: '', area: '', owner: '', stage: '', done: '', keys: '',
    sort: DEFAULT_LOOK.sort, group: DEFAULT_LOOK.group, by: DEFAULT_LOOK.by,
  }
  var flat = readHash()
  var opened = {}

  function readHash() {
    var out = Object.assign({}, FIELDS)
    var params = new URLSearchParams(location.hash.slice(1))
    Object.keys(FIELDS).forEach(function (key) {
      if (params.has(key)) out[key] = params.get(key)
    })
    return out
  }
  function writeHash() {
    var params = new URLSearchParams()
    Object.keys(FIELDS).forEach(function (key) {
      if (flat[key] !== FIELDS[key]) params.set(key, flat[key])
    })
    var hash = params.toString()
    history.replaceState(null, '', hash ? '#' + hash : location.pathname + location.search)
  }
  function look() {
    return {
      view: flat.view, sort: flat.sort, group: flat.group, by: flat.by,
      filter: { words: flat.words, area: flat.area, owner: flat.owner, stage: flat.stage, showDone: flat.done === '1', keys: flat.keys ? flat.keys.split(',') : [] },
    }
  }
  function set(patch) {
    Object.assign(flat, patch)
    writeHash()
    draw()
  }

  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }
  function stageOf(key) {
    return STAGES.find(function (s) { return s.key === key }) || { key: key, label: key, glyph: '·' }
  }
  function glyph(key) {
    var stage = stageOf(key)
    return '<span class="glyph" title="' + esc(stage.label) + '">' + stage.glyph + '</span>'
  }
  // Ather's five-cell bar, in the text's own colour, and the count beside it.
  function progress(record) {
    var tip = record.total ? record.done + ' of ' + record.total + ' items met' : 'no acceptance checklist'
    return '<span class="progress" title="' + tip + '">' + miniBarSvg(record.done, record.total, 'currentColor') + '<span class="count">' + (record.total ? record.done + '/' + record.total : '') + '</span></span>'
  }
  function warn(flags) {
    return flags.length ? '<span class="warn">' + esc(flags.map(function (f) { return f.label }).join(' · ')) + '</span>' : ''
  }
  function list(items, className) {
    return '<ul class="items' + (className ? ' ' + className : '') + '">' + items.map(function (item) { return '<li><b>' + esc(item.id) + '</b>' + esc(item.text || item.title) + '</li>' }).join('') + '</ul>'
  }
  function link(number, kind) {
    return DATA.repoUrl ? '<a href="' + esc(DATA.repoUrl) + '/' + kind + '/' + number + '" target="_blank" rel="noopener">#' + number + '</a>' : '#' + number
  }
  // What an intent opens to: its goal, status note, links, the decisions it waits on and its open items.
  function details(record) {
    var refs = []
    if (record.issue) refs.push('issue ' + link(record.issue, 'issues'))
    if (record.prs.length) refs.push('PR ' + record.prs.map(function (n) { return link(n, 'pull') }).join(', '))
    refs.push('<code>docs/intent/' + esc(record.slug) + '</code>')
    return (
      '<div class="details">' +
      (record.goal ? '<p>' + esc(record.goal) + '</p>' : '') +
      (record.statusNote ? '<p><b>Status:</b> ' + esc(record.status) + ', ' + esc(record.statusNote) + '</p>' : '') +
      '<p class="refs">' + refs.join(' · ') + '</p>' +
      (record.calls.length ? '<p class="sub">Waiting on a decision</p>' + list(record.calls, 'calls') : '') +
      (record.openItems.length ? '<p class="sub">Open items</p>' + list(record.openItems) : '') +
      '</div>'
    )
  }
  function toggle(record) {
    return '<button class="line" data-toggle="' + esc(record.key) + '" aria-expanded="' + (opened[record.key] ? 'true' : 'false') + '">'
  }

  // One intent's row; in a group of one owner or one area that column shows the other.
  function row(part, one) {
    var record = one.record
    var isOpen = opened[record.key]
    return (
      '<div class="row' + (record.stage === 'done' ? ' done' : '') + '">' + toggle(record) +
      glyph(record.stage) +
      '<span class="main"><span class="head"><span class="slug">' + esc(record.slug) + '</span>' + warn(one.flags) + '</span><span class="title">' + esc(record.title) + '</span></span>' +
      progress(record) +
      '<span class="age" title="last change">' + esc(ageText(record.updatedAt, NOW)) + '</span>' +
      '<span class="owner">' + esc(part.hide === 'owner' ? record.area : record.owner) + '</span>' +
      '</button>' +
      (one.items.length && !isOpen ? list(one.items, 'under') : '') +
      (isOpen ? details(record) : '') +
      '</div>'
    )
  }
  // A card in its stage's column: the column says the stage, so no glyph.
  function card(one) {
    var record = one.record
    return (
      '<div class="card">' + toggle(record) +
      '<span class="slug">' + esc(record.slug) + '</span>' +
      '<span class="meta">' + esc([record.owner, record.area].filter(Boolean).join(' · ')) + '</span>' +
      '<span class="foot">' + progress(record) + '<span class="age" title="last change">' + esc(ageText(record.updatedAt, NOW)) + '</span></span>' +
      warn(one.flags) +
      '</button>' + (opened[record.key] ? details(record) : '') + '</div>'
    )
  }
  // A collision (overlap-check D5): the intent and what it collides with, the places in amber, the files beneath;
  // opened, each place with both sides' first changed line.
  function pairRow(collision) {
    var a = collision.a, b = collision.b
    var other = a.key === '' ? esc(a.slug) : glyph(a.stage) + ' ' + esc(a.slug)
    var files = collision.files.map(function (f) { return f.split('/').pop() }).join(', ')
    return (
      '<div class="row pair">' + toggle({ key: collision.key }) + glyph(b.stage) +
      '<span class="main"><span class="head"><span class="slug">' + esc(b.slug) + ' <span class="versus-mark">⇄</span> ' + other + '</span><span class="warn">' + esc(overlapCount(collision.count)) + '</span></span><span class="title">' + esc(files) + '</span></span>' +
      '<span class="progress"></span>' +
      '<span class="age" title="the base’s last change to these files">' + esc(collision.base && collision.base.at ? ageText(collision.base.at, NOW) : '') + '</span>' +
      '<span class="owner">' + esc(collisionOwners(collision)) + '</span>' +
      '</button>' + (opened[collision.key] ? pairDetails(collision) : '') + '</div>'
    )
  }
  function pairDetails(collision) {
    var spots = collision.spots.map(function (spot) {
      var label = '<p class="spot">' + esc(spotLabel(collision, spot)) + '</p>'
      return spot.kind !== 'lines' ? label : label + '<div class="versus"><span>' + esc(collision.a.slug) + '</span><code>' + esc(sideLine(spot.ours)) + '</code><span>' + esc(collision.b.slug) + '</span><code>' + esc(sideLine(spot.theirs)) + '</code></div>'
    }).join('')
    var more = moreText(collision) ? '<p class="refs">' + esc(moreText(collision)) + '</p>' : ''
    return '<div class="details"><p class="refs">' + esc(collisionFact(collision, NOW)) + '</p>' + spots + more + '</div>'
  }
  function pairGroup(part) {
    var body = part.pairs.length ? '<div class="panel">' + part.pairs.map(pairRow).join('') + '</div>' : '<p class="empty">' + esc(part.empty) + '</p>'
    return '<section class="group">' + groupHead(part) + body + '</section>'
  }
  function heading(title, meta, isLoud) {
    return '<h2 class="label' + (isLoud ? ' loud' : '') + '"><span>' + esc(title) + '</span>' + (meta ? '<small>' + esc(meta) + '</small>' : '') + '</h2>'
  }
  function groupHead(part) {
    return part.title ? '<h3>' + esc(part.title) + (part.meta ? '<small>' + esc(part.meta) + '</small>' : '') + '</h3>' : ''
  }
  function group(part) {
    var body = part.rows.length ? '<div class="panel">' + part.rows.map(function (one) { return row(part, one) }).join('') + '</div>' : '<p class="empty">' + esc(part.empty) + '</p>'
    return '<section class="group">' + groupHead(part) + body + '</section>'
  }
  function column(part) {
    return '<section class="column">' + groupHead(part) + (part.rows.length ? part.rows.map(card).join('') : '<p class="empty">' + esc(part.empty) + '</p>') + '</section>'
  }
  // People or Areas: one table; a name picked opens the table of its intents, a count what it counts (board-counts D1).
  function lines(part) {
    var cols = [['open', 'Open'], ['parked', 'Parked'], ['done', 'Done'], ['items', 'Open items'], ['calls', 'Decisions'], ['stale', 'Stale']]
    var head = '<tr><th>' + (part.by === 'owner' ? 'Owner' : 'Area') + '</th>' + cols.map(function (c) { return '<th>' + c[1] + '</th>' }).join('') + '<th>Last change</th></tr>'
    var body = part.lines.map(function (line) {
      var sum = line.rollup
      var cells = cols.map(function (c) {
        var n = sum[c[0]]
        var cell = n ? '<button class="count" data-pick="' + part.by + '" data-value="' + esc(line.key) + '" data-count="' + c[0] + '" title="Show ' + esc(c[1].toLowerCase()) + ' of ' + esc(line.title) + '">' + n + '</button>' : n
        return '<td' + (!n ? ' class="zero"' : c[0] === 'calls' || c[0] === 'stale' ? ' class="warn"' : '') + '>' + cell + '</td>'
      }).join('')
      return '<tr><td><button class="pick" data-pick="' + part.by + '" data-value="' + esc(line.key) + '">' + esc(line.title) + '</button></td>' + cells + '<td class="age">' + esc(ageText(sum.at, NOW)) + '</td></tr>'
    }).join('')
    return '<div class="panel tablewrap"><table class="rollups"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>'
  }

  function weekName(start) {
    var day = new Date(start)
    return MONTHS[day.getUTCMonth()] + ' ' + day.getUTCDate()
  }
  function pulseView(records) {
    var p = pulse(records, NOW, 12)
    // The weeks before anything was opened or closed say nothing; this week always shows.
    var first = p.weeks.findIndex(function (w) { return w.opened || w.closed })
    var weeks = p.weeks.slice(first < 0 ? p.weeks.length - 1 : first)
    var max = Math.max(1, Math.max.apply(null, weeks.map(function (w) { return Math.max(w.opened, w.closed) })))
    function bar(kind, value, start) {
      return '<span class="' + kind + '" style="height:' + ((value / max) * 100).toFixed(1) + '%" title="' + value + ' ' + kind + ', week of ' + weekName(start) + '">' + (value ? '<em>' + value + '</em>' : '') + '</span>'
    }
    var chart = weeks.map(function (w) {
      return '<div class="week"><div class="bars">' + bar('opened', w.opened, w.start) + bar('closed', w.closed, w.start) + '</div><span class="day">' + weekName(w.start) + '</span></div>'
    }).join('')
    var total = Math.max(1, records.length)
    var stages = p.stages.map(function (s) {
      return '<div class="stagebar"><span>' + glyph(s.key) + ' ' + esc(s.label) + '</span><span class="track"><i class="s-' + s.key + '" style="width:' + ((s.count / total) * 100).toFixed(1) + '%"></i></span><span class="num">' + s.count + '</span></div>'
    }).join('')
    return (
      heading('Opened and closed, by week', 'closed is dated by the intent’s last commit') +
      '<div class="panel pulse"><p class="legend"><i class="opened"></i>opened <i class="closed"></i>closed</p><div class="weeks" role="img" aria-label="Intents opened and closed per week">' + chart + '</div></div>' +
      heading('Where everything stands', records.length + ' intents') +
      '<div class="panel stages">' + stages + '</div>'
    )
  }
  // The Timeline (board-counts D2): a lane per owner, an intent a bar from its first commit to its last (to now while
  // open), its stage's glyph and slug on it; week lines behind. A bar picked cuts the table to that intent.
  function timelineView(records) {
    var t = timeline(records, NOW, 12)
    var span = Math.max(1, t.end - t.start)
    function x(at) { return (((at - t.start) / span) * 100).toFixed(2) + '%' }
    var ticks = []
    for (var at = t.end - 7 * 86400000; at > t.start; at -= 7 * 86400000) ticks.push('<i class="tick" style="left:' + x(at) + '"><span>' + weekName(at) + '</span></i>')
    var lanes = t.lanes.map(function (lane) {
      var rows = lane.rows.map(function (row) {
        return '<div class="lanerow">' + row.map(function (one) {
          var tip = one.slug + ' · ' + stageOf(one.stage).label + ' · ' + weekName(one.from) + (one.stage === 'done' || one.stage === 'parked' ? ' – ' + weekName(one.to) : ' – now')
          return '<button class="bar s-' + one.stage + (one.isClipped ? ' clipped' : '') + '" data-keys="' + esc(one.key) + '" style="left:' + x(one.from) + ';width:max(' + ((((one.to - one.from) / span) * 100).toFixed(2)) + '%, 6px)" title="' + esc(tip) + '"><span>' + stageOf(one.stage).glyph + ' ' + esc(one.slug) + '</span></button>'
        }).join('') + '</div>'
      }).join('')
      return '<div class="lane"><div class="lanename">' + esc(lane.owner) + '</div><div class="lanebody">' + rows + '</div></div>'
    }).join('')
    return (
      heading('Timeline', 'the last 12 weeks · a lane per owner · each intent from its first commit to its last') +
      '<div class="panel timeline">' + (lanes ? '<div class="timescroll"><div class="axis">' + ticks.join('') + '</div>' + lanes + '</div>' : '<p class="empty">Nothing in these weeks.</p>') + '</div>'
    )
  }
  // The latest brief, read-only (A14): its headline, then each suggestion with the intents it names as
  // links that cut the table to them. Triage alone shows it, and only with no filter in force.
  function briefView() {
    var brief = DATA.brief
    if (!brief || !brief.suggestions.length) return ''
    return (
      heading('Suggested', 'by Sonnet, ' + (ageText(DATA.briefAt, NOW) || 'just now') + ' before this page', true) +
      '<div class="panel brief">' + (brief.headline ? '<p class="headline">' + esc(brief.headline) + '</p>' : '') +
      '<ul>' + brief.suggestions.map(function (one) {
        return '<li><b>' + esc(one.title) + '</b>' + (one.why ? ' <span class="why">' + esc(one.why) + '</span>' : '') +
          '<span class="names">' + one.keys.map(function (key) { return '<button class="pick" data-keys="' + esc(key) + '">' + esc(key) + '</button>' }).join('') + '</span></li>'
      }).join('') + '</ul></div>'
    )
  }
  // The Map (A15): the game's modules as hubs on a ring, each intent a dot pulled toward the modules it
  // works on (a line to each) and toward the intents it names (a dashed line); lime where it needs someone,
  // bigger with more items open. A dot opens its intent below the map; a hub cuts the table to its intents.
  function mapView(records) {
    if (!DATA.modules || !DATA.modules.length) return '<p class="empty">No modules to map yet: open the board in Claude Code (/board) once, so Sonnet can sort the intents.</p>'
    var graph = graphOf(records, DATA.modules, DATA.mapping || {})
    var W = 1000, H = 660
    var at = layoutGraph(graph, W, H)
    var lines = graph.links.map(function (link) {
      var a = at[link.from], b = at[link.to]
      var lit = opened[link.from] || opened[link.to] ? ' lit' : ''
      return a && b ? '<line class="' + (link.kind === 'names' ? 'names' : 'in') + lit + '" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"></line>' : ''
    }).join('')
    var hubs = graph.hubs.map(function (hub) {
      var p = at['hub:' + hub.key]
      var keys = graph.nodes.filter(function (node) { return node.hubs.indexOf(hub.key) >= 0 }).map(function (node) { return node.key }).join(',')
      var anchor = p.x < W / 2 - 4 ? 'end' : p.x > W / 2 + 4 ? 'start' : 'middle'
      var dx = anchor === 'end' ? -14 : anchor === 'start' ? 14 : 0
      var dy = anchor === 'middle' ? (p.y < H / 2 ? -16 : 24) : 4
      return '<g class="hub" data-keys="' + esc(keys) + '" tabindex="0" role="button"><circle cx="' + p.x + '" cy="' + p.y + '" r="9"></circle>' +
        '<text x="' + (p.x + dx) + '" y="' + (p.y + dy) + '" text-anchor="' + anchor + '">' + esc(hub.name) + ' <tspan>' + hub.count + '</tspan></text></g>'
    }).join('')
    var dots = graph.nodes.map(function (node) {
      var p = at[node.key]
      var r = 4 + Math.min(8, node.record.openItems.length) * 0.6
      return '<circle class="dot' + (node.isLoud ? ' loud' : '') + (node.record.stage === 'done' ? ' done' : '') + (opened[node.key] ? ' open' : '') + '" data-toggle="' + esc(node.key) + '" cx="' + p.x + '" cy="' + p.y + '" r="' + r.toFixed(1) + '" tabindex="0" role="button"><title>' + esc(node.record.slug + ' \u2014 ' + node.record.title) + '</title></circle>'
    }).join('')
    var chosen = graph.nodes.filter(function (node) { return opened[node.key] })
    return (
      heading('Modules', graph.hubs.length + ' modules · ' + graph.nodes.length + ' intents') +
      '<div class="panel map"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Intents mapped onto the game\u2019s modules">' + lines + hubs + dots + '</svg>' +
      '<p class="legend"><i class="loud"></i>needs someone <i></i>in hand <i class="names"></i>names another intent · a dot opens its intent, a module lists its intents</p></div>' +
      chosen.map(function (node) { return group({ kind: 'intents', key: 'map-' + node.key, title: '', meta: '', empty: '', hide: '', rows: [{ record: node.record, flags: node.record.flags, items: [] }] }) }).join('')
    )
  }
  function view(records) {
    var current = look()
    if (current.view === 'pulse') return pulseView(records)
    if (current.view === 'timeline') return timelineView(records)
    if (current.view === 'map') return mapView(records)
    var parts = sectionsOf(records, current, NOW, DATA.overlapNote || '')
    if (current.view === 'board') return '<div class="kanban" style="--columns:' + parts.length + '">' + parts.map(column).join('') + '</div>'
    // Triage with no filter in force opens on the brief.
    var isPlain = !flat.words && !flat.area && !flat.owner && !flat.stage && !flat.keys
    var lead = current.view === 'triage' && isPlain ? briefView() : ''
    return lead + parts.map(function (part) { return part.kind === 'label' ? heading(part.title, part.meta, part.isLoud) + part.groups.map(function (g) { return g.kind === 'pairs' ? pairGroup(g) : group(g) }).join('') : part.kind === 'lines' ? lines(part) : group(part) }).join('')
  }

  function options(values, current, any, name) {
    return '<option value="">' + esc(any) + '</option>' + values.map(function (v) { return '<option' + (v === current ? ' selected' : '') + ' value="' + esc(v) + '">' + esc(name ? name(v) : v) + '</option>' }).join('')
  }
  function controls() {
    var c = choices(RECORDS)
    var bits = [
      '<input type="search" id="words" placeholder="Search intents" value="' + esc(flat.words) + '" aria-label="Search">',
      '<select id="area" aria-label="Area">' + options(c.areas, flat.area, 'All areas') + '</select>',
      '<select id="owner" aria-label="Owner">' + options(c.owners, flat.owner, 'Everyone') + '</select>',
      '<select id="stage" aria-label="Stage">' + options(STAGES.map(function (s) { return s.key }), flat.stage, 'All stages', function (k) { return stageOf(k).label }) + '</select>',
    ]
    if (flat.view === 'table' || flat.view === 'board') bits.push('<select id="sort" aria-label="Sort">' + SORT_KEYS.map(function (k) { return '<option' + (k === flat.sort ? ' selected' : '') + ' value="' + k + '">' + esc(SORTS[k]) + '</option>' }).join('') + '</select>')
    if (flat.view === 'table') bits.push('<select id="group" aria-label="Group">' + GROUP_KEYS.map(function (k) { return '<option' + (k === flat.group ? ' selected' : '') + ' value="' + k + '">' + (k === 'none' ? esc(GROUPS[k]) : 'By ' + esc(GROUPS[k].toLowerCase())) + '</option>' }).join('') + '</select>')
    if (flat.view === 'items') bits.push('<select id="by" aria-label="Group items"><option value="area"' + (flat.by === 'area' ? ' selected' : '') + '>By area</option><option value="owner"' + (flat.by === 'owner' ? ' selected' : '') + '>By owner</option></select>')
    if (HIDES_DONE.indexOf(flat.view) >= 0) bits.push('<label class="check"><input type="checkbox" id="done"' + (flat.done === '1' ? ' checked' : '') + '> Show done</label>')
    return bits.join('')
  }

  function draw() {
    document.getElementById('tabs').innerHTML = PAGE_VIEWS.map(function (v) {
      return '<button role="tab" data-view="' + v + '" aria-selected="' + (flat.view === v) + '">' + esc(VIEW_LABELS[v]) + '</button>'
    }).join('')
    // The controls are drawn again; the search field keeps its focus and caret.
    var focused = document.activeElement && document.activeElement.id
    var caret = focused === 'words' ? document.activeElement.selectionStart : null
    document.getElementById('controls').innerHTML = controls()
    var again = focused && document.getElementById(focused)
    if (again) {
      again.focus()
      if (caret !== null && again.setSelectionRange) again.setSelectionRange(caret, caret)
    }
    var records = recordsFor(RECORDS, look())
    document.getElementById('view').innerHTML = view(records)
    document.getElementById('shown').textContent = records.length === RECORDS.length ? '' : records.length + ' of ' + RECORDS.length + ' shown'
  }

  document.getElementById('summary').textContent = summaryText(RECORDS, NOW)
  document.addEventListener('click', function (event) {
    var target = event.target.closest('[data-view],[data-toggle],[data-pick],[data-keys]')
    if (!target) return
    if (target.dataset.view) set({ view: target.dataset.view })
    else if (target.dataset.keys) set({ view: 'table', words: '', area: '', owner: '', stage: '', done: '1', keys: target.dataset.keys })
    else if (target.dataset.pick) {
      var picked = pickLook(look(), target.dataset.pick, target.dataset.value, target.dataset.count)
      set({ view: picked.view, words: picked.filter.words, area: picked.filter.area, owner: picked.filter.owner, stage: picked.filter.stage, done: picked.filter.showDone ? '1' : '', keys: '' })
    } else {
      opened[target.dataset.toggle] = !opened[target.dataset.toggle]
      draw()
    }
  })
  document.addEventListener('input', function (event) {
    if (event.target.id === 'words') set({ words: event.target.value })
  })
  document.addEventListener('change', function (event) {
    var id = event.target.id
    if (id === 'done') set({ done: event.target.checked ? '1' : '' })
    else if (id && id !== 'words') {
      var patch = {}
      patch[id] = event.target.value
      set(patch)
    }
  })
  window.addEventListener('hashchange', function () {
    flat = readHash()
    draw()
  })
  draw()
})()
