// Type-checks the mods' hooks (plain .mjs with JSDoc) against the engine's API types. dev/test-all.mjs runs it, and so
// does the weekly workflow against the newest engine. Run from anywhere: `node dev/typecheck.mjs`.
// The types: CLAUDE_CODE_TYPES (a claude-code.d.ts; the plugin-authoring skill writes one), or the ones the engine wrote
// when it last loaded the mod (ather-automata/.claude-plugin/types/claude-code/index.d.ts). Without either it says so
// and passes: a skipped type-check is not a pass, and the caller's report says it was skipped.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { report } from './branch.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MOD = path.resolve(HERE, '../ather-automata')
const BOARD = path.resolve(HERE, '../ather-board')
const LANES = path.resolve(HERE, '../ather-lanes')

const types = process.env.CLAUDE_CODE_TYPES ?? [path.join(MOD, '.claude-plugin/types/claude-code/index.d.ts')].find(f => fs.existsSync(f))
if (!types) {
  report('warning', 'skipped: no engine types. Set CLAUDE_CODE_TYPES, or load the mod once in Claude Code, to type-check')
  process.exit(0)
}
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ather-types-'))
try {
  const config = path.join(work, 'tsconfig.json')
  fs.writeFileSync(config, JSON.stringify({
    compilerOptions: { target: 'es2023', lib: ['es2023'], types: [], module: 'esnext', moduleResolution: 'bundler', allowJs: true, checkJs: true, strict: true, noImplicitAny: false, noEmit: true, skipLibCheck: true },
    // A loaded mod's types keep the built-in tools in a sibling folder; include them when present.
    include: [types, path.join(path.dirname(types), '../claude-code-tools/index.d.ts')].filter(f => fs.existsSync(f)).concat(path.join(MOD, 'hooks/*.mjs'), path.join(MOD, 'hooks/packs/*.mjs'), path.join(BOARD, 'hooks/*.mjs'), path.join(LANES, 'hooks/*.mjs')).map(f => f.replace(/\\/g, '/')),
  }))
  execSync(`npx -y -p typescript@5.6 tsc -p "${config}"`, { cwd: work, stdio: 'inherit' })
} finally {
  fs.rmSync(work, { recursive: true, force: true })
}
