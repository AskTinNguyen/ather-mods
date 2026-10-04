// Type-check, then run the unit tests and the end-to-end harness against ../ather-automata.
// The mod is plain .mjs: nothing to compile. Run from anywhere: `node dev/test-all.mjs`.
// Type-checking needs the engine's API types: set CLAUDE_CODE_TYPES to a claude-code.d.ts
// (the plugin-authoring skill writes one, and a loaded mod gets .claude-plugin/types/claude-code/index.d.ts);
// without it the type-check is skipped and says so.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MOD = path.resolve(HERE, '../ather-automata')
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'ather-test-'))
const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' })

const copy = (from, to, rewrite = s => s) => {
  fs.mkdirSync(to, { recursive: true })
  for (const name of fs.readdirSync(from).filter(f => f.endsWith('.mjs'))) fs.writeFileSync(path.join(to, name), rewrite(fs.readFileSync(path.join(from, name), 'utf8')))
}

console.log('== type-check')
const types = process.env.CLAUDE_CODE_TYPES ?? [path.join(MOD, '.claude-plugin/types/claude-code/index.d.ts')].find(f => fs.existsSync(f))
if (types) {
  const config = path.join(WORK, 'tsconfig.json')
  fs.writeFileSync(config, JSON.stringify({
    compilerOptions: { target: 'es2023', lib: ['es2023'], types: [], module: 'esnext', moduleResolution: 'bundler', allowJs: true, checkJs: true, strict: true, noImplicitAny: false, noEmit: true, skipLibCheck: true },
    include: [types.replace(/\\/g, '/'), path.join(MOD, 'hooks/*.mjs').replace(/\\/g, '/')],
  }))
  sh(`npx -y -p typescript@5.6 tsc -p "${config}"`, WORK)
} else console.log('skipped: set CLAUDE_CODE_TYPES to the engine API types to type-check')

console.log('== unit')
const unit = path.join(WORK, 'unit')
copy(path.join(MOD, 'hooks'), path.join(unit, 'hooks'))
const shim = path.join(HERE, 'shim/testing.mjs').replace(/\\/g, '/')
copy(path.join(MOD, 'tests'), path.join(unit, 'tests'), s => s.replace(/from 'claude-code\/testing'/g, `from 'file:///${shim.replace(/^\//, '')}'`))
const tests = fs.readdirSync(path.join(MOD, 'tests')).filter(f => f.endsWith('.test.mjs'))
fs.writeFileSync(path.join(unit, 'main.mjs'), `${tests.map(f => `import './tests/${f}'`).join('\n')}\nimport { run } from 'file:///${shim.replace(/^\//, '')}'\nawait run()\n`)
sh('node main.mjs', unit)

console.log('== e2e')
const e2e = path.join(HERE, 'e2e')
fs.rmSync(path.join(e2e, 'out'), { recursive: true, force: true })
copy(path.join(MOD, 'hooks'), path.join(e2e, 'out/hooks'))
sh(`node run.mjs "${path.join(WORK, 'e2e-report.md')}"`, e2e)
console.log(`report: ${path.join(WORK, 'e2e-report.md')}`)
