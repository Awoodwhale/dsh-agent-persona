/**
 * Offline assertions for the host half: matching, resolution, sanitisation,
 * injection, the store, the heartbeat and the dropdown candidate lists.
 *
 * Node built-ins only, no DSH needed — run with `npm test`.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'wsp-'))
process.env.DSH_HOME = home
const stateDir = join(home, 'dsh-agent-persona')
const storePath = join(stateDir, 'personas.json')
const heartbeatPath = join(stateDir, 'state.json')

const mod = await import(new URL('../lib/index.js', import.meta.url).href)
const { collectLastSystemPrompt, sessionPromptFrom } = mod
const { applyPersonaMode, clipMarkdown, collectSessionHistory, historyOptions, collectTargets, targetSpecificity, reorderPersonas, matchTarget, PERSONA_MODES, personaTextFor, resolvePersona, sanitizePersona, takeOverClaims } = mod

const WS = '/tmp/ws/web-app'
const OTHER = '/tmp/ws/docs'
const P = (over) => ({ id: over.id ?? 'p', name: over.name ?? 'p', enabled: over.enabled !== false, text: over.text ?? 'T', targets: over.targets ?? [] })
const T = (kind, match, value) => ({ kind, match, value })

// ── matchTarget: two kinds × four modes, plus the unusable cases
assert.equal(matchTarget(T('workspace', 'exact', WS), { cwd: WS }), true)
assert.equal(matchTarget(T('workspace', 'exact', WS), { cwd: OTHER }), false)
assert.equal(matchTarget(T('workspace', 'exact', `${WS}/`), { cwd: WS }), true, 'a trailing slash is the same directory')
assert.equal(matchTarget(T('workspace', 'prefix', '/tmp/ws'), { cwd: WS }), true)
assert.equal(matchTarget(T('workspace', 'prefix', '/tmp/other'), { cwd: WS }), false)
assert.equal(matchTarget(T('workspace', 'contains', 'web-app'), { cwd: WS }), true, 'a bare substring is usable on a path')
assert.equal(matchTarget(T('workspace', 'regex', '^/tmp/ws/(web-app|docs)$'), { cwd: WS }), true)
assert.equal(matchTarget(T('sessionId', 'exact', 'im-bot-1a2b-g3'), { sessionId: 'im-bot-1a2b-g3' }), true)
assert.equal(matchTarget(T('sessionId', 'prefix', 'im-bot-'), { sessionId: 'im-bot-1a2b-g3' }), true)
assert.equal(matchTarget(T('sessionId', 'prefix', 'im-bot-'), { sessionId: 'session-1' }), false)
assert.equal(matchTarget(T('sessionId', 'regex', '^im-bot-.*-g[0-9]+$'), { sessionId: 'im-bot-1a2b-g3' }), true)
assert.equal(matchTarget(T('sessionId', 'contains', '1a2b'), { sessionId: 'im-bot-1a2b-g3' }), true)
assert.equal(matchTarget(T('workspace', 'exact', ''), { cwd: WS }), false, 'an empty value never matches')
assert.equal(matchTarget(T('sessionId', 'regex', '(['), { sessionId: 'x' }), false, 'a broken regex never matches')
assert.equal(matchTarget(T('workspace', 'exact', WS), {}), false, 'a missing subject field never matches')
assert.equal(matchTarget({ kind: 'workspace', match: 'nonsense', value: WS }, { cwd: WS }), false)

// ── resolvePersona: specificity decides, rows are OR-ed, no-target personas are inert
const personas = [
  P({ id: 'specific', name: 'specific', targets: [T('sessionId', 'prefix', 'im-bot-')] }),
  P({ id: 'ws', name: 'ws', targets: [T('workspace', 'exact', WS), T('workspace', 'exact', OTHER)] }),
  P({ id: 'muted', name: 'muted', enabled: false, targets: [] }),
  P({ id: 'fallback', name: 'fallback', targets: [] }),
]
assert.equal(resolvePersona(personas, { cwd: WS, sessionId: 'im-bot-x' }).persona.id, 'specific', 'the first match wins')
assert.equal(resolvePersona(personas, { cwd: OTHER, sessionId: 'session-1' }).persona.id, 'ws', 'the second row of a persona also claims')
assert.equal(resolvePersona(personas, { cwd: '/tmp/elsewhere', sessionId: 'session-2' }).persona, undefined, 'a persona with no targets applies nowhere')
assert.equal(resolvePersona(personas, {}).persona, undefined, 'nor to an agent-less assembly: the harness prompt stands')
assert.equal(resolvePersona([P({ enabled: false, targets: [] })], { cwd: WS }).reason, 'none', 'disabled personas are skipped')
assert.equal(resolvePersona([], { cwd: WS }).reason, 'none')
assert.equal(resolvePersona([personas[1], personas[0], personas[2], personas[3]], { cwd: WS, sessionId: 'im-bot-x' }).persona.id, 'specific', 'a session rule beats a workspace rule regardless of order')

// replace takes over the harness identity line as well as the deployment persona
const identityAssembly = () => ({
  sections: [
    { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.\n' },
    { name: 'deployment:persona-prefix', text: 'You are a coding agent powered by the DeepSeek model.' },
    { name: 'agent-persona', text: 'MY PERSONA' },
    { name: 'tools:guidance', text: 'Use the read tool.' },
  ],
})
const identityReplaced = applyPersonaMode(identityAssembly(), { mode: 'replace', deploymentPrefix: 'You are a coding agent powered by the DeepSeek model.' })
assert.equal(identityReplaced.sections[0].text, '', 'replace clears the harness identity line')
assert.equal(identityReplaced.sections[1].text, '', 'and the deployment persona prefix')
assert.equal(identityReplaced.sections[2].text, 'MY PERSONA', 'leaving the persona itself alone')
assert.equal(identityReplaced.sections[3].text, 'Use the read tool.', 'and the tool guidance untouched')
const appended = applyPersonaMode(identityAssembly(), { mode: 'append', deploymentPrefix: 'x' })
assert.equal(appended.sections[0].text.startsWith('You are an AI agent'), true, 'append keeps the harness identity')
assert.equal(appended.sections[1].text.startsWith('You are a coding agent'), true, 'and the deployment persona')
const foreignPreset = applyPersonaMode({ sections: [{ name: 'deployment:persona-prefix', text: 'A preset wrote this.' }] }, { mode: 'replace', deploymentPrefix: 'the deployment text' })
assert.equal(foreignPreset.sections[0].text, 'A preset wrote this.', 'a preset\'s own persona is never removed')

// ── specificity decides, list order only breaks ties
assert.equal(targetSpecificity({ kind: 'sessionId', match: 'exact' }), 8)
assert.equal(targetSpecificity({ kind: 'sessionId', match: 'prefix' }), 7)
assert.equal(targetSpecificity({ kind: 'sessionId', match: 'regex' }), 6)
assert.equal(targetSpecificity({ kind: 'workspace', match: 'exact' }), 4)
assert.equal(targetSpecificity({ kind: 'workspace', match: 'contains' }), 2)
assert.equal(targetSpecificity({ kind: undefined }), 0)

// the reported case: a workspace persona above a session persona in the list
const overlapping = [
  P({ id: 'dir', name: 'dir', targets: [T('workspace', 'exact', WS)] }),
  P({ id: 'one', name: 'one', targets: [T('sessionId', 'exact', 'chat-1')] }),
]
const inDir = { cwd: WS, sessionId: 'chat-1' }
assert.equal(resolvePersona(overlapping, inDir).persona.id, 'one', 'the session rule wins even when listed second')
assert.equal(resolvePersona(overlapping, inDir).specificity, 8, 'and reports how specific the winner was')
assert.equal(resolvePersona(overlapping, { cwd: WS, sessionId: 'chat-2' }).persona.id, 'dir', 'other sessions in that directory still get the directory persona')
assert.equal(resolvePersona([P({ id: 'wide', targets: [T('workspace', 'prefix', WS)] }), P({ id: 'narrow', targets: [T('workspace', 'exact', WS)] })], { cwd: WS }).persona.id, 'narrow', 'an exact workspace beats a prefix')
assert.equal(resolvePersona([P({ id: 'second', targets: [T('workspace', 'exact', WS)] }), P({ id: 'first', targets: [T('workspace', 'exact', OTHER)] })], { cwd: WS }).persona.id, 'second', 'equal specificity falls back to list order')

// ── personaTextFor: an empty winning text means "no persona here"
const silencing = [P({ id: 'quiet', text: '', targets: [T('workspace', 'exact', WS)] }), P({ id: 'fallback', text: 'FALLBACK', targets: [] })]
assert.equal(personaTextFor(silencing, { session: { header: { id: 's1', cwd: WS } } }), '', 'an empty winner silences the catch-all')
assert.equal(personaTextFor(silencing, { session: { header: { id: 's2', cwd: OTHER } } }), '', 'a persona with no targets covers nothing, so the harness prompt stands')
const withVars = [P({ text: '模型 {{model}} 未知 {{nope}} 目录 {{cwd}}', targets: [T('workspace', 'exact', WS)] })]
const rendered = personaTextFor(withVars, { session: { header: { id: 's3', cwd: WS } } })
assert.ok(rendered.includes('{{model}}') && rendered.includes('{{cwd}}'), 'registered variables survive')
assert.ok(!rendered.includes('{{nope}}') && rendered.includes('nope'), 'an unknown variable is de-braced')
const stray = sanitizePersona('a {{ }} b {{ b')
assert.ok(!stray.includes('{{') && !stray.includes('}}'), 'stray braces never survive')
assert.ok(/^a\s+b\s+b$/.test(stray), `letters survive, got ${JSON.stringify(stray)}`)

// ── collectTargets: the dropdown lists, with and without host services
const labels = { s1: '第一条会话', s2: '第二条会话' }
const richCtx = {
  get: (name) => ({
    workspaceRegistry: { list: () => [{ path: WS, title: 'Web 应用', sessionIds: ['s1', 's2'] }, { path: OTHER, title: '', sessionIds: [] }] },
    sessionPersistence: {
      list: () => [
        { header: { id: 's1', cwd: WS, createdAt: 1000 } },
        { header: { id: 's2', cwd: OTHER, createdAt: 2000 } },
      ],
    },
    sessionTitle: { get: (session) => labels[session.id] },
    sessions: { get: (id) => ({ id }) },
  }[name]),
}
const owners = [
  P({ id: 'wide', name: '整个代码目录', targets: [T('workspace', 'prefix', '/tmp/ws')] }),
  P({ id: 'owner', name: '前端项目助手', targets: [T('workspace', 'exact', WS)] }),
]
const targets = await collectTargets(richCtx, { personas: owners })
assert.deepEqual(targets.workspaces, [
  { path: WS, title: 'Web 应用', sessionCount: 2, owner: { id: 'owner', name: '前端项目助手' } },
  { path: OTHER, title: OTHER, sessionCount: 0, owner: { id: 'wide', name: '整个代码目录' } },
], 'workspaces keep their title, fall back to the path, and name the persona that actually wins (exact beats an earlier prefix)')
assert.deepEqual(targets.sessions.map((session) => session.id), ['s2', 's1'], 'sessions are newest first')
assert.equal(targets.sessions[0].title, '第二条会话', 'a session title rides along when the host can produce one')
assert.equal(targets.sessions[0].cwd, OTHER)

// only interactive sessions are listed: sub-agents and archived ones are hidden
const scopeCtx = { get: (name) => ({
  sessionPersistence: {
    list: () => [
      { header: { id: 'keep1', cwd: WS, createdAt: 9 } },
      { header: { id: 'sub1', cwd: WS, createdAt: 8, origin: 'subagent', delegationDepth: 1, parentSession: 'keep1' } },
      { header: { id: 'sub2', cwd: WS, createdAt: 7, delegationDepth: 2 } },
      { header: { id: 'gone1', cwd: WS, createdAt: 6 } },
    ],
  },
  workspaceRegistry: { archivedSessionIds: ['gone1'], list: () => [{ path: WS, title: 'WS', sessionIds: [] }] },
}[name]) }
const scoped = await collectTargets(scopeCtx, {})
assert.deepEqual(scoped.sessions.map((session) => session.id), ['keep1'], 'only conversations a human can open are listed')
assert.deepEqual(scoped.hidden, { subagents: 2, archived: 1, blank: 0 }, 'and the page can say what it hid')

// the workspace store file is the fallback for the archived list
mkdirSync(join(home, 'storages'), { recursive: true })
writeFileSync(join(home, 'storages', 'workspace.json'), JSON.stringify({ record: { rows: { global: { val: { archivedSessionIds: ['gone2'] } }, tables: { val: { workspaces: { w1: { archivedSessionIds: ['gone3'] } } } } } } }))
const fileScopeCtx = { get: (name) => (name === 'sessionPersistence' ? { list: () => [{ header: { id: 'gone2', cwd: WS, createdAt: 2 } }, { header: { id: 'gone3', cwd: WS, createdAt: 1 } }, { header: { id: 'stay', cwd: WS, createdAt: 3 } }] } : undefined) }
const fromFile = await collectTargets(fileScopeCtx, {})
assert.deepEqual(fromFile.sessions.map((session) => session.id), ['stay'], 'archived ids are read from the workspace store when the service stays quiet')
assert.equal(fromFile.hidden.archived, 2)

// titles: DSH's projection cache wins, its file is a fallback, the first message is the last resort
const projCtx = { get: (name) => ({
  sessionPersistence: { list: () => [{ header: { id: 'p1', cwd: WS, createdAt: 10 } }] },
  sessionProjectionCache: { recordFor: (id) => (id === 'p1' ? { rows: { title: { val: '投影标题' } } } : undefined) },
}[name]) }
assert.equal((await collectTargets(projCtx, {})).sessions[0].title, '投影标题', 'the projection cache is the first title source')

mkdirSync(join(home, 'storages', 'session_projcache', 'sessions'), { recursive: true })
writeFileSync(join(home, 'storages', 'session_projcache', 'sessions', 'f1.json'), JSON.stringify({ record: { rows: { title: { val: '文件标题' } } } }))
const fileCtx = { get: (name) => (name === 'sessionPersistence' ? { list: () => [{ header: { id: 'f1', cwd: WS, createdAt: 11 } }] } : undefined) }
assert.equal((await collectTargets(fileCtx, {})).sessions[0].title, '文件标题', 'the projection file is read when the service is absent')

// a session with no title falls back to a prompt — from the SAME projection read, never the log
writeFileSync(join(home, 'storages', 'session_projcache', 'sessions', 'p2.json'), JSON.stringify({
  record: { rows: { titleInput: { val: { first: { text: '帮我看看这个奇怪的构建报错' }, count: 4 } }, sessionStats: { val: { turns: 9 } } } },
}))
const promptCtx = { get: (name) => (name === 'sessionPersistence' ? { list: () => [{ header: { id: 'p2', cwd: WS, createdAt: 12 } }] } : undefined) }
const promptTarget = (await collectTargets(promptCtx, {})).sessions[0]
assert.equal(promptTarget.title, '帮我看看这个奇怪的构建报错', 'the first prompt labels a session that has no title yet')
assert.equal(promptTarget.turns, 9, 'the session reports how often it was talked to')

writeFileSync(join(home, 'storages', 'session_projcache', 'sessions', 'p3.json'), JSON.stringify({
  record: { rows: { turnOutline: { val: { turns: [{ prompt: '开始' }, { prompt: '最后我问的是这个很长的问题，长到需要被截断处理掉多余的部分才行，否则下拉框里会撑爆显示不下，所以这里必须做截断处理才行' }] } } } },
}))
const latestCtx = { get: (name) => (name === 'sessionPersistence' ? { list: () => [{ header: { id: 'p3', cwd: WS, createdAt: 13 } }] } : undefined) }
const latestLabel = (await collectTargets(latestCtx, {})).sessions[0].title
assert.match(latestLabel, /^最后我问的是这个很长的问题/, 'the latest prompt is used when nothing else exists')
assert.ok(latestLabel.endsWith('…') && latestLabel.length === 49, 'and it is trimmed to 48 characters plus an ellipsis')

// a session nobody ever typed into is not offered (the sidebar hides it too)
writeFileSync(join(home, 'storages', 'session_projcache', 'sessions', 'blank1.json'), JSON.stringify({
  record: { rows: { sessionListMetadata: { val: { blank: true, lastPromptAt: null } }, sessionStats: { val: { turns: 0 } } } },
}))
const blankCtx = { get: (name) => (name === 'sessionPersistence' ? { list: () => [{ header: { id: 'blank1', cwd: WS, createdAt: 21 } }, { header: { id: 'real1', cwd: WS, createdAt: 20 } }] } : undefined) }
const blankTargets = await collectTargets(blankCtx, {})
assert.deepEqual(blankTargets.sessions.map((session) => session.id), ['real1'], 'an empty session is dropped')
assert.equal(blankTargets.hidden.blank, 1, 'and reported as hidden')

const bareWarnings = []
const bare = await collectTargets({ get: () => undefined }, { warn: (message) => bareWarnings.push(message) })
assert.deepEqual(bare, { workspaces: [], sessions: [], hidden: { subagents: 0, archived: 0, blank: 0 } }, 'a deployment without those services yields empty lists')
assert.equal(bareWarnings.length, 2, 'and says why (workspaces, sessions)')
assert.ok(bareWarnings.every((message) => /must be typed/.test(message)))

// ── session history: one window per call, with nextOffset for "load more"
const msg = (type, text) => ({ type, data: { content: [{ text }] } })
const openArgs = []
const liveCtx = {
  get: (name) => (name === 'sessionPersistence'
    ? {
      open: async (...args) => {
        openArgs.push(args)
        if (args[1] !== 'read') throw new Error('access mode required')
        return { header: { cwd: WS, createdAt: 5 }, events: [msg('user/message', '第一条'), msg('tool/call', 'x'), msg('assistant/message', '回你')] }
      },
    }
    : undefined),
}
const live = await collectSessionHistory(liveCtx, 's1', {})
assert.equal(live.available, true)
assert.equal(live.cwd, WS)
assert.deepEqual(live.messages.map((m) => [m.role, m.text]), [['user', '第一条'], ['assistant', '回你']], 'tool events are skipped')
assert.equal(live.done, true, 'an in-memory event list is one complete window')
assert.deepEqual(openArgs[0], ['s1', 'read'], 'the persistence handle is opened for read access')

// a read() based backend: the window slides and the page reports what is left
const many = Array.from({ length: 5 }, (_, i) => msg('user/message', `m${i}`))
let reads = []
const pagedCtx = {
  get: (name) => (name === 'sessionPersistence'
    ? {
      open: async () => ({
        header: { cwd: OTHER, createdAt: 7 },
        events: [],
        read: async (offset, length) => {
          reads.push(`${offset}+${length}`)
          return { events: many.slice(offset, offset + length), eventCount: many.length }
        },
      }),
    }
    : undefined),
}
const page1 = await collectSessionHistory(pagedCtx, 's2', { offset: 0, events: 2 })
assert.deepEqual(page1.messages.map((m) => m.text), ['m0', 'm1'])
assert.equal(page1.nextOffset, 2, 'the page says where to continue')
assert.equal(page1.done, false)
const page2 = await collectSessionHistory(pagedCtx, 's2', { offset: page1.nextOffset, events: 2 })
assert.deepEqual(page2.messages.map((m) => m.text), ['m2', 'm3'])
const page3 = await collectSessionHistory(pagedCtx, 's2', { offset: page2.nextOffset, events: 2 })
assert.equal(page3.done, true, 'a short window ends the conversation')
assert.deepEqual(reads, ['0+2', '2+2', '4+2'], 'each page asks the backend for exactly one window')

// injected user-side traffic is hidden and counted, typed input is kept
const injected = [
  msg('user/message', '我真实的输入'),
  { type: 'plugin', data: { content: [{ text: 'runtime snapshot' }] } },
]
injected[1] = { type: 'user/message', data: { source: { kind: 'skill-catalog' }, content: [{ text: '<available_skills>…' }] } }
injected.push({ type: 'user/message', data: { source: { kind: 'agent-instructions' }, content: [{ text: 'The following workspace instructions…' }] } })
injected.push({ type: 'user/message', data: { content: [{ text: '没有 source 的输入视为用户输入' }] } })
const mixedCtx = { get: (name) => (name === 'sessionPersistence' ? { open: async () => ({ header: {}, events: injected }) } : undefined) }
const mixed = await collectSessionHistory(mixedCtx, 's5', {})
assert.deepEqual(mixed.messages.map((m) => m.text), ['我真实的输入', '没有 source 的输入视为用户输入'], 'injected user-side events are hidden')
assert.equal(mixed.skipped, 2, 'and counted, so the page can say so')

// every option the client sends must reach the reader
assert.deepEqual(historyOptions({ id: 'x', tail: true, keep: 4, events: 2000 }), { offset: undefined, events: 2000, maxChars: undefined, tail: true, keep: 4 })
assert.equal(historyOptions({ tail: 'yes' }).tail, false, 'tail is only true when it is literally true')
assert.equal(historyOptions(undefined).tail, false, 'and a missing payload is still safe')

// every message says where it lives, and that pointer re-reads it in full
const ptr = await collectSessionHistory(pagedCtx, 's2', { offset: 2, events: 2 })
assert.deepEqual(ptr.messages.map((m) => m.at), [2, 3], 'messages carry their absolute event index')
const full = await collectSessionHistory(pagedCtx, 's2', { offset: ptr.messages[0].at, events: 1, maxChars: 100000 })
assert.deepEqual(full.messages.map((m) => m.text), ['m2'], 'one event at that pointer is that one message')

// tail mode walks to the end and hands back the last exchange (from the last user input)
const exchange = [
  msg('user/message', 'q1'), msg('assistant/message', 'a1'), msg('assistant/message', 'a2'),
  msg('user/message', 'q2'), msg('assistant/message', 'a3'), msg('assistant/message', 'a4'),
]
const tailCtx = {
  get: (name) => (name === 'sessionPersistence'
    ? {
      open: async () => ({
        header: { cwd: WS, createdAt: 42 },
        events: [],
        read: async (offset, length) => ({ events: exchange.slice(offset, offset + length), eventCount: exchange.length }),
      }),
    }
    : undefined),
}
const tail = await collectSessionHistory(tailCtx, 't1', { tail: true, events: 2, keep: 2 })
assert.equal(tail.tail, true, 'the result is marked as a tail read')
assert.equal(tail.done, true, 'and it always reports itself complete')
assert.equal(tail.nextOffset, null, 'there is nothing further to page to')
assert.deepEqual(tail.messages.map((m) => m.text), ['q2', 'a3', 'a4'], 'the last user input survives even when the agent answered several times')
assert.equal(tail.total, 6, 'while the total count still reflects the whole conversation')
assert.equal(tail.scanned, 6, 'and the walk reports how many events it read')
assert.equal(tail.cwd, WS, 'the header still comes from the first window')

// clipping a message must not leave an open code fence behind
const long = `开头\n\n\u0060\u0060\u0060js\nconst a = 1\nconst b = 2\n`.padEnd(300, 'x')
const clippedLong = clipMarkdown(long, 200)
assert.ok(long.startsWith(clippedLong.split('\n\n…')[0]), 'the kept head is a verbatim prefix of the message')
const blocks = `第一段${'甲'.repeat(80)}\n\n第二段${'乙'.repeat(80)}\n\n第三段${'丙'.repeat(80)}`
const clippedBlocks = clipMarkdown(blocks, 120)
assert.equal(clippedBlocks.includes('第二段'), false, 'the cut lands on a block boundary, so a half block is never kept')
assert.ok(clippedBlocks.startsWith('第一段'), 'and the complete blocks before it survive')
assert.equal((clippedLong.match(/^\u0060\u0060\u0060/gm) ?? []).length % 2, 0, 'no unclosed fence is left behind')
assert.equal((clippedLong.match(/\u0060/g) ?? []).length % 2, 0, 'and no unclosed inline code span either')
assert.equal(clippedLong.includes('已截断'), false, 'the notice is the interface\'s job, not text glued to the message')
assert.equal((clipMarkdown('short', 200)), 'short', 'a short message is returned untouched')

// one huge message cannot blow up the payload
const longCtx = { get: (name) => (name === 'sessionPersistence' ? { open: async () => ({ header: {}, events: [msg('user/message', 'x'.repeat(900))] }) } : undefined) }
const clipped = await collectSessionHistory(longCtx, 's3', { maxChars: 200 })
assert.equal(clipped.messages[0].truncated, true)
assert.ok(clipped.messages[0].text.startsWith('x'.repeat(200)), 'the head is kept up to the cap')
assert.equal(clipped.messages[0].text.includes('已截断'), false, 'while the note itself is left to the interface')

const none = await collectSessionHistory({ get: () => undefined }, 's4', {})
assert.equal(none.unavailable, true, 'no reader at all is reported as unavailable')
assert.equal((await collectSessionHistory({ get: () => undefined }, '', {})).unavailable, true, 'an empty id is refused')

// ── injection modes: append leaves the prompt alone, replace drops the deployment persona
const prefixSection = (text) => ({ name: 'deployment:persona-prefix', text })
const assembly = { sections: [prefixSection('BASE'), { name: 'tools:guidance', text: 'ID' }], contexts: [], tools: [], variables: {} }
assert.deepEqual(PERSONA_MODES, ['append', 'replace'])
assert.equal(applyPersonaMode(assembly, { mode: 'append', deploymentPrefix: 'BASE' }), assembly, 'append hands the assembly on untouched')
const replaced = applyPersonaMode(assembly, { mode: 'replace', deploymentPrefix: 'BASE' })
assert.equal(replaced.sections[0].text, '', 'replace drops the deployment persona line')
assert.equal(replaced.sections[1].text, 'ID', 'and leaves every other section alone')
assert.equal(applyPersonaMode({ sections: [{ name: 'harness:identity', text: 'ID' }] }, { mode: 'replace', deploymentPrefix: 'BASE' }).sections[0].text, '', 'while the harness identity line is taken over as well')
assert.equal(assembly.sections[0].text, 'BASE', 'the input assembly is not mutated')
assert.equal(applyPersonaMode(assembly, { mode: 'replace', deploymentPrefix: 'A PRESET PERSONA' }), assembly, 'a persona someone else wrote is never overwritten')
assert.equal(applyPersonaMode(assembly, { mode: 'replace', deploymentPrefix: undefined }).sections[0].text, '', 'an unreadable deployment persona still honours the request')
assert.equal(applyPersonaMode({ sections: [{ name: 'x', text: 'y' }] }, { mode: 'replace', deploymentPrefix: '' }).sections[0].text, 'y')
assert.equal(applyPersonaMode(undefined, { mode: 'replace', deploymentPrefix: '' }), undefined)

// ── one workspace/session belongs to one persona: a new claim takes the row over
const store = { personas: [
  P({ id: 'a', name: '旧人设', targets: [T('workspace', 'exact', WS), T('sessionId', 'prefix', 'keep-')] }),
  P({ id: 'b', name: '无关人设', targets: [T('workspace', 'exact', OTHER)] }),
] }
const claimant = P({ id: 'c', name: '新人设', targets: [T('workspace', 'exact', WS)] })
assert.deepEqual(takeOverClaims(store, claimant), ['旧人设'])
assert.deepEqual(store.personas[0].targets, [T('sessionId', 'prefix', 'keep-')], 'only the taken row moves')
assert.deepEqual(store.personas[1].targets, [T('workspace', 'exact', OTHER)], 'other personas are untouched')
assert.deepEqual(takeOverClaims({ personas: [P({ id: 'a', targets: [] })] }, P({ id: 'b', targets: [] })), [], 'claiming nothing moves nothing')

// ── drag and drop reordering takes an absolute position
const order = () => store3.personas.map((persona) => persona.id)
const store3 = { version: 1, personas: [P({ id: 'a' }), P({ id: 'b' }), P({ id: 'c' })] }
assert.equal(reorderPersonas(store3, 'a', 2), true, 'moving down works')
assert.deepEqual(order(), ['b', 'c', 'a'])
assert.equal(reorderPersonas(store3, 'a', -9), true, 'a negative index clamps to the top')
assert.deepEqual(order(), ['a', 'b', 'c'])
assert.equal(reorderPersonas(store3, 'a', 99), true, 'an oversized index clamps to the bottom')
assert.deepEqual(order(), ['b', 'c', 'a'])
assert.equal(reorderPersonas(store3, 'a', 2), false, 'dropping where it already is changes nothing')
assert.equal(reorderPersonas(store3, 'ghost', 0), false, 'an unknown id is refused')
assert.deepEqual(order(), ['b', 'c', 'a'], 'and the order is untouched')

// ── the plugin through apply(): section, injection, heartbeat, live re-read
mkdirSync(stateDir, { recursive: true })
writeFileSync(storePath, JSON.stringify({
  version: 1,
  personas: [
    { id: 'a', name: 'im-bot', enabled: true, text: 'IM {{model}}', targets: [T('sessionId', 'prefix', 'im-bot-')] },
    { id: 'b', name: 'quiet-docs', enabled: true, text: '', targets: [T('workspace', 'exact', OTHER)] },
    { id: 'c', name: 'fallback', enabled: true, text: 'FALLBACK', targets: [] },
  ],
}))
const sections = []
const warnings = []
let assembleWaterfall
const fakeCtx = {
  logger: { info: () => {}, warn: (...args) => warnings.push(String(args[0])) },
  systemPrompt: { getSectionOrder: () => 0, section: (entry) => { sections.push(entry); return () => {} } },
  effect: (fn) => fn(),
  on: (name, handler) => {
    if (name === 'system-prompt/assemble') assembleWaterfall = handler
    return () => {}
  },
  get: () => { throw new Error('no service') },
}
mod.apply(fakeCtx, {})
assert.equal(sections.length, 1)
assert.equal(sections[0].name, 'agent-persona')
assert.equal(sections[0].order, 1, 'sits right above the persona slot')
const section = sections[0]
assert.equal(section.text({ agent: { session: { header: { id: 'im-bot-1a2b-g3', cwd: '/tmp/x' } } } }), 'IM {{model}}')
assert.equal(section.text({ agent: { session: { header: { id: 'session-9', cwd: OTHER } } } }), '', 'an empty persona silences')
assert.equal(section.text({ agent: { session: { header: { id: 'session-9', cwd: '/tmp/elsewhere' } } } }), '', 'a persona with no targets injects nothing')
assert.equal(section.text({}), '', 'and an agent-less assembly gets the harness prompt')

const beat = JSON.parse(readFileSync(heartbeatPath, 'utf8'))
assert.equal(beat.storePath, storePath, 'all files live in the plugin directory')
assert.equal(beat.storeVersion, 1)
assert.equal(beat.personas, 3)
assert.equal(beat.sectionOrder, 1)
assert.ok(/lib\/index\.js$/.test(beat.loadedModule), 'the heartbeat names the module it loaded')

// an edit on disk applies to the next assembly (stamp-based re-read)
writeFileSync(storePath, JSON.stringify({ version: 1, personas: [{ id: 'a', name: 'im-bot', enabled: true, text: 'EDITED', targets: [T('workspace', 'exact', '/tmp/x')] }] }))
const edited = new Date(Date.now() + 2000)
utimesSync(storePath, edited, edited)
assert.equal(section.text({ agent: { session: { header: { id: 'x', cwd: '/tmp/x' } } } }), 'EDITED')

// ── the waterfall end of replace mode, through the plugin's own listener
writeFileSync(storePath, JSON.stringify({
  version: 1,
  personas: [{ id: 'r', name: '替换型', enabled: true, text: 'REPLACED', mode: 'replace', targets: [T('workspace', 'exact', WS)] }],
}))
const stamp2 = new Date(Date.now() + 6000)
utimesSync(storePath, stamp2, stamp2)
assert.equal(typeof assembleWaterfall, 'function', 'the plugin listens to system-prompt/assemble')
let handedOn = 0
const downstreamAssembly = () => ({
  sections: [{ name: 'deployment:persona-prefix', text: 'BASE' }, { name: 'agent-persona', text: 'REPLACED' }],
  contexts: [], tools: [], variables: {},
})
const assemble = (cwd) => assembleWaterfall(
  downstreamAssembly(),
  { agent: { session: { header: { id: 'x', cwd } } } },
  () => { handedOn += 1; return downstreamAssembly() },
)
assert.equal((await assemble(WS)).sections[0].text, '', 'a replace persona drops the deployment persona for its workspace')
assert.equal((await assemble(WS)).sections[1].text, 'REPLACED')
assert.ok(handedOn >= 2, 'the waterfall calls next() instead of vetoing the chain')
assert.equal((await assemble('/tmp/elsewhere')).sections[0].text, 'BASE', 'other sessions are handed on untouched')

// a store that is not a persona store degrades to empty instead of throwing
writeFileSync(storePath, '{"nonsense": true}')
const broken = new Date(Date.now() + 4000)
utimesSync(storePath, broken, broken)
assert.equal(section.text({ agent: { session: { header: { id: 'x', cwd: '/tmp/x' } } } }), '')
assert.ok(warnings.some((message) => /not a persona store/.test(message)))

// ── the persona view reads the session's own log and the persona in force
const promptEvents = [
  { type: 'session/header', data: { id: 'pv1', cwd: WS } },
  { type: 'system/message', data: { message: { role: 'system', content: [{ type: 'text', text: 'FIRST PROMPT' }] } } },
  { type: 'user/message', data: { type: 'user/message', message: { content: [{ type: 'text', text: 'hello' }] } } },
  { type: 'system/message', data: { message: { role: 'system', content: [{ type: 'text', text: 'LAST PROMPT' }] } } },
]
const viewCtx = {
  get: (name) => (name === 'sessionPersistence'
    ? {
      list: async () => [{ header: { id: 'pv1', cwd: WS } }],
      open: async () => ({
        header: { cwd: WS },
        read: async (offset, length) => ({ events: promptEvents.slice(offset, offset + length), eventCount: promptEvents.length }),
      }),
    }
    : undefined),
}
assert.equal(await collectLastSystemPrompt(viewCtx, 'pv1'), 'LAST PROMPT', 'the last system prompt in the log wins')
assert.equal(await collectLastSystemPrompt({ get: () => undefined }, 'pv1'), null, 'and an unreadable log yields nothing')
const viewPersona = P({ id: 'pv', name: '人设甲', text: 'TEXT', targets: [T('workspace', 'exact', WS)] })
viewPersona.mode = 'replace'
const viewPayload = await sessionPromptFrom(viewCtx, 'pv1', [viewPersona])
assert.equal(viewPayload.persona.name, '人设甲', 'the view names the persona in force')
assert.equal(viewPayload.persona.mode, 'replace', 'with its mode')
assert.equal(viewPayload.persona.targets.length, 1, 'and its scope rules, so saving from the tab cannot drop them')
assert.equal(viewPayload.prompt, 'LAST PROMPT', 'plus the prompt the session actually sent')
assert.equal((await sessionPromptFrom(viewCtx, 'pv1', [])).persona, null, 'a session nothing matches reports no persona')

// ── every name the remote namespace exposes must be implemented by the service, or its
// route answers 500; a name missing from the namespace answers 404 (both were hit)
const hostSource = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
const exposed = (hostSource.match(/markRemote\(WorkspacePersonaService, \[([^\]]*)\]/) ?? [])[1]
const exposedNames = exposed === undefined ? [] : exposed.split(',').map((name) => name.trim().replace(/['"]/g, '')).filter(Boolean)
const serviceStart = hostSource.indexOf('class WorkspacePersonaService')
const serviceBrace = hostSource.indexOf('{', serviceStart)
let serviceDepth = 0
let serviceEnd = serviceBrace
for (let i = serviceBrace; i < hostSource.length; i += 1) {
  if (hostSource[i] === '{') serviceDepth += 1
  else if (hostSource[i] === '}') {
    serviceDepth -= 1
    if (serviceDepth === 0) { serviceEnd = i + 1; break }
  }
}
const serviceBody = hostSource.slice(serviceStart, serviceEnd)
const unimplemented = exposedNames.filter((name) => !new RegExp(`\\n\\s+async ${name}\\(`).test(serviceBody))
assert.deepEqual(unimplemented, [], `exposed methods with no service implementation: ${unimplemented.join(', ')}`)
assert.ok(exposedNames.length >= 10, `and the audit found the exposed methods (${exposedNames.length})`)
assert.ok(exposedNames.includes('sessionPrompt'), 'the persona view endpoint is exposed')


// ── the default persona is the opt-in fallback: it applies when nothing claimed a position, only one
// can hold the flag, and without one the harness prompt stands
const fallbackPersona = P({ id: 'fb', name: 'fb', text: 'FALLBACK', targets: [] })
fallbackPersona.fallback = true
assert.equal(resolvePersona([fallbackPersona], { cwd: WS, sessionId: 's1' }).persona.id, 'fb', 'it takes a session nothing claimed')
assert.equal(resolvePersona([fallbackPersona], { cwd: WS }).reason, 'fallback', 'and says why')
assert.equal(resolvePersona([fallbackPersona], {}).persona.id, 'fb', 'including an agent-less assembly')
const scopedPersona = P({ id: 'scoped', targets: [T('workspace', 'exact', WS)] })
assert.equal(resolvePersona([scopedPersona, fallbackPersona], { cwd: WS }).persona.id, 'scoped', 'a claimed position still wins')
assert.equal(resolvePersona([P({ id: 'plain', targets: [] })], { cwd: WS }).persona, undefined, 'a plain target-less persona does not')
fallbackPersona.enabled = false
assert.equal(resolvePersona([fallbackPersona], { cwd: WS }).persona, undefined, 'a disabled default is skipped')
fallbackPersona.enabled = true

console.log(JSON.stringify({
  ok: true,
  checks: 134,
  section: { name: section.name, order: section.order },
  stateDir,
}))
