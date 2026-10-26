// The repository's skills live in .agents/skills/<name>/, where Codex and Cursor read them. Claude Code reads only
// .claude/skills/, so this copies each skill folder there, file for file. Real files, not symlinks: a Windows checkout
// without symlink rights gets a symlink as a one-line text file and Claude Code would see no skill.
// Never edit a copied folder in .claude/skills/ by hand. A file there is removed only when it is a stale copy: inside a
// folder that .agents/skills also has, or tracked by git. Anything else (your own untracked skill) is left alone and named.
//   node dev/skills.mjs           copy them
//   node dev/skills.mjs --check   fail if any copy differs (dev/test-all.mjs runs this)
import path from 'node:path'
import { ROOT, git, lines } from './branch.mjs'
import { filesIn, mirror } from './mirror.mjs'

const from = path.join(ROOT, '.agents/skills')
const to = path.join(ROOT, '.claude/skills')
const isCheck = process.argv.includes('--check')

const files = filesIn(from)
const sources = new Set(files)
const skills = new Set(files.map(file => file.split('/')[0]))
const tracked = new Set(lines(git('ls-files', '--', '.claude/skills')).map(file => file.slice('.claude/skills/'.length)))
const extra = filesIn(to).filter(file => !sources.has(file))
const isStale = file => skills.has(file.split('/')[0]) || tracked.has(file)

const drift = mirror({ from, to, files, isCheck, owns: isStale })
const yours = new Set(extra.filter(file => !isStale(file)).map(file => file.split('/')[0]))
if (yours.size > 0) console.log(`left alone (yours, not from .agents/skills, not in git): ${[...yours].join(', ')}`)

if (drift.length > 0) {
  console.error(`.claude/skills is out of step with .agents/skills: ${drift.join(', ')}. Run node dev/skills.mjs.`)
  process.exit(1)
}
console.log(isCheck ? 'skills: .claude/skills in step' : `skills: ${skills.size} skills in .claude/skills`)
