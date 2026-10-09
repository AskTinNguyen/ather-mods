// A fake engine for end-to-end runs of the Ather Automata hooks module: real
// files (in a sandbox copy), scripted dialogs answered the way the real app
// answers them, the engine's rules enforced, side effects recorded.
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

export const AFK = Symbol('afk')
// What the tool answers when the person closes its dialog (Esc, or "Chat about this").
const REJECTED = "The user doesn't want to proceed with this tool use. The tool use was rejected."

// Elements are called as functions: Text({ ... }) returns a node.
const element = type => (props = {}) => ({ type, props, children: [props.children].flat(Infinity).filter(child => child !== null && child !== undefined && child !== false && child !== '') })
const ELEMENTS = Object.fromEntries(['Box', 'Text', 'Button', 'Input', 'Select', 'Markdown', 'Link', 'Code', 'Svg'].map(name => [name, element(name)]))
// The mobile app's table: no Input or Select (the app draws no field yet), as claude-code.d.ts says.
const MOBILE = Object.fromEntries(Object.entries(ELEMENTS).filter(([name]) => name !== 'Input' && name !== 'Select'))

export const createEngine = ({ root, surfaces, user, ghIssues, ghPrs, env }) => {
  const store = new Map()
  // Background workers the session dispatched, as $.agent.list() reports them.
  const agents = []
  const hooks = []
  const timers = []
  const record = { ghRuns: [], gitRuns: [], copies: [], hookErrors: [], toasts: [], status: [], submits: [], fills: [], dialogs: [], opens: [], closes: [], logs: [], commands: [], tools: [], registeredTools: [], toolSpecs: new Map(), invalidations: 0 }
  const script = []
  let holding = 0
  let isPlaced = true
  let sessionId = 'harness-session-0001'
  let submitFails = false
  // The engine refuses a prompt or a command queued from inside a command hook.
  const holdingTurn = what => {
    if (holding > 0) throw new Error(`ather-automata: ${what}: called from a command.run hook, it would wait on the turn this hook is holding`)
  }

  const on = (event, matcher, hook) => {
    if (typeof matcher === 'function') {
      hook = matcher
      matcher = undefined
    }
    hooks.push({ event, matcher, hook })
  }
  const matches = (matcher, e) => !matcher || Object.entries(matcher).every(([key, value]) => e[key] === value)

  // `signal`: the dispatch's own AbortSignal (the person's Esc); a fresh one that never aborts by default.
  const dispatch = async (event, e, bottom, origin = 'engine', signal = undefined) => {
    const chain = hooks.filter(one => one.event === event && matches(one.matcher, e))
    const run = async (index, ev) => {
      if (index >= chain.length) return bottom(ev)
      const next = next2 => run(index + 1, next2 ?? ev)
      next.origin = { plugin: origin, tier: 'user' }
      next.signal = signal ?? new AbortController().signal
      return chain[index].hook($, ev, next)
    }
    return run(0, e)
  }

  // Each dialog consumes the next scripted answer: a label, typed text, null (dismissed) or AFK.
  const answerDialog = question => {
    const responder = script.shift()
    const answer = responder ? responder(question) : null
    record.dialogs.push({ header: question.header, question: question.question, options: question.options.map(option => ({ label: option.label, description: option.description })), answer: answer === AFK ? '(timed out)' : answer })
    return answer
  }

  const toolBottom = input => {
    if ((input.tool === 'Write' || input.tool === 'Edit') && typeof input.file_path === 'string' && input.file_path.startsWith(root)) {
      // Write makes the folder it writes into, as the real tool does.
      if (input.tool === 'Write') fs.mkdirSync(path.dirname(input.file_path), { recursive: true }), fs.writeFileSync(input.file_path, input.content ?? '')
      else fs.writeFileSync(input.file_path, fs.readFileSync(input.file_path, 'utf8').replace(input.old_string, input.new_string))
      return { result: 'ok', text: 'ok' }
    }
    if (input.tool === 'AskUserQuestion') {
      const question = input.questions[0]
      const answer = answerDialog(question)
      // A dialog left alone resolves by itself with no answer; a dismissed one is the tool's error.
      if (answer === AFK) return { result: { questions: input.questions, answers: {}, afkTimeoutMs: 600000 }, text: 'auto-resolved' }
      if (answer === null) return { result: `Error: ${REJECTED}`, text: REJECTED, isError: true }
      // A label picked and words typed under Other both come back as the question's answer.
      return { result: { questions: input.questions, answers: { [question.question]: answer }, annotations: {} }, text: `answered: ${answer}` }
    }
    record.tools.push(input)
    return { result: 'ok', text: input.__text ?? 'ok', isError: input.__isError ?? undefined }
  }

  const $ = {
    plugin: { name: 'ather-automata', root: '' },
    clock: {
      now: async () => Date.now(),
      every: (ms, fn) => {
        timers.push(fn)
        return { cancel: () => undefined }
      },
      after: (ms, fn) => {
        const timer = setTimeout(fn, ms)
        // A long timer (a retry a minute out) must not keep the run alive after the checks.
        if (ms >= 10000) timer.unref?.()
        return { cancel: () => clearTimeout(timer) }
      },
      sleep: async () => undefined,
    },
    fs: {
      read: async file => {
        if (!fs.existsSync(file)) throw new Error(`ENOENT ${file}`)
        return fs.readFileSync(file, 'utf8')
      },
      write: async (file, text) => {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, text)
      },
      list: async dir =>
        fs.readdirSync(dir, { withFileTypes: true }).map(entry => {
          const stat = fs.statSync(path.join(dir, entry.name))
          return { name: entry.name, kind: entry.isDirectory() ? 'dir' : 'file', size: stat.size, mtimeMs: stat.mtimeMs, isLink: false }
        }),
      exists: async file => fs.existsSync(file),
      stat: async file => {
        const stat = fs.statSync(file)
        return { kind: stat.isDirectory() ? 'dir' : 'file', size: stat.size, mtimeMs: stat.mtimeMs, isLink: false }
      },
    },
    store: {
      get: async key => store.get(key),
      set: async (key, value) => void store.set(key, JSON.parse(JSON.stringify(value))),
      delete: async key => void store.delete(key),
      keys: async () => [...store.keys()],
    },
    // Environment variables: only what the test names (no HOME: the person's real files stay out).
    env: { get: async name => env?.[name] },
    process: {
      run: async (argv, init = {}) => {
        if (user !== undefined && argv.join(' ') === 'git config user.name') return { exitCode: 0, stdout: `${user}\n`, stderr: '' }
        // gh never runs for real: the issues are a fixture, and without one gh is signed out.
        if (argv[0] === 'gh') record.ghRuns.push(argv.join(' '))
        // Every git call, with the variables it was given: the checks read its argv and env.
        if (argv[0] === 'git') record.gitRuns.push({ argv: [...argv], env: { ...(init.env ?? {}) } })
        // `gh pr view <n>`: the PR states are a fixture too ({ [n]: 'MERGED' | 'OPEN' }); an unknown PR is not found.
        if (argv[0] === 'gh' && argv[1] === 'pr' && argv[2] === 'view') return ghPrs?.[argv[3]] ? { exitCode: 0, stdout: JSON.stringify({ state: ghPrs[argv[3]], mergedAt: ghPrs[argv[3]] === 'MERGED' ? '2026-10-04T01:31:16Z' : null }), stderr: '' } : { exitCode: 1, stdout: '', stderr: `GraphQL: Could not resolve to a PullRequest with the number of ${argv[3]}.` }
        if (argv[0] === 'gh') return ghIssues === undefined ? { exitCode: 1, stdout: '', stderr: 'gh: To get started with GitHub CLI, please run: gh auth login' } : { exitCode: 0, stdout: JSON.stringify(ghIssues), stderr: '' }
        try {
          const stdout = execFileSync(argv[0], argv.slice(1), { cwd: init.cwd ?? root, env: { ...process.env, ...(init.env ?? {}) }, encoding: 'utf8', timeout: init.timeoutMs ?? 30000, input: init.stdin, stdio: [init.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
          return { exitCode: 0, stdout, stderr: '' }
        } catch (error) {
          return { exitCode: error.status ?? 1, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') }
        }
      },
    },
    session: {
      id: async () => sessionId,
      root: async () => root,
      cwd: async () => root,
      surfaces: async () => surfaces.slice(),
    },
    ui: {
      resolve: e => (e?.surface === 'mobile' ? MOBILE : ELEMENTS),
      toast: text => record.toasts.push(text),
      copy: async ({ text }) => {
        record.copies.push(text)
        return { isCopied: true }
      },
      status: text => record.status.push(text),
      log: text => record.logs.push(text),
      invalidate: () => {
        record.invalidations += 1
      },
      open: async pane => {
        record.opens.push(pane)
        return { isPlaced }
      },
      close: async pane => void record.closes.push(pane),
      panes: async () => [],
      // The engine's own dialog: a tool.call of AskUserQuestion through the hooks (the plugin's own see it, origin the
      // plugin), labels only, fewer than two padded with Yes/No. Resolves to the answer; rejects when there is none.
      ask: async (question, options = {}) => {
        const { options: labels = [], header = '' } = Array.isArray(options) ? { options } : options
        const padded = [...labels, ...['Yes', 'No'].filter(label => !labels.includes(label))].slice(0, Math.max(2, labels.length))
        const ran = await dispatch('tool.call', { tool: 'AskUserQuestion', tool_use_id: `toolu_plugin_${record.dialogs.length}`, questions: [{ question, header, options: padded.map(label => ({ label, description: '' })), multiSelect: false }] }, toolBottom, 'ather-automata')
        const answer = ran.deny === undefined && ran.isError !== true ? ran.result?.answers?.[question] : undefined
        if (typeof answer !== 'string' || answer === '') throw new Error(`ather-automata: $.ui.ask: no answer (${ran.deny ?? ran.text})`)
        return answer
      },
    },
    prompt: {
      submit: async input => {
        holdingTurn('prompt.submit')
        if (submitFails) throw new Error('the prompt box is busy')
        record.submits.push(input.text)
        return {}
      },
      fill: async input => {
        holdingTurn('prompt.fill')
        record.fills.push(input.text)
        return { isFilled: true }
      },
    },
    command: {
      register: async spec => {
        record.commands.push(spec.name)
        return { command: spec.name }
      },
      run: async input => (holdingTurn('command.run'), dispatch('command.run', { command: input.command, args: input.args ?? '', origin: { kind: 'plugin' }, presentation: {} }, () => ({ text: '' }), 'ather-automata')),
    },
    tool: {
      register: async spec => {
        record.registeredTools.push(spec.name)
        // A name registered again is replaced, as the engine does: the last spec is what the model reads.
        record.toolSpecs.set(spec.name, spec)
        return { tool: `mcp__ather-automata__${spec.name}` }
      },
      call: async input => {
        // The engine refuses the dialog's tool from a plugin: it is $.ui.ask.
        if (input.tool === 'AskUserQuestion') throw new Error('ather-automata: tool.call: runs the AskUserQuestion tool: that is $.ui.ask (host check)')
        return dispatch('tool.call', input, toolBottom, 'ather-automata')
      },
    },
    agent: { list: async () => agents.map(one => ({ ...one })) },
  }

  return {
    $,
    on,
    record,
    store,
    script,
    setPlaced: value => {
      isPlaced = value
    },
    // /clear: the process goes on under a new session id, and no session.start fires.
    setSessionId: value => {
      sessionId = value
    },
    failSubmit: value => {
      submitFails = value
    },
    end: reason => dispatch('session.end', { reason, sessionId }, () => ({})),
    // The person types a command; the hook holds the turn; a throwing hook is skipped, as the app does.
    command: async (command, args = '') => {
      holding += 1
      try {
        return await dispatch('command.run', { command, args, origin: { kind: 'composer' }, presentation: {} }, () => ({ text: '(no hook)' }))
      } catch (error) {
        record.hookErrors.push(`/${command} ${args}: ${error.message}`)
        return { text: `(hook skipped: ${error.message})` }
      } finally {
        holding -= 1
      }
    },
    // Which surfaces the session draws on from now (the desktop app attaches after start).
    setSurfaces: list => surfaces.splice(0, surfaces.length, ...list),
    flush: () => new Promise(resolve => setTimeout(resolve, 200)),
    timers: async () => {
      for (const fn of timers) await fn()
      await new Promise(resolve => setTimeout(resolve, 100))
    },
    modelTool: input => dispatch('tool.call', input, toolBottom, 'engine'),
    // A background worker: dispatched with a brief, then calling tools in its own loop.
    // `parentId`: a worker another worker dispatched from its own loop (the spawn's parentAgentId, as the engine
    // pins it). `toolUseId`: the Agent call this spawn belongs to; `background`: false for a foreground call that waits.
    spawn: async ({ agentId, prompt, description, subagentType = 'general-purpose', model = 'claude-opus-5-5', parentId, toolUseId, background = true }) => {
      const result = await dispatch('agent.spawn', { tool_use_id: toolUseId ?? `spawn-${agentId}`, prompt, description, subagentType, provider: { plugin: 'engine', tier: 'core' }, parentModel: model, background, fork: false, ...(parentId ? { parentAgentId: parentId } : {}) }, () => ({ model, agentId }))
      agents.push({ id: agentId, description, type: subagentType, status: 'running', ...(parentId ? { parentId } : {}) })
      return result
    },
    // A worker already running when the plugin loaded: listed, but no spawn event was seen.
    addAgent: agent => void agents.push({ status: 'running', type: 'general-purpose', ...agent }),
    // A worker's own turn ends (its answer), as Claude Code reports it.
    agentTurnEnd: agentId => dispatch('turn.complete', { reason: 'answer', agentId }, () => ({ text: '' })),
    agentTool: (agentId, input) => dispatch('tool.call', { ...input, agentId }, toolBottom, 'engine'),
    // A tool call held in flight: it reaches the tool (`reached`) and stays there until released (it runs),
    // refused (the tool answers with a deny) or failed (the tool throws). `agentId` undefined: the main loop.
    // `ask`: the engine's tool.check answers "ask" first (the mode then settles it: in auto mode the classifier
    // may allow it at once). `dialog`: the permission dialog is then shown to the person, as Claude Code reports it
    // (classic.PermissionRequest: agent_id inside a subagent, tool_name, tool_input, no tool_use_id); the call waits
    // there. `abort()`: the dispatch is aborted (Esc) and the call never settles.
    holdTool: (agentId, input, { ask = false, dialog = false } = {}) => {
      const stop = new AbortController()
      let release = () => undefined
      let fail = () => undefined
      let reach = () => undefined
      const gate = new Promise((resolve, reject) => {
        release = resolve
        fail = reject
      })
      const reached = new Promise(resolve => (reach = resolve))
      const done = dispatch('tool.call', { tool_use_id: `held-${Math.random().toString(36).slice(2, 10)}`, ...input, ...(agentId ? { agentId } : {}) }, async ev => {
        if (ask || dialog) await dispatch('tool.check', { tool: ev.tool, input: ev, tool_use_id: ev.tool_use_id }, () => ({ decision: 'ask', reason: 'not in the allow list' }))
        if (dialog) {
          const { tool, tool_use_id: _id, agentId: loop, ...toolInput } = ev
          await dispatch('classic.PermissionRequest', { hook_event_name: 'PermissionRequest', session_id: sessionId, transcript_path: '', cwd: root, tool_name: tool, tool_input: toolInput, ...(loop ? { agent_id: loop, agent_type: 'general-purpose' } : {}) }, () => ({}))
        }
        reach(ev)
        const how = await gate
        return how === 'deny' ? { deny: 'refused by the person' } : toolBottom(ev)
      }, 'engine', stop.signal)
      return { done, reached, release: () => release('run'), deny: () => release('deny'), fail: (error = new Error('the tool threw')) => fail(error), abort: () => stop.abort() }
    },
    setAgentStatus: (agentId, status) => {
      const agent = agents.find(one => one.id === agentId)
      if (agent) agent.status = status
    },
    // The person types a prompt and presses Enter.
    type: text => dispatch('prompt.submit', { text, wait: false, origin: { kind: 'composer' } }, e => ({ text: e.text })),
    compose: () => dispatch('prompt.compose', {}, () => ({ sections: [{ id: 'intro', text: 'engine', scope: 'shared' }] })),
    start: (isInteractive = true) => dispatch('session.start', { cwd: root, surface: surfaces[0] ?? null, isInteractive }, e => ({ cwd: e.cwd })),
    turnEnd: () => dispatch('turn.complete', { reason: 'answer' }, () => ({ text: '' })),
    render: (component, props, requestId, surface = 'terminal') => dispatch('ui.render', { component, surface, requestId, props }, () => null),
    close: id => dispatch('ui.close', { id, origin: { kind: 'person' } }, () => ({ value: undefined, closed: true })),
  }
}
