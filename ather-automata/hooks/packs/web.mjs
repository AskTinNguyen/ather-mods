// @ts-check
// Ather Automata, the web pack: Node and TypeScript web apps (piloted on Thính,
// AskTinNguyen/han-viet). Roles and their proof, the rungs (tests, lint and
// typecheck, build, ui, prod) read from tool output only (exit code plus
// pass/fail counts), the gates the repository's .ather/profile.json names,
// actions held while the person is away, known traps, and the words the
// session is asked with. Pure: no `$`.

import { bareCommand, isPiped, segments } from '../shell.mjs'

/** @typedef {import('./index.mjs').Pack} Pack */
/** @typedef {import('./index.mjs').Rung} Rung */
/** @typedef {import('./index.mjs').Gate} Gate */
/** @typedef {import('./index.mjs').Production} Production */

export const RUNGS = /** @type {const} */ (['tests', 'lint', 'build', 'ui', 'prod'])
const RUNG_LABELS = { tests: 'passing tests', lint: 'a clean lint and typecheck', build: 'a build that succeeded', ui: 'a passing browser check', prod: 'a healthy production deployment' }
const PROOF_WORDS = { tests: 'tests', lint: 'lint', build: 'build', ui: 'UI', prod: 'prod' }
// A profile's proof names, folded onto the five rungs.
const ALIASES = /** @type {Record<string, string>} */ ({ tests: 'tests', test: 'tests', unit: 'tests', lint: 'lint', typecheck: 'lint', types: 'lint', tsc: 'lint', build: 'build', ui: 'ui', e2e: 'ui', a11y: 'ui', browser: 'ui', prod: 'prod', production: 'prod' })

export const ROLES = /** @type {const} */ (['engineer', 'designer', 'product'])
const ROLE_LABELS = { engineer: 'Engineer', designer: 'Designer', product: 'Product' }
const DEFAULT_AREAS = ['Product', 'Design', 'Content', 'Platform', 'Infra']

/** @param {string} text */
export const parseRole = text => {
  const words = text.toLowerCase()
  if (/design/.test(words)) return 'designer'
  if (/product|\bpm\b|manager/.test(words)) return 'product'
  if (/engineer|programmer|coder|developer|dev\b/.test(words)) return 'engineer'
  return null
}

/** @param {readonly string[]} items */
const andList = items => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`)

// ---------------------------------------------------------------- commands and gates

// "npm run test", "npm t" and "npm test" are one command; spacing does not matter.
/** @param {string} command */
const normal = command =>
  bareCommand(command)
    .replace(/\s+/g, ' ')
    .replace(/^(npm|pnpm|yarn|bun)\s+(?:run\s+|run-script\s+)?(?:t|tst)$/i, '$1 test')
    .replace(/^(npm|pnpm|yarn|bun)\s+(?:run|run-script)\s+(test|start)\b/i, '$1 $2')
    .trim()

/** @param {string} gate @param {string} segment */
const isGate = (gate, segment) => {
  const a = normal(gate)
  const b = normal(segment)
  return a !== '' && (b === a || b.startsWith(`${a} `))
}

// The npm script a segment runs: "npm run lint" → "lint", "npm test" → "test".
/** @param {string} segment */
const scriptOf = segment => /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+|run-script\s+)?([\w:.-]+)/i.exec(normal(segment))?.[1] ?? null

/** @param {string} url */
const hostOf = url => /^https?:\/\/([^/:?#\s]+)/i.exec(url)?.[1]?.toLowerCase() ?? ''

/**
 * The rungs a command tries, through the profile's gates first, then the scripts in package.json
 * (one level deep), then the tools it runs.
 * @param {string} command @param {Record<string, string>} scripts @param {readonly Gate[]} gates @param {Production | null} [production] @param {number} [depth]
 * @returns {string[]}
 */
export const rungsOfCommand = (command, scripts, gates, production = null, depth = 0) => {
  /** @type {Set<string>} */
  const found = new Set()
  for (const segment of segments(command)) {
    const bare = bareCommand(segment)
    const gate = gates.find(one => isGate(one.command, bare))
    if (gate) {
      for (const proof of gate.proofs) if (ALIASES[proof] && ALIASES[proof] !== 'prod') found.add(ALIASES[proof])
      continue
    }
    const script = scriptOf(bare)
    if (script && depth < 2 && /^(npm|pnpm|yarn|bun)\b/i.test(bare) && scripts[script] !== undefined) {
      for (const rung of rungsOfCommand(scripts[script] ?? '', scripts, gates, production, depth + 1)) found.add(rung)
      continue
    }
    if (/^node\b.*\s--test\b/i.test(bare) || /^(vitest|jest)\b/i.test(bare)) found.add('tests')
    else if (/^playwright\s+test\b/i.test(bare)) found.add('ui')
    else if (/^(tsc|vue-tsc)\b/i.test(bare) || /^(eslint|next\s+lint)\b/i.test(bare)) found.add('lint')
    else if (/^(next|vinext|vite|astro|nuxt|remix)\s+build\b/i.test(bare)) found.add('build')
    else if (isProdCheck(bare, production)) found.add('prod')
  }
  return [...found]
}

// A check of production: the deployment's status through gh or vercel, or a probe of the public URL.
/** @param {string} bare @param {Production | null} production */
const isProdCheck = (bare, production) => {
  if (/^gh\s+api\b.*(\/commits\/[^\s/]+\/(status|check-runs)\b|\/deployments\b)/i.test(bare) && !/\s(-X|--method)\s*(POST|PUT|PATCH|DELETE)\b/i.test(bare)) return true
  if (/^vercel\s+(inspect|ls|list)\b/i.test(bare)) return true
  const host = production ? hostOf(production.url) : ''
  return host !== '' && /^(curl|wget|Invoke-WebRequest|iwr|http)\b/i.test(bare) && bare.toLowerCase().includes(host)
}

// ---------------------------------------------------------------- results from tool output

// Terminal colour codes, which some tools print even into a pipe.
/** @param {string} text */
export const stripAnsi = text => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

// The command's exit: a failed tool call or "Exit code N" is a failure; a piped command's exit is the filter's.
/** @param {string} command @param {string} text @param {{ isError?: boolean }} ran @returns {'ok' | 'fail' | 'unknown'} */
export const exitOf = (command, text, ran) => {
  if (isPiped(command)) return 'unknown'
  if (ran.isError === true || /^\s*Exit code [1-9]\d*/.test(text)) return 'fail'
  return 'ok'
}

/** @param {RegExpMatchArray[]} matches @param {number} group */
const sum = (matches, group) => matches.reduce((total, match) => total + Number(match[group] ?? 0), 0)

// Pass and fail counts from every runner whose summary is in the output, added up.
/** @param {string} text */
export const testCounts = text => {
  const nodePass = [...text.matchAll(/^\s*[#ℹ]\s*pass\s+(\d+)\s*$/gmu)]
  const nodeFail = [...text.matchAll(/^\s*[#ℹ]\s*fail\s+(\d+)\s*$/gmu)]
  const nodeCancelled = [...text.matchAll(/^\s*[#ℹ]\s*cancelled\s+(\d+)\s*$/gmu)]
  // vitest: " Tests  1 failed | 11 passed (12)"
  const vitest = [...text.matchAll(/^\s*Tests\s+(?:(\d+) failed)?(?:\s*\|\s*)?(?:(\d+) passed)?.*\(\d+\)\s*$/gm)]
  // jest: "Tests:       1 failed, 11 passed, 12 total"
  const jest = [...text.matchAll(/^\s*Tests:\s+(?:(\d+) failed,\s*)?(?:\d+ skipped,\s*)?(?:\d+ todo,\s*)?(?:(\d+) passed,\s*)?\d+ total/gm)]
  // Playwright: "  12 passed (30.1s)", "  1 failed", "  1 flaky"
  const pwPass = [...text.matchAll(/^\s+(\d+) passed \([\d.]+m?s\)\s*$/gm)]
  const pwFail = [...text.matchAll(/^\s+(\d+) (failed|interrupted|timed out)\s*$/gm)]
  const passed = sum(nodePass, 1) + sum(vitest, 2) + sum(jest, 2) + sum(pwPass, 1)
  const failed = sum(nodeFail, 1) + sum(nodeCancelled, 1) + sum(vitest, 1) + sum(jest, 1) + sum(pwFail, 1)
  const none = /\bNo tests found\b|\bNo test files found\b|^\s*[#ℹ]\s*tests\s+0\s*$/mu.test(text)
  return { passed, failed, none, seen: nodePass.length + nodeFail.length + vitest.length + jest.length + pwPass.length + pwFail.length > 0 }
}

// ESLint and tsc errors; warnings are not failures.
/** @param {string} text */
export const lintErrors = text => {
  const eslint = [...text.matchAll(/✖\s*\d+ problems?\s*\((\d+) errors?,\s*\d+ warnings?\)/g)]
  const tsc = [...text.matchAll(/Found (\d+) errors?\b/g)]
  const tsLines = (text.match(/\berror TS\d+:/g) ?? []).length
  const typeError = /^\s*Type error:|Failed to type check/m.test(text) ? 1 : 0
  return sum(eslint, 1) + Math.max(sum(tsc, 1), tsLines) + typeError
}

const BUILD_FAILED = /Failed to compile|Build error occurred|> Build failed|\bBuild failed\b|error during build:|\[vite\]:? Rollup failed|\bERR_BUILD\b|^\s*Type error:/im
const BUILD_PASSED = /✓ Compiled successfully|^\s*Build complete\.|Compiled successfully in|✓ built in [\d.]+m?s|\bbuilt in [\d.]+m?s\b|Generating static pages.*\(\d+\/\d+\)/i

/** @param {string} text @param {Production | null} production @returns {'pass' | 'fail' | null} */
const prodResult = (text, production) => {
  const state = /"state"\s*:\s*"(success|failure|error|pending|inactive)"/i.exec(text)?.[1]?.toLowerCase()
  if (state === 'success') return 'pass'
  if (state === 'failure' || state === 'error') return 'fail'
  if (/status\s+●\s*Ready\b|●\s*Ready\b.*\bProduction\b/i.test(text)) return 'pass'
  if (/status\s+●\s*(Error|Canceled)\b/i.test(text)) return 'fail'
  const status = Number(/HTTP\/[\d.]+\s+(\d{3})/i.exec(text)?.[1] ?? /^\s*(\d{3})\s*$/m.exec(text)?.[1] ?? /StatusCode\s*:\s*(\d{3})/i.exec(text)?.[1] ?? 0)
  if (status === 0) return null
  return status === (production?.expectStatus ?? 200) ? 'pass' : status >= 400 ? 'fail' : null
}

/**
 * One rung's result from a finished command's output.
 * @param {string} rung @param {string} command @param {string} raw the output @param {{ isError?: boolean }} ran @param {Production | null} [production]
 * @returns {Rung | null} null: nothing to record
 */
export const readToolOutput = (rung, command, raw, ran, production = null) => {
  const text = stripAnsi(raw)
  const exit = exitOf(command, text, ran)
  if (rung === 'tests' || rung === 'ui') {
    const counts = testCounts(text)
    if (counts.failed > 0) return { state: 'fail', detail: `${counts.failed} failed${counts.passed > 0 ? `, ${counts.passed} passed` : ''}` }
    if (exit === 'fail') return { state: 'fail', detail: 'exited non-zero' }
    if (counts.none) return { state: 'fail', detail: 'no tests ran' }
    if (counts.passed > 0) return { state: 'pass', detail: `${counts.passed} passed, 0 failed` }
    // Every run replaces the last result: a run whose outcome cannot be read is no evidence.
    return { state: 'none', detail: 'no test counts read' }
  }
  if (rung === 'lint') {
    const errors = lintErrors(text)
    if (errors > 0) return { state: 'fail', detail: `${errors} error${errors === 1 ? '' : 's'}` }
    if (exit === 'fail') return { state: 'fail', detail: 'exited non-zero' }
    return exit === 'ok' ? { state: 'pass', detail: 'exit 0, no errors' } : { state: 'none', detail: 'piped: exit code not read' }
  }
  if (rung === 'build') {
    if (BUILD_FAILED.test(text) || exit === 'fail') return { state: 'fail', detail: exit === 'fail' ? 'exited non-zero' : 'the build reported a failure' }
    if (exit === 'ok' || BUILD_PASSED.test(text)) return { state: 'pass', detail: exit === 'ok' ? 'exit 0' : 'build reported success' }
    return { state: 'none', detail: 'piped: exit code not read' }
  }
  if (rung === 'prod') {
    const result = prodResult(text, production)
    return result === null ? null : { state: result, detail: result === 'pass' ? 'production healthy' : 'production check failed' }
  }
  return null
}

// ---------------------------------------------------------------- held while away

const HELD_LABELS = { 'deploy-prod': 'Production deploys', migrate: 'Migrations against a non-local database', 'env-secret': 'Environment and secret changes', publish: 'Package publishes', 'infra-apply': 'Infrastructure applies' }
const HELD_NOUNS = { 'deploy-prod': 'a production deploy', migrate: 'a migration against a non-local database', 'env-secret': 'an environment or secret change', publish: 'a package publish', 'infra-apply': 'an infrastructure apply' }
export const WEB_HELD = /** @type {const} */ (['deploy-prod', 'migrate', 'env-secret', 'publish', 'infra-apply'])

const WRITE = /\s(-X|--method)\s*(POST|PUT|PATCH|DELETE)\b/i
// A database URL given inline that points at this machine.
const LOCAL_DB = /\b(DATABASE_URL|DB_URL|POSTGRES_URL|MYSQL_URL|TURSO_DATABASE_URL)=\S*(localhost|127\.0\.0\.1|\[::1\]|file:|:memory:)/i

/** @param {string} segment the segment as typed (env assignments kept) @returns {string | null} */
const heldKindOf = segment => {
  const bare = bareCommand(segment)
  if (/^vercel\b(?!\s+(env|inspect|ls|list|logs|whoami|login|link|pull)\b).*\s--prod(uction)?\b/i.test(bare) || /^vercel\s+(promote|rollback|alias\s+set)\b/i.test(bare)) return 'deploy-prod'
  if (/^wrangler\s+(deploy|publish)\b/i.test(bare) && !/--dry-run\b/i.test(bare)) return 'deploy-prod'
  if (/^wrangler\s+pages\s+deploy\b/i.test(bare) && !/--branch[=\s]+(?!main\b|master\b)\S+/i.test(bare)) return 'deploy-prod'
  if (/^(netlify\s+deploy\b.*--prod|firebase\s+deploy\b|fly(ctl)?\s+deploy\b)/i.test(bare)) return 'deploy-prod'
  if (/^gh\s+api\b/i.test(bare) && WRITE.test(bare) && /\/deployments\b/i.test(bare) && /production/i.test(bare)) return 'deploy-prod'
  const isMigration =
    /^drizzle-kit\s+(migrate|push)\b/i.test(bare) ||
    /^prisma\s+(migrate\s+(deploy|reset)|db\s+push)\b/i.test(bare) ||
    /^knex\s+migrate:(latest|up|down|rollback)\b/i.test(bare) ||
    /^sequelize(-cli)?\s+db:migrate\b/i.test(bare) ||
    /^typeorm\s+migration:(run|revert)\b/i.test(bare) ||
    /^supabase\s+db\s+(push|reset)\b/i.test(bare) ||
    (/^wrangler\s+d1\s+(migrations\s+apply|execute)\b/i.test(bare) && /--remote\b/i.test(bare))
  if (isMigration && !/--local\b/i.test(bare) && !LOCAL_DB.test(segment)) return 'migrate'
  if (/^vercel\s+env\s+(add|rm|remove|update)\b/i.test(bare) || /^wrangler\s+(pages\s+)?secret\s+(put|delete|bulk)\b/i.test(bare) || /^gh\s+(secret|variable)\s+(set|delete|remove)\b/i.test(bare)) return 'env-secret'
  if (/^gh\s+api\b/i.test(bare) && WRITE.test(bare) && /\/(actions|dependabot|codespaces|environments\/[^/\s]+)\/(secrets|variables)\b/i.test(bare)) return 'env-secret'
  if (/^(npm|pnpm|yarn|bun)\s+(npm\s+)?publish\b/i.test(bare) && !/--dry-run\b/i.test(bare)) return 'publish'
  if (/^(terraform|tofu)\s+(apply|destroy)\b/i.test(bare) || /^pulumi\s+(up|destroy)\b/i.test(bare)) return 'infra-apply'
  // A merge spelled through the GraphQL API is still a merge.
  if (/^gh\s+api\s+graphql\b.*\bmergePullRequest\b/i.test(bare) || /^gh\s+api\b.*\/merges\b/i.test(bare) && WRITE.test(bare)) return 'merge'
  return null
}

/**
 * A segment the window holds beyond merges and pushes to main; `npm run <script>` is read through package.json.
 * @param {string} segment @param {readonly string[]} held @param {import('./index.mjs').HeldContext} context @param {number} [depth]
 * @returns {string | null}
 */
export const heldSegment = (segment, held, context, depth = 0) => {
  const kind = heldKindOf(segment)
  if (kind && held.includes(kind)) return kind
  const script = scriptOf(bareCommand(segment))
  const body = script ? context.scripts?.[script] : undefined
  if (body !== undefined && depth < 2) {
    for (const part of segments(body)) {
      const inner = heldSegment(part, held, context, depth + 1)
      if (inner) return inner
    }
  }
  return null
}

// ---------------------------------------------------------------- known traps

export const WEB_TRAPS = [
  { id: 'web-port-in-use', pattern: /\bEADDRINUSE\b|address already in use|Port \d+ is (already )?in use/i, title: 'A dev server port is already in use (EADDRINUSE)', fix: 'Another server holds the port. Give each worktree its own port from the profile (base + 10 per worktree), or stop the old server: Get-NetTCPConnection -LocalPort <port> on Windows, lsof -i :<port> elsewhere.' },
  { id: 'web-posix-env', pattern: /'[A-Z][A-Z0-9]*_[A-Z0-9_]*(=[^']*)?' is not recognized as an internal or external command|The term '[A-Z][A-Z0-9]*_[A-Z0-9_]*=\S*' is not recognized/, title: 'POSIX env syntax in an npm script on Windows', fix: 'npm runs scripts with cmd.exe on Windows, which does not take FOO=bar cmd. Move the variable into a small Node launcher (process.env) or cross-env; for a one-off run set npm_config_script_shell to Git Bash.' },
  { id: 'web-hydration', pattern: /Hydration failed|hydration mismatch|Text content does not match server-rendered HTML|did not match\. Server:|error while hydrating/i, title: 'Hydration mismatch between server and client HTML', fix: 'The server and the browser rendered different HTML: move Date.now(), Math.random(), locale formatting and window or localStorage reads into useEffect, and use suppressHydrationWarning only where the difference is intended.' },
  { id: 'web-stale-cache', pattern: /Cannot find module '\.\/(chunks|vendor-chunks)\/|ENOENT: no such file or directory, open '[^']*\.next[\\/]|Outdated Optimize Dep|node_modules[\\/]\.vite[\\/]deps|Failed to fetch dynamically imported module/i, title: 'Stale .next or Vite cache', fix: 'Stop the dev server, delete .next (Next) or node_modules/.vite (Vite, vinext), then start again. Never commit either folder.' },
  { id: 'web-lockfile-drift', pattern: /can only install packages when your package\.json and package-lock\.json|ERR_PNPM_OUTDATED_LOCKFILE|Your lockfile needs to be updated|Found multiple lockfiles|multiple lockfiles/i, title: 'Lockfile out of step with package.json, or two package managers', fix: 'Use the package manager the profile names: run its install once, commit the lockfile with the package.json change, and delete any other lockfile (yarn.lock, pnpm-lock.yaml, package-lock.json).' },
  { id: 'web-node-version', pattern: /\bEBADENGINE\b|Unsupported engine|The engine "node" is incompatible|requires Node(\.js)? (version )?[>=^~]/i, title: 'Node version does not match engines or .nvmrc', fix: 'Switch to the Node version package.json engines or .nvmrc asks for (nvm, fnm or volta), then reinstall dependencies.' },
  { id: 'web-next-public-env', pattern: /NEXT_PUBLIC_[A-Z0-9_]+[^\n]{0,40}\b(is not defined|is undefined|is missing|not set|is required)|(Missing|Invalid) environment variables?[^\n]{0,80}NEXT_PUBLIC_/i, title: 'A NEXT_PUBLIC_* variable is missing', fix: 'NEXT_PUBLIC_* values are inlined at build time: add it to .env.local for local runs and to the Vercel project environment for previews and production, then rebuild. Never commit the value.' },
  { id: 'web-playwright-browsers', pattern: /Executable doesn't exist at [^\n]*ms-playwright|Please run the following command to download new browsers|Looks like Playwright Test or Playwright was just installed or updated/i, title: 'Playwright browsers are not installed', fix: 'Install once with npx playwright install chromium, or point PLAYWRIGHT_BROWSERS_PATH at an existing install. Never add a postinstall that downloads browsers: it would run on Vercel too.' },
  { id: 'web-next-lock', pattern: /Unable to acquire lock at [^\n]*\.next[\\/]lock|Another next build process is already running/i, title: 'Another next build holds .next', fix: 'Another next build or next dev runs in this checkout: wait for it, or build in its own worktree.' },
]

// ---------------------------------------------------------------- Create

// Skills Claude Code has everywhere: offered whether or not the repository has a skills folder.
const CREATE_GROUPS = [
  { group: 'Build and look', items: [{ name: 'frontend-design', verb: 'Design or restyle a page or component', isGlobal: true }] },
  { group: 'See it running', items: [{ name: 'run', verb: 'Run the app and see the change working', isGlobal: true }] },
  { group: 'Review before it ships', items: [
    { name: 'code-review', verb: 'Review the current change for bugs', isGlobal: true },
    { name: 'security-review', verb: 'Review the change for security issues', isGlobal: true },
    { name: 'simplify', verb: 'Clean up the changed code', isGlobal: true },
  ] },
]
const CREATE_ORDER = {
  engineer: ['Build and look', 'Review before it ships', 'See it running'],
  designer: ['Build and look', 'See it running', 'Review before it ships'],
  product: ['See it running', 'Build and look', 'Review before it ships'],
}

// ---------------------------------------------------------------- the profile

/**
 * The profile's gates: [{ command, proofs: [...] }] (han-viet), or { name: { command, proofs | proof } }.
 * @param {any} profile @returns {Gate[]}
 */
export const gatesOf = profile => {
  const raw = profile?.gates
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.entries(raw).map(([id, gate]) => ({ id, ...(typeof gate === 'string' ? { command: gate } : gate) })) : []
  return list
    .filter(gate => gate && typeof gate.command === 'string' && gate.command.trim() !== '')
    .map(gate => {
      const proofs = [gate.proofs, gate.proof, gate.kind, gate.rungs].flat().filter(one => typeof one === 'string').map(one => ALIASES[one.toLowerCase()] ?? '').filter(Boolean)
      return { id: typeof gate.id === 'string' ? gate.id : '', command: gate.command.trim(), proofs: [...new Set(proofs)], proves: typeof gate.proves === 'string' ? gate.proves : '' }
    })
}

/** @param {any} profile @returns {Production | null} */
export const productionOf = profile => {
  const raw = profile?.production
  if (!raw || typeof raw !== 'object') return null
  const url = typeof raw.probe?.url === 'string' ? raw.probe.url : typeof raw.url === 'string' ? raw.url : ''
  return { host: String(raw.host ?? ''), branch: String(raw.branch ?? 'main'), deployment: typeof raw.deployment === 'string' ? raw.deployment : '', url, expectStatus: Number(raw.probe?.expectStatus ?? raw.expectStatus ?? 200) || 200 }
}

/**
 * The web pack for one repository, from its profile (or none) and its package.json.
 * @param {any} profile @param {any} packageJson @returns {Pack}
 */
export const makeWebPack = (profile, packageJson) => {
  const gates = gatesOf(profile)
  const production = productionOf(profile)
  /** @type {Record<string, string>} */
  const scripts = packageJson?.scripts && typeof packageJson.scripts === 'object' ? Object.fromEntries(Object.entries(packageJson.scripts).filter(([, body]) => typeof body === 'string')) : {}
  const declared = new Set(gates.flatMap(gate => gate.proofs))
  // Without a profile, the usual scripts stand in for gates.
  if (gates.length === 0) {
    for (const [name, rung] of /** @type {const} */ ([['test', 'tests'], ['lint', 'lint'], ['typecheck', 'lint'], ['build', 'build']])) if (scripts[name] !== undefined) declared.add(rung)
  }
  if (production) declared.add('prod')
  const mergePolicy = String(profile?.mergePolicy ?? profile?.merge ?? '').toLowerCase() === 'with-proof' ? 'with-proof' : 'hold'
  const merging = [...declared].filter(rung => rung !== 'prod')
  const required = Array.isArray(profile?.required) ? profile.required.map((/** @type {string} */ one) => ALIASES[String(one).toLowerCase()] ?? '').filter(Boolean) : merging
  /** @type {Record<string, string[]>} */
  const wants = { engineer: ['tests', 'lint', 'build'], designer: ['ui'], product: ['build', 'ui'] }
  /** @param {string} role */
  const requiredRungs = role => {
    const want = (wants[role] ?? wants.engineer ?? []).filter(rung => declared.has(rung))
    return want.length > 0 ? want : declared.has('build') ? ['build'] : ['tests', 'build']
  }
  // The command that proves a rung: the profile's gate, else the npm script.
  /** @param {string} rung */
  const gateFor = rung => gates.find(gate => gate.proofs[0] === rung)?.command ?? gates.find(gate => gate.proofs.includes(rung))?.command ??(rung === 'tests' && scripts.test ? 'npm test' : rung === 'lint' && scripts.lint ? 'npm run lint' : rung === 'build' && scripts.build ? 'npm run build' : '')
  /** @param {readonly string[]} rungs */
  const commandsFor = rungs => [...new Set(rungs.map(gateFor).filter(Boolean))].map(command => `\`${command}\``)
  const prodCheck = production ? `the production check (${production.host ? `${production.host[0]?.toUpperCase()}${production.host.slice(1)} ` : ''}deployment for the merge commit READY${production.url ? `, then ${production.url} answers ${production.expectStatus}` : ''})` : ''
  const mergeGates = andList(commandsFor(required))
  const port = Number(profile?.devPorts?.base ?? profile?.devPortBase ?? 0)

  /** @param {string} command @param {string} text @param {{ isError?: boolean }} ran */
  const readShell = (command, text, ran) => {
    /** @type {import('./index.mjs').ShellReading} */
    const out = { rungs: [], context: [], toasts: [], bumps: [] }
    const rungs = rungsOfCommand(command, scripts, gates, production)
    for (const rung of rungs) {
      const value = readToolOutput(rung, command, text, ran, production)
      if (value) out.rungs.push({ rung, value })
    }
    if (rungs.length > 0 && isPiped(command) && out.rungs.some(one => one.value.state === 'none')) {
      out.context.push('Ather Automata: this check was piped through a filter, so its exit code is the filter\'s. Read the pass and fail counts (or run it unpiped) before claiming it passed.')
    }
    return out
  }

  const areas = Array.isArray(profile?.areas) && profile.areas.every((/** @type {unknown} */ one) => typeof one === 'string') ? profile.areas : DEFAULT_AREAS
  const flags = 'keep behaviour changes behind a flag that defaults to the current behaviour'
  const withProof = mergePolicy === 'with-proof'
  return {
    id: 'web',
    roles: ROLES,
    roleLabels: ROLE_LABELS,
    roleDescriptions: {
      engineer: `${andList(commandsFor(requiredRungs('engineer'))) || 'Tests and a build'} passing.`,
      designer: `${andList(commandsFor(requiredRungs('designer'))) || 'The browser check'} passing.`,
      product: `${andList(commandsFor(requiredRungs('product'))) || 'A build'} passing${production ? ', then production' : ''}.`,
    },
    roleWords: 'engineer, designer or product',
    roleHelp: 'Which role? /ather role engineer, /ather role designer or /ather role product.',
    roleFallback: 'Tour skipped. Say your role any time with /ather role engineer, designer or product.',
    roleKey: 'web:',
    parseRole,
    owners: 'the repository owner',
    areas,
    normalizeArea: text => areas.find((/** @type {string} */ area) => area.toLowerCase() === text.trim().toLowerCase()) ?? 'Unsorted',
    rungLabels: RUNG_LABELS,
    proofWords: PROOF_WORDS,
    emptyEvidence: () => Object.fromEntries(RUNGS.map(rung => [rung, { state: 'none', detail: '' }])),
    requiredRungs,
    isProven: (evidence, role) => requiredRungs(role || 'engineer').every(rung => evidence[rung]?.state === 'pass'),
    anyProofText: andList(requiredRungs('engineer').map(rung => RUNG_LABELS[/** @type {keyof typeof RUNG_LABELS} */ (rung)] ?? rung)),
    localDir: '.ather/local',
    debriefPath: slug => `docs/intent/${slug}/debrief.md`,
    lockFile: null,
    parseLock: () => ({ state: 'unknown', holder: '', until: '', isStale: false, raw: '', session: '' }),
    lockRoles: [],
    ownCheck: null,
    traps: WEB_TRAPS,
    held: { labels: HELD_LABELS, nouns: HELD_NOUNS, kinds: WEB_HELD, defaults: ['merge', 'push-main', ...WEB_HELD] },
    heldSegment,
    mergePolicy,
    mergeRungs: required,
    isAssetSave: () => false,
    readShell,
    mcpKind: () => null,
    binaryAssets: null,
    briefPaths: /[A-Za-z]:[\\/]|\b(app|src|pages|components|lib|tests?|scripts|public|docs|data|schemas|worker)\/|\.(js|mjs|cjs|ts|tsx|jsx|css|json|md|html|sql)\b/,
    skillGroups: [],
    createGroups: CREATE_GROUPS,
    createOrder: CREATE_ORDER,
    createTitle: 'Make or check it',
    createMeta: () => `The session asks what you want first${port ? `, works in its own worktree on a dev port from ${port}` : ''} and proves it with ${andList(commandsFor(requiredRungs('engineer'))) || 'the repository checks'}.`,
    createPrompt: (verb, name) =>
      /review|simplify/.test(name)
        ? `Run the ${name} skill on the current work: read it, tell me in two lines what it will do here, then follow it, and report what it found before changing anything.`
        : `I want to ${verb.charAt(0).toLowerCase()}${verb.slice(1)}. Use the ${name} skill. First ask me what I want, one question at a time and at most three. Then record it as an intent with the intent skill (.agents/skills/intent/SKILL.md), do it in its own worktree, prove it with ${andList(commandsFor(requiredRungs('designer').concat(requiredRungs('engineer')))) || 'the repository checks'}, and show me the result.`,
    prompts: {
      brief: (role, slug) =>
        `Dispatch a background Opus worker for intent ${slug} using .agents/skills/intent/assets/worker-brief.md: exact paths, the acceptance checks it must prove with ${andList(commandsFor(requiredRungs(role))) || 'the repository checks'}, its own worktree (git worktree add)${port ? ` and dev port (from ${port}, 10 per worktree)` : ''}, no commits in the main checkout.`,
      prove: (role, slug) =>
        `Prove intent ${slug}: run ${andList(commandsFor(requiredRungs(role))) || 'the build and the tests'} and report each command's own exit code and its pass and fail counts${requiredRungs(role).includes('ui') ? ', and the screens the browser check covered' : ''}. Ather reads the result from tool output.`,
      ship: (role, slug) =>
        role === 'product'
          ? `Summarise intent ${slug} for landing: what changed, the gate that proved each checklist item, and what is still owed${prodCheck ? `; after it merges, run ${prodCheck}` : ''}.`
          : withProof
            ? `Land intent ${slug}: open the PR from its branch, confirm ${mergeGates || 'every gate'} passed on its head in this session, then merge it (merge policy with-proof)${prodCheck ? ` and run ${prodCheck}` : ''}. If any gate has not passed, stop and tell me.`
            : `Prepare intent ${slug} for landing: open the PR from its branch with the evidence for each checklist item, then wait for my go before merging.`,
      shipHint: role => (role === 'product' ? 'Summarises the work and checks production once it lands.' : withProof ? `Merges once ${mergeGates || 'every gate'} passed; then checks production.` : 'A clean PR; nothing merges without your go.'),
      briefHint: 'A background agent does the work in its own worktree, proved with the repository gates.',
      tour: 'Give me the Ather tour for this repository: read AGENTS.md, .ather/profile.json and .agents/skills/intent/SKILL.md, then explain in six short steps how a feature runs here as an intent (Plan, Build, Prove with the gates the profile names, Ship), ending with my first intent started.',
      tourToast: 'Ather: new here? Type /ather tour for a six-step tour of how this repository works with Claude Code.',
      ask: question => `I asked Ather: "${question}" Answer briefly in plain words. Ather is a Claude Code mod: /ather shows what needs me and the next step, /ather tour walks a newcomer through the workflow, /away hands over while I am away. The repository's gates are in .ather/profile.json. If the question is about my work instead, answer from this checkout.`,
    },
    mandate: {
      flags,
      allowed: withProof ? `push branches, open PRs, merge PRs to main once ${mergeGates || 'every gate'} passed` : 'push branches, open draft PRs, open PRs to main',
      merge: withProof ? 'merge only when every gate the profile requires has passed in this session' : 'never merge',
      away: withProof ? 'The session may push branches, open PRs and merge with every gate passed; production deploys, migrations and secrets wait for you.' : 'The session may push branches and open PRs; nothing merges until you are back.',
      pane: 'The session keeps working; production deploys, migrations and secret changes wait for your review.',
    },
    statusWhat: 'this web repository session',
    notHere: 'Ather Automata works in repositories with intents (a docs/intent folder); none here.',
    gates,
    production,
    scripts,
  }
}
