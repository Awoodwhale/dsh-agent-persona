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
const stateDir = join(home, 'dsh-workspace-persona')
const storePath = join(stateDir, 'personas.json')
const heartbeatPath = join(stateDir, 'state.json')

const mod = await import(new URL('../lib/index.js', import.meta.url).href)
const { collectTargets, matchTarget, resolvePersona, personaTextFor, sanitizePersona } = mod

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

// ── resolvePersona: order is priority, rows are OR-ed, catch-alls, disabled
const personas = [
  P({ id: 'specific', name: 'specific', targets: [T('sessionId', 'prefix', 'im-bot-')] }),
  P({ id: 'ws', name: 'ws', targets: [T('workspace', 'exact', WS), T('workspace', 'exact', OTHER)] }),
  P({ id: 'muted', name: 'muted', enabled: false, targets: [] }),
  P({ id: 'fallback', name: 'fallback', targets: [] }),
]
assert.equal(resolvePersona(personas, { cwd: WS, sessionId: 'im-bot-x' }).persona.id, 'specific', 'the first match wins')
assert.equal(resolvePersona(personas, { cwd: OTHER, sessionId: 'session-1' }).persona.id, 'ws', 'the second row of a persona also claims')
assert.equal(resolvePersona(personas, { cwd: '/tmp/elsewhere', sessionId: 'session-2' }).persona.id, 'fallback', 'a catch-all takes the rest')
assert.equal(resolvePersona(personas, {}).persona.id, 'fallback', 'an agent-less assembly also falls to the catch-all')
assert.equal(resolvePersona([P({ enabled: false, targets: [] })], { cwd: WS }).reason, 'none', 'disabled personas are skipped')
assert.equal(resolvePersona([], { cwd: WS }).reason, 'none')
assert.equal(resolvePersona([personas[1], personas[0], personas[2], personas[3]], { cwd: WS, sessionId: 'im-bot-x' }).persona.id, 'ws', 'reordering changes the winner')

// ── personaTextFor: an empty winning text means "no persona here"
const silencing = [P({ id: 'quiet', text: '', targets: [T('workspace', 'exact', WS)] }), P({ id: 'fallback', text: 'FALLBACK', targets: [] })]
assert.equal(personaTextFor(silencing, { session: { header: { id: 's1', cwd: WS } } }), '', 'an empty winner silences the catch-all')
assert.equal(personaTextFor(silencing, { session: { header: { id: 's2', cwd: OTHER } } }), 'FALLBACK')
const withVars = [P({ text: '模型 {{model}} 未知 {{nope}} 目录 {{cwd}}', targets: [] })]
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
const targets = await collectTargets(richCtx)
assert.deepEqual(targets.workspaces, [
  { path: WS, title: 'Web 应用', sessionCount: 2 },
  { path: OTHER, title: OTHER, sessionCount: 0 },
], 'workspaces keep their title and fall back to the path')
assert.deepEqual(targets.sessions.map((session) => session.id), ['s2', 's1'], 'sessions are newest first')
assert.equal(targets.sessions[0].title, '第二条会话', 'a session title rides along when the host can produce one')
assert.equal(targets.sessions[0].cwd, OTHER)

const bareWarnings = []
const bare = await collectTargets({ get: () => undefined }, (message) => bareWarnings.push(message))
assert.deepEqual(bare, { workspaces: [], sessions: [] }, 'a deployment without those services yields empty lists')
assert.equal(bareWarnings.length, 2, 'and says why (workspaces, sessions)')
assert.ok(bareWarnings.every((message) => /must be typed/.test(message)))

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
const fakeCtx = {
  logger: { info: () => {}, warn: (...args) => warnings.push(String(args[0])) },
  systemPrompt: { getSectionOrder: () => 0, section: (entry) => { sections.push(entry); return () => {} } },
  effect: (fn) => fn(),
  get: () => { throw new Error('no service') },
}
mod.apply(fakeCtx, {})
assert.equal(sections.length, 1)
assert.equal(sections[0].name, 'workspace-persona')
assert.equal(sections[0].order, 1, 'sits right above the persona slot')
const section = sections[0]
assert.equal(section.text({ agent: { session: { header: { id: 'im-bot-1a2b-g3', cwd: '/tmp/x' } } } }), 'IM {{model}}')
assert.equal(section.text({ agent: { session: { header: { id: 'session-9', cwd: OTHER } } } }), '', 'an empty persona silences')
assert.equal(section.text({ agent: { session: { header: { id: 'session-9', cwd: '/tmp/elsewhere' } } } }), 'FALLBACK')
assert.equal(section.text({}), 'FALLBACK', 'a catch-all also covers an assembly with no agent')

const beat = JSON.parse(readFileSync(heartbeatPath, 'utf8'))
assert.equal(beat.storePath, storePath, 'all files live in the plugin directory')
assert.equal(beat.storeVersion, 1)
assert.equal(beat.personas, 3)
assert.equal(beat.sectionOrder, 1)

// an edit on disk applies to the next assembly (stamp-based re-read)
writeFileSync(storePath, JSON.stringify({ version: 1, personas: [{ id: 'a', name: 'im-bot', enabled: true, text: 'EDITED', targets: [] }] }))
const edited = new Date(Date.now() + 2000)
utimesSync(storePath, edited, edited)
assert.equal(section.text({ agent: { session: { header: { id: 'x', cwd: '/tmp/x' } } } }), 'EDITED')

// a store that is not a persona store degrades to empty instead of throwing
writeFileSync(storePath, '{"nonsense": true}')
const broken = new Date(Date.now() + 4000)
utimesSync(storePath, broken, broken)
assert.equal(section.text({ agent: { session: { header: { id: 'x', cwd: '/tmp/x' } } } }), '')
assert.ok(warnings.some((message) => /not a persona store/.test(message)))

console.log(JSON.stringify({
  ok: true,
  checks: 52,
  section: { name: section.name, order: section.order },
  stateDir,
}))
