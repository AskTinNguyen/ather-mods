// A109 (rev 36): the real cmd half of the build script's proof. The test runner has no file system and no processes, so
// this runs with node (tests/rev36.test.ts checks the script's text and A5R's notices). Run from the repository root:
//   node --experimental-strip-types a5r/tests/build-script-smoke.mjs
// In a temp folder whose path holds a space and an `&`, a stand-in Build.bat echoes its arguments and `Result: Succeeded`;
// the sync's script A5R writes (rev 37, A110: the engine root A5R found written in) is started through PowerShell exactly as
// the worker's task gives the command, and the log must show Build.bat's arguments, the Result line and the script's exit
// line. Also: a root without Build.bat (one refusal line).
// Exit 0: every case as expected (or not on Windows: skipped, said); else each failure is printed, exit 1.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildScriptText, buildStartCommand, SCRIPT_END, syncBuildScript } from '../hooks/buildscript.ts'
import { readBuildLog, syncBuildLog } from '../hooks/syncstage.ts'

if (process.platform !== 'win32') {
  console.log('skipped: the build script runs only on Windows')
  process.exit(0)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a5r smoke '))
const engine = path.join(tmp, 'eng a&b')
const checkout = path.join(tmp, 'chk o&k')
const failures = []
const expect = (what, ok) => ok || failures.push(what)
const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Writes the sync's script with the engine root, runs its start command through PowerShell as given, and returns the log
 * once the script's exit or refusal line is in (at most 30 s). */
const run = async (id, root) => {
  const log = syncBuildLog(checkout, id)
  const script = syncBuildScript(checkout, id)
  fs.writeFileSync(script, buildScriptText(checkout, 'S2.uproject', log, root))
  const given = buildStartCommand(script)
  // -EncodedCommand: the command reaches PowerShell byte for byte, as the worker types it.
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(given, 'utf16le').toString('base64')], { stdio: 'pipe', timeout: 30_000 }) // its stderr (PowerShell's progress records) only shows when it fails
  for (let k = 0; k < 150; k += 1) {
    const text = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''
    if (SCRIPT_END.test(text)) return text
    await sleep(200)
  }
  return `(no exit line in ${log} within 30 s)`
}

try {
  fs.mkdirSync(path.join(engine, 'Engine', 'Build', 'BatchFiles'), { recursive: true })
  fs.mkdirSync(path.join(checkout, 'Saved', 'A5R'), { recursive: true })
  fs.writeFileSync(path.join(engine, 'Engine', 'Build', 'BatchFiles', 'Build.bat'), '@echo off\r\necho stand-in Build.bat args: %*\r\necho Result: Succeeded\r\nexit /b 0\r\n')
  const args = `stand-in Build.bat args: S2Editor Win64 Development -Project="${checkout}\\S2.uproject" -WaitMutex`
  const built = await run('s-root', engine)
  expect(`Build.bat's args: ${built}`, built.includes(args))
  expect(`Result line: ${built}`, built.includes('Result: Succeeded') && readBuildLog(built, 1).log === 'Succeeded')
  expect(`exit line: ${built}`, built.includes(`A5R build exit 0 (engine "${engine}")`))
  const fwd = await run('s-fwd', `${engine.split(path.sep).join('/')}/`) // a root as A5R finds it in a log: forward slashes, a trailing one
  expect(`a forward-slash root: ${fwd}`, fwd.includes(args) && fwd.includes(`A5R build exit 0 (engine "${engine}")`))
  const wrong = path.join(tmp, 'UE_5.8')
  const noBat = await run('s-wrong', wrong)
  expect(`a root without Build.bat: ${noBat}`, noBat.includes(`A5R build refused: "${wrong}\\Engine\\Build\\BatchFiles\\Build.bat" does not exist`) && readBuildLog(noBat, 1).log === 'ended')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log(`build script smoke: ${failures.length ? `${failures.length} failed checks` : 'the engine root written in (a Windows and a forward-slash form) and a root without Build.bat all as expected'} (paths with a space and &)`)
for (const f of failures) console.log(`FAIL ${f}`)
process.exit(failures.length ? 1 : 0)
