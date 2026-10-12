// The decision desk's page in a real browser (intent decision-desk, A2). Playwright drives the page that
// `desk.mjs collect` writes, wrapped as the Artifact host wraps it, with a stand-in for the viewer's
// `window.claude` (db, user, sample) that keeps answers in memory the way the page's db would.
//   node dev/e2e/desk.mjs                       the checks
//   node dev/e2e/desk.mjs --shots <dir> [--desk <desk.json>]
//                                               also screenshots of each state at 390 and 1280 px, from a
//                                               real desk.json when one is named
// Needs Playwright (a global install is found too); without it, it says so and exits 0.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { pageWith } from '../../ather-automata/desk/desk.mjs'

const loadPlaywright = async () => {
  try {
    return await import('playwright')
  } catch {
    try {
      const root = execSync('npm root -g', { encoding: 'utf8' }).trim()
      return await import(pathToFileURL(path.join(root, 'playwright/index.mjs')).href)
    } catch {
      return null
    }
  }
}

const argOf = name => (process.argv.includes(name) ? path.resolve(process.argv[process.argv.indexOf(name) + 1]) : null)
const SHOTS = argOf('--shots')

// A desk of four calls in two repositories: a blocking one with no options, two with options (one
// recommended), and one whose finding tries to inject markup.
const FIXTURE = {
  version: 1,
  at: Date.UTC(2026, 9, 12, 9, 30),
  repos: [
    { name: 'storey', url: 'https://github.com/AskTinNguyen/storey', base: 'main', sha: 'def6eff0123456', intents: 39, waiting: 3 },
    { name: 'ather-mods', url: 'https://github.com/AskTinNguyen/ather-mods', base: 'main', sha: '546cfc0abcdef1', intents: 2, waiting: 1 },
  ],
  items: [
    { id: 'storey/landing-redesign/F1', repo: 'storey', slug: 'landing-redesign', intent: 'Landing redesign', owner: 'Tin Nguyen', updatedAt: 3, finding: 'F1', question: "The build gate's second half cannot be read for PR #49's head.", isBlocking: true, options: [], source: '## F1 | blocking: yes | status: open\n\nThe build gate cannot be read.', link: 'https://github.com/AskTinNguyen/storey/blob/main/docs/intent/landing-redesign/findings.md' },
    { id: 'storey/payment-certificate/F-1', repo: 'storey', slug: 'payment-certificate', intent: 'Payment certificate', owner: 'Tin Nguyen', updatedAt: 2, finding: 'F-1', question: 'Retention rate and release.', isBlocking: false, options: [{ letter: 'A', label: 'Five per cent of the gross to date', text: 'Five per cent of the gross to date, half released at handover.', isRecommended: true }, { letter: 'B', label: 'Ten per cent', text: 'Ten per cent, all released after the defects period.', isRecommended: false }], source: '## F-1 (2026-10-10) | blocking: no | status: open (director)\n\nRetention rate and release.\n\n**Options:**\n- A (recommended): five per cent …\n- B: ten per cent …', link: 'https://github.com/AskTinNguyen/storey/blob/main/docs/intent/payment-certificate/findings.md' },
    { id: 'storey/tender-rules-signed/F-1', repo: 'storey', slug: 'tender-rules-signed', intent: 'Tender rules signed', owner: 'Tin Nguyen', updatedAt: 1, finding: 'F-1', question: 'The dossier says when a tender is late but not what happens to a re-submission. <img src=x onerror="window.__xss=1">', isBlocking: false, options: [{ letter: 'A', label: 'The late re-submission is refused', text: 'The late re-submission is refused; the on-time bid stands.', isRecommended: false }, { letter: 'B', label: 'It replaces the on-time bid', text: 'It replaces the on-time bid.', isRecommended: true }], source: '<script>window.__xss=1</script>', link: '' },
    { id: 'ather-mods/decision-desk/F-1', repo: 'ather-mods', slug: 'decision-desk', intent: 'Ather Automata: the decision desk', owner: 'Tin Nguyen', updatedAt: 1, finding: 'F-1', question: "Read Storey's hand-written Waiting on a person rows too?", isBlocking: false, options: [{ letter: 'A', label: 'Only findings', text: 'Only findings.', isRecommended: true }, { letter: 'B', label: 'Findings and registers', text: 'Findings and registers.', isRecommended: false }], source: '## F-1', link: '' },
  ],
}

// The viewer's `window.claude`, in memory. `config`: { claude: false } for no viewer at all,
// { canEdit, sample, answers } otherwise. Writes land in window.__writes for the checks to read.
const stub = config => {
  window.__writes = []
  if (config.claude === false) return
  const docs = new Map((config.answers || []).map(doc => [doc.id.replace(/\//g, '~'), doc]))
  const listeners = new Set()
  const snapshot = () => ({ docs: [...docs.values()].map(doc => ({ id: doc.id, exists: true, data: () => ({ ...doc }) })) })
  const db = {
    collection: name => ({
      doc: id => ({
        set: async data => {
          if (config.failWrites) throw { code: 'unavailable', message: 'offline' }
          window.__writes.push({ path: `${name}/${id}`, data })
          docs.set(id, data)
          setTimeout(() => listeners.forEach(fn => fn(snapshot())), 20)
        },
      }),
      onSnapshot: next => {
        listeners.add(next)
        setTimeout(() => next(snapshot()), 10)
        return () => listeners.delete(next)
      },
    }),
  }
  const user = { id: async () => 'user-owner', canEdit: async () => config.canEdit !== false, isOwner: async () => config.canEdit !== false }
  const sample = async (input, options = {}) => {
    window.__sampleInput = input
    const words = ['This', ' call', ' sets', ' how', ' much', ' of', ' each', ' payment', ' is', ' held', ' back.']
    let text = ''
    for (const word of words) {
      text += word
      options.onText?.({ text, delta: word })
      await new Promise(resolve => setTimeout(resolve, 15))
    }
    return { text, truncated: false, modelTierApplied: 'default' }
  }
  window.claude = { use: async name => (name === 'db' ? db : name === 'user' ? user : name === 'sample' && config.sample !== false ? sample : null) }
}

const skeleton = desk => `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${pageWith(desk)}</body></html>`

const playwright = await loadPlaywright()
if (!playwright) {
  console.log('skipped: the desk page checks need Playwright (npm i -g playwright)')
  process.exit(0)
}

const browser = await playwright.chromium.launch()
let failures = 0
let passes = 0
const check = (name, ok, detail = '') => {
  if (ok) passes += 1
  else failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} desk page > ${name}${ok || !detail ? '' : `\n      ${detail}`}`)
}

// Google Fonts through Node (which knows the proxy) when they can be reached; else the fallback stacks.
const fonts = async route => {
  try {
    const response = await fetch(route.request().url(), { headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36' } })
    await route.fulfill({ status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? 'text/css', 'access-control-allow-origin': '*' }, body: Buffer.from(await response.arrayBuffer()) })
  } catch {
    await route.abort()
  }
}

const open = async (config = {}, { width = 390, height = 844, desk = FIXTURE } = {}) => {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: SHOTS ? 2 : 1 })
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  // The checks need no fonts; the screenshots do.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, SHOTS ? fonts : route => route.abort())
  await page.addInitScript(stub, config)
  // Served from an address of its own: init scripts run on a navigation, not on setContent.
  await page.route('https://desk.test/', route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: skeleton(desk) }))
  await page.goto('https://desk.test/', { waitUntil: 'load' })
  await page.waitForFunction(() => document.querySelector('#register li, #register .empty'))
  await page.waitForTimeout(60)
  return { page, errors }
}
const shot = async (page, name) => {
  if (!SHOTS) return
  fs.mkdirSync(SHOTS, { recursive: true })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true })
}
const item = (page, id) => page.locator(`li.item[data-id="${id}"]`)
const writes = page => page.evaluate(() => window.__writes)

// ---------------------------------------------------------------- waiting
{
  const { page, errors } = await open()
  check('the title counts what waits', (await page.locator('h1').textContent()) === '4 calls wait on you')
  check('a blocking call is stamped and drawn first', (await page.locator('li.item').first().getAttribute('data-id')) === 'storey/landing-redesign/F1' && (await item(page, 'storey/landing-redesign/F1').locator('.stamp.stop').textContent()) === 'Blocking')
  const pay = item(page, 'storey/payment-certificate/F-1')
  check('options are buttons, the recommended one marked', (await pay.locator('button.option').count()) === 2 && (await pay.locator('button.option.rec').getAttribute('data-letter')) === 'A' && (await pay.locator('button.option.rec').textContent()).includes('Recommended'))
  check('a call with no options offers an answer in words', (await item(page, 'storey/landing-redesign/F1').getByRole('button', { name: 'Answer', exact: true }).count()) === 1)
  check('Explain is offered where Claude can be asked', (await pay.getByRole('button', { name: 'Explain' }).count()) === 1)
  check('a finding links to its file on GitHub', (await pay.getByRole('link', { name: 'Open on GitHub ↗' }).getAttribute('href')) === FIXTURE.items[1].link)
  check("a finding's text is drawn as text, never as markup", (await page.evaluate(() => window.__xss)) === undefined && (await item(page, 'storey/tender-rules-signed/F-1').locator('.question').textContent()).includes('<img src=x'))
  check('the phone width never scrolls sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  check('the repository filter narrows the list', await (async () => {
    await page.getByRole('button', { name: 'ather-mods · 1' }).click()
    const ids = await page.locator('li.item').evaluateAll(nodes => nodes.map(node => node.dataset.id))
    await page.getByRole('button', { name: 'Every repository' }).click()
    return ids.length === 1 && ids[0] === 'ather-mods/decision-desk/F-1'
  })())
  await shot(page, 'fixture-waiting-390')

  // ---------------------------------------------------------------- answering
  await pay.locator('button.option[data-letter="B"]').click()
  await page.waitForTimeout(80)
  let written = await writes(page)
  check('an option keeps the answer, keyed by repository, intent and finding', written.length === 1 && written[0].path === 'answers/storey~payment-certificate~F-1' && written[0].data.choice === 'B' && written[0].data.state === 'answered' && written[0].data.by === 'user-owner' && written[0].data.label === 'Ten per cent')
  check('an answered call leaves To decide, and the counts follow', (await item(page, 'storey/payment-certificate/F-1').count()) === 0 && (await page.locator('[data-count="answered"]').textContent()) === '1' && (await page.locator('h1').textContent()) === '3 calls wait on you')
  await page.getByRole('button', { name: 'Answered', exact: true }).click()
  const answered = item(page, 'storey/payment-certificate/F-1')
  check('Answered shows the answer, with Change answer and Withdraw', (await answered.locator('.answered .what').textContent()) === 'B: Ten per cent' && (await answered.getByRole('button', { name: 'Change answer' }).count()) === 1 && (await answered.getByRole('button', { name: 'Withdraw' }).count()) === 1)
  await shot(page, 'fixture-answered-390')
  await answered.getByRole('button', { name: 'Change answer' }).click()
  await item(page, 'storey/payment-certificate/F-1').locator('button.option[data-letter="A"]').click()
  await page.waitForTimeout(80)
  written = await writes(page)
  check('a changed answer overwrites the same document', written.length === 2 && written[1].path === written[0].path && written[1].data.choice === 'A')
  await item(page, 'storey/payment-certificate/F-1').getByRole('button', { name: 'Withdraw' }).click()
  await page.waitForTimeout(80)
  written = await writes(page)
  await page.getByRole('button', { name: 'To decide' }).click()
  check('a withdrawn answer puts the call back in To decide', written.at(-1).data.state === 'withdrawn' && (await item(page, 'storey/payment-certificate/F-1').locator('button.option').count()) === 2)

  // ---------------------------------------------------------------- in my words
  const blocking = item(page, 'storey/landing-redesign/F1')
  await blocking.getByRole('button', { name: 'Answer', exact: true }).click()
  await page.locator('textarea').fill('Read it from the Vercel dashboard tomorrow;\n  keep the row open until then.')
  await shot(page, 'fixture-typing-390')
  await page.getByRole('button', { name: 'Save my answer' }).click()
  await page.waitForTimeout(80)
  written = await writes(page)
  check('typed words are kept as the answer, with no letter', written.at(-1).data.words === 'Read it from the Vercel dashboard tomorrow;\n  keep the row open until then.' && written.at(-1).data.choice === '')

  // ---------------------------------------------------------------- Explain
  const tender = item(page, 'storey/tender-rules-signed/F-1')
  await tender.getByRole('button', { name: 'Explain' }).click()
  await page.waitForFunction(() => document.querySelector('li.item[data-id="storey/tender-rules-signed/F-1"] .explain')?.textContent.includes('it does not decide'))
  const input = await page.evaluate(() => window.__sampleInput)
  check('Explain streams Claude’s words into the call, sent the finding as written and told not to decide', input.includes('Do not choose for the owner') && input.includes('<script>window.__xss=1</script>') && (await tender.locator('.explain .label').textContent()) === 'Explained by Claude · it does not decide')
  await shot(page, 'fixture-explain-390')
  check('no page errors while answering', errors.length === 0, errors.join('; '))
  await page.close()
}

// ---------------------------------------------------------------- recorded and settled
{
  const answers = [
    { id: 'storey/payment-certificate/F-1', repo: 'storey', slug: 'payment-certificate', finding: 'F-1', intent: 'Payment certificate', question: 'Retention rate and release.', choice: 'A', label: 'Five per cent of the gross to date', words: '', state: 'recorded', at: Date.now() - 3600000, by: 'user-owner', pr: 'https://github.com/AskTinNguyen/storey/pull/52' },
    { id: 'storey/approver-identity/F-2', repo: 'storey', slug: 'approver-identity', finding: 'F-2', intent: 'Approver identity', question: 'Who the owner is.', choice: 'A', label: "The artifact's owner", words: '', state: 'recorded', at: Date.now() - 7200000, by: 'user-owner', pr: 'https://github.com/AskTinNguyen/storey/pull/51' },
  ]
  const { page, errors } = await open({ answers })
  await page.getByRole('button', { name: 'All', exact: true }).click()
  const recorded = item(page, 'storey/payment-certificate/F-1')
  check('a recorded answer shows its pull request and can no longer be changed', (await recorded.locator('.stamp.ok').textContent()) === 'Recorded' && (await recorded.getByRole('link', { name: 'In pull request #52 ↗' }).getAttribute('href')) === answers[0].pr && (await recorded.getByRole('button', { name: 'Change answer' }).count()) === 0)
  const settled = page.locator('li.item[data-state="settled"]')
  check('an answer whose finding the base reads closed is listed as settled', (await settled.count()) === 1 && (await settled.getAttribute('data-id')) === 'storey/approver-identity/F-2' && (await settled.locator('.what').textContent()) === "A: The artifact's owner")
  await shot(page, 'fixture-all-390')
  check('no page errors with recorded answers', errors.length === 0, errors.join('; '))
  await page.close()
}

// ---------------------------------------------------------------- views that cannot answer
{
  const { page } = await open({ canEdit: false })
  check('a viewer who cannot write reads the desk with the options disabled and is told why', (await page.locator('#notice').textContent()) === 'You can read this desk. Only its owner and editors answer.' && (await page.locator('button.option[disabled]').count()) === 6 && (await page.getByRole('button', { name: 'Answer in my words' }).count()) === 0)
  await page.close()
}
{
  const { page, errors } = await open({ claude: false })
  await page.waitForFunction(() => !document.getElementById('notice').hidden)
  check('with no viewer behind it the page still draws every call and says answers cannot be kept', (await page.locator('li.item').count()) === 4 && (await page.locator('#notice').textContent()).startsWith('Answers cannot be kept in this view') && (await page.getByRole('button', { name: 'Explain' }).count()) === 0)
  check('no page errors without a viewer', errors.length === 0, errors.join('; '))
  await page.close()
}
{
  const { page } = await open({ failWrites: true })
  await item(page, 'storey/payment-certificate/F-1').locator('button.option[data-letter="A"]').click()
  await page.waitForTimeout(80)
  check('a write that fails puts the call back and says so', (await item(page, 'storey/payment-certificate/F-1').locator('button.option').count()) === 2 && (await page.locator('#toast').textContent()).startsWith('Not saved: offline'))
  await page.close()
}
{
  const { page } = await open({}, { desk: { version: 1, at: FIXTURE.at, repos: FIXTURE.repos.map(repo => ({ ...repo, waiting: 0 })), items: [] } })
  check('an empty desk says nothing waits', (await page.locator('h1').textContent()) === 'Nothing waits on you' && (await page.locator('.empty strong').textContent()) === 'Nothing waits on you here.')
  await page.close()
}

// ---------------------------------------------------------------- the real desk, for the eye
if (SHOTS) {
  const real = argOf('--desk')
  const desk = real ? JSON.parse(fs.readFileSync(real, 'utf8')) : FIXTURE
  for (const [width, height] of [[390, 844], [1280, 900]]) {
    const { page } = await open({}, { width, height, desk })
    check(`the ${real ? 'real' : 'fixture'} desk at ${width} px never scrolls sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: path.join(SHOTS, `desk-${width}.png`), fullPage: false })
    await page.screenshot({ path: path.join(SHOTS, `desk-${width}-full.png`), fullPage: true })
    await page.close()
  }
}

await browser.close()
console.log(`${passes}/${passes + failures} passed`)
process.exitCode = failures ? 1 : 0
