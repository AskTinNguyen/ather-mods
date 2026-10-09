// @ts-check
// Ather Automata: setting a repository up for intents. Which of the five pieces it has, and
// what the session is handed to add the missing ones from the bundle in templates/intent-setup.zip.
// The session does the writing; nothing here writes a file. Pure: no `$`.

/**
 * A piece of the structure. `path`: where it lives in the repository, as the prompt names it;
 * `source`: the bundle file it comes from; `what`: the few words the prompt says about it.
 * @typedef {'skill' | 'readme' | 'profile' | 'ignore' | 'pointer'} PieceId
 * @typedef {{ id: PieceId, path: string, source: string, what: string }} Piece
 */

/** @type {readonly Piece[]} */
export const SETUP_PIECES = [
  { id: 'skill', path: '.agents/skills/intent/', source: 'files/.agents/skills/intent/SKILL.md', what: 'the intent skill, copied unchanged' },
  { id: 'readme', path: 'docs/intent/README.md', source: 'files/docs/intent/README.md', what: 'the folder rules and the area list' },
  { id: 'profile', path: '.ather/profile.json', source: 'files/.ather/profile.example.json', what: 'the pack, the gates and the areas' },
  { id: 'ignore', path: '.gitignore', source: 'SETUP.md', what: 'the line that ignores local state' },
  { id: 'pointer', path: 'AGENTS.md', source: 'files/AGENTS.intent.md', what: "the paragraph that names the skill, or CLAUDE.md when that is this repository's instruction file" },
]

/**
 * What the reading needs: closures over the engine, as packs/index.mjs's PackIo.
 * @typedef {{ read: (path: string) => Promise<string | null>, exists: (path: string) => Promise<boolean> }} SetupIo
 * @typedef {{ pieces: Record<PieceId, boolean>, missing: PieceId[], isComplete: boolean, profile: { pack: string, gates: number, areas: number } | null }} Setup
 * `profile`: the pack it names and how many gates and areas it lists; null when there is none to read.
 */

// The profile as written, when it is an object that names its pack.
/** @param {string | null} text @returns {Record<string, any> | null} */
const profileOf = text => {
  if (!text) return null
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) && typeof value.pack === 'string' ? value : null
  } catch {
    return null
  }
}

// Gates are a list, or an object keyed by name (packs/web.mjs reads both).
/** @param {unknown} value */
const countOf = value => (Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0)

/**
 * Which pieces a repository has. Pure over what it reads.
 * @param {SetupIo} io @param {string} root @returns {Promise<Setup>}
 */
export const readSetup = async (io, root) => {
  /** @param {string} name */
  const read = name => io.read(`${root}/${name}`).catch(() => null)
  const [hasSkill, readme, profileText, ignore, agents, claude] = await Promise.all([
    io.exists(`${root}/.agents/skills/intent/SKILL.md`).catch(() => false),
    read('docs/intent/README.md'),
    read('.ather/profile.json'),
    read('.gitignore'),
    read('AGENTS.md'),
    read('CLAUDE.md'),
  ])
  const profile = profileOf(profileText)
  /** @type {Record<PieceId, boolean>} */
  const pieces = {
    skill: hasSkill,
    readme: /^##\s+Areas\b/m.test(readme ?? ''),
    profile: profile !== null,
    ignore: (ignore ?? '').split(/\r?\n/).some(line => /^\.ather\/(local\/?)?$/.test(line.trim())),
    pointer: [agents, claude].some(text => (text ?? '').includes('skills/intent')),
  }
  const missing = SETUP_PIECES.map(one => one.id).filter(id => !pieces[id])
  return { pieces, missing, isComplete: missing.length === 0, profile: profile && { pack: profile.pack, gates: countOf(profile.gates), areas: countOf(profile.areas) } }
}

// The pack a new profile gets: unreal beside a .uproject, else web (the core pack reads no gates and no areas).
/** @param {readonly { name: string, kind: string }[]} entries @returns {'unreal' | 'web'} */
export const suggestPack = entries => (entries.some(entry => entry.kind === 'file' && /\.uproject$/i.test(entry.name)) ? 'unreal' : 'web')

// ---------------------------------------------------------------- what the session is handed

/**
 * The one prompt. It names the zip and the missing pieces by target path, and repeats the rules that
 * must hold even if the session never reads the bundle.
 * @param {{ root: string, zip: string, missing: readonly PieceId[], pack: string }} input `root`: the repository's folder, with forward slashes as `zip` is.
 */
export const setupPrompt = ({ root, zip, missing, pack }) => {
  const wanted = SETUP_PIECES.filter(one => missing.includes(one.id))
  // Areas and gates go into the readme and the profile; the other pieces need no proposal.
  const asks = missing.includes('readme') || missing.includes('profile') ? 'ask me to confirm the areas and the gates in one question' : 'tell me what you will add and wait for my yes'
  return [
    `Set up the intent structure in the repository at ${root}; the paths below are from that folder. The files and the steps are in ${zip}: extract it to a temporary folder outside the repository (unzip, tar -xf, or Expand-Archive on Windows) and follow its SETUP.md.`,
    `Add ${wanted.length < SETUP_PIECES.length ? 'only what is missing here' : 'these'}: ${wanted.map(one => `${one.path} (${one.what})`).join('; ')}.${wanted.length < SETUP_PIECES.length ? ' Every other piece is already here: leave it as it is.' : ''}`,
    ...(missing.includes('profile') ? [`The pack for the profile: ${pack}.`] : []),
    `Read the repository first, then ${asks} before you write anything. Never overwrite a file that exists, do not touch an existing intent, and do not commit until I say so.`,
  ].join(' ')
}

/** @param {number} count @param {string} word */
const counted = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

// The complete case: what the profile reads as, in one line.
/** @param {Setup} setup */
export const setupSummary = setup =>
  `Intents are set up here${setup.profile ? `: pack ${setup.profile.pack}, ${counted(setup.profile.gates, 'gate')}, ${counted(setup.profile.areas, 'area')}` : ''}. Nothing to add.`
