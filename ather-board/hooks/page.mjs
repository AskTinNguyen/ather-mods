// @ts-check
// Ather Board: the board as one self-contained HTML page, for the browser and for the shared site.
// Nothing is fetched: the styles, the script, the board's data and the views it cuts them with are all
// inside. The views are views.mjs's own functions, written in by their source. Pure: no `$`.

import * as map from './map.mjs'
import * as views from './views.mjs'

/** @typedef {import('./snapshot.mjs').Board} Board */
/** @typedef {import('./brief.mjs').Brief} Brief */

/** @param {string} text */
const escapeHtml = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char)

// views.mjs's and map.mjs's exports as script: `const name = <source>` for each function, its JSON for each value.
export const viewsScript = () =>
  [...Object.entries(views), ...Object.entries(map)]
    .map(([name, value]) => `const ${name} = ${typeof value === 'function' ? String(value) : JSON.stringify(value)};`)
    .join('\n')

/**
 * @param {Board} board
 * @param {{ now: number, repoName: string, repoUrl: string, css: string, client: string, brief?: Brief | null, briefAt?: number, modules?: import('./modules.mjs').Module[], mapping?: import('./modules.mjs').Mapping }} page
 * `repoUrl`: the repository's web address, for PR and issue links ('' for none); `css`, `client`: page/board.css and page/client.js;
 * `brief`: the latest brief, shown read-only at the top of Triage (A14), and when it was made; `modules`, `mapping`: the game's
 * modules and which intents work on which, for the Map (A15)
 */
export const renderPage = (board, { now, repoName, repoUrl, css, client, brief = null, briefAt = 0, modules = [], mapping = {} }) => {
  const data = JSON.stringify({ records: board.records, now, repoUrl, sha: board.sha, base: board.base, brief, briefAt, modules, mapping })
  // Inside <script>, "</" could end the element: written as "<\/".
  const script = (/** @type {string} */ text) => text.replace(/<\//g, '<\\/')
  const title = `${repoName ? `${repoName} ` : ''}intents`
  const at = new Date(now).toISOString().replace('T', ' ').slice(0, 16)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${css}
</style>
</head>
<body>
<header>
<p class="brand">Ather Board</p>
<h1>${escapeHtml(title)}</h1>
<p id="summary"></p>
</header>
<nav id="tabs" role="tablist"></nav>
<div id="controls"></div>
<div id="shown"></div>
<main id="view"></main>
<footer>Read from ${escapeHtml(board.sha ? `origin/${board.base} at ${board.sha.slice(0, 12)}` : 'the checkout')} on ${at} UTC by Ather Board. Read-only: change an intent in its files.</footer>
<script type="application/json" id="board-data">${script(data)}</script>
<script>
${script(viewsScript())}
${script(client)}
</script>
</body>
</html>
`
}
