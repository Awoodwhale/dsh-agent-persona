import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'wsp2-'))
process.env.DSH_HOME = home
const stateDir = join(home, 'dsh-workspace-persona')
const storePath = join(stateDir, 'personas.json')
const legacyStorePath = join(home, 'workspace-personas.json')
const heartbeatPath = join(stateDir, 'state.json')

const mod = await import(new URL('../lib/index.js', import.meta.url).href)
const { matchTarget, resolvePersona, personaTextFor, migrateStore, sanitizePersona } = mod

const WS = '/tmp/ws/infoflow'
const OTHER = '/tmp/ws/agentdir'
const P = (over) => ({ id: over.id ?? 'p', name: over.name ?? 'p', enabled: over.enabled !== false, text: over.text ?? 'T', targets: over.targets ?? [] })
const T = (kind, match, value) => ({ kind, match, value })

// ── matchTarget: kinds × modes
assert.equal(matchTarget(T('workspace', 'exact', WS), { cwd: WS }), true)
assert.equal(matchTarget(T('workspace', 'exact', WS), { cwd: OTHER }), false)
assert.equal(matchTarget(T('workspace', 'exact', WS + '/'), { cwd: WS }), true, 'trailing slash tolerated')
assert.equal(matchTarget(T('workspace', 'prefix', '/tmp/ws'), { cwd: WS }), true)
assert.equal(matchTarget(T('workspace', 'prefix', '/tmp/ws/'), { cwd: WS }), true, 'absolute prefix')
assert.equal(matchTarget(T('workspace', 'contains', 'infoflow'), { cwd: WS }), true)
assert.equal(matchTarget(T('workspace', 'regex', '/ws/(infoflow|agentdir)$'), { cwd: WS }), true)
assert.equal(matchTarget(T('sessionId', 'exact', 'infoflow-3743-g3'), { sessionId: 'infoflow-3743-g3' }), true)
assert.equal(matchTarget(T('sessionId', 'prefix', 'infoflow-'), { sessionId: 'infoflow-3743-g3' }), true)
assert.equal(matchTarget(T('sessionId', 'prefix', 'infoflow-'), { sessionId: 'session-1' }), false)
assert.equal(matchTarget(T('sessionId', 'regex', '^infoflow-.*-g[0-9]+$'), { sessionId: 'infoflow-3743-g3' }), true)
assert.equal(matchTarget(T('sessionId', 'contains', '3743'), { sessionId: 'infoflow-3743-g3' }), true)
// unusable targets never match
assert.equal(matchTarget(T('workspace', 'exact', ''), { cwd: WS }), false, 'empty value')
assert.equal(matchTarget(T('sessionId', 'regex', '(['), { sessionId: 'x' }), false, 'bad regex')
assert.equal(matchTarget(T('workspace', 'exact', WS), {}), false, 'missing subject field')

// ── resolvePersona: order = priority, OR inside a persona, catch-all, disabled, silence
const personas = [
  P({ id: 'specific', name: 'specific', targets: [T('sessionId', 'prefix', 'infoflow-')] }),
  P({ id: 'ws', name: 'ws', targets: [T('workspace', 'exact', WS), T('workspace', 'exact', OTHER)] }),
  P({ id: 'muted', name: 'muted', enabled: false, targets: [] }),
  P({ id: 'fallback', name: 'fallback', targets: [] }),
]
assert.equal(resolvePersona(personas, { cwd: WS, sessionId: 'infoflow-x' }).persona.id, 'specific', 'first match wins')
assert.equal(resolvePersona(personas, { cwd: OTHER, sessionId: 'session-1' }).persona.id, 'ws', 'second workspace target also claims it')
assert.equal(resolvePersona(personas, { cwd: '/tmp/elsewhere', sessionId: 'session-2' }).persona.id, 'fallback', 'catch-all catches the rest')
assert.equal(resolvePersona(personas, {}).persona.id, 'fallback', 'agent-less assembly falls to the catch-all')
assert.equal(resolvePersona([P({ enabled: false, targets: [] })], { cwd: WS }).reason, 'none', 'disabled is skipped')
assert.equal(resolvePersona([], { cwd: WS }).reason, 'none')

// priority is order: flip the two claimants
const flipped = [personas[1], personas[0], personas[2], personas[3]]
assert.equal(resolvePersona(flipped, { cwd: WS, sessionId: 'infoflow-x' }).persona.id, 'ws', 'order decides')

// ── personaTextFor: winning-but-empty means silence (not "keep looking")
const silencing = [P({ id: 'quiet', text: '', targets: [T('workspace', 'exact', WS)] }), P({ id: 'fallback', text: 'FALLBACK', targets: [] })]
assert.equal(personaTextFor(silencing, { session: { header: { id: 's1', cwd: WS } } }), '', 'empty winner silences')
assert.equal(personaTextFor(silencing, { session: { header: { id: 's2', cwd: OTHER } } }), 'FALLBACK')
// variables kept, unknown de-braced
const withVars = [P({ text: '模型 {{model}} 未知 {{nope}} 目录 {{cwd}}', targets: [] })]
const out = personaTextFor(withVars, { session: { header: { id: 's3', cwd: WS } } })
assert.ok(out.includes('{{model}}') && out.includes('{{cwd}}'), 'allowed variables survive')
assert.ok(!out.includes('{{nope}}') && out.includes('nope'), 'unknown variable de-braced')
const stray = sanitizePersona('a {{ }} b {{ b')
assert.ok(!stray.includes('{{') && !stray.includes('}}'), 'stray braces never survive')
assert.ok(/^a\s+b\s+b$/.test(stray), `letters survive, got ${JSON.stringify(stray)}`)

// ── migration from the v1 document
const v1 = {
  version: 1,
  default: { enabled: false, text: '' },
  workspaces: [
    { path: WS, title: 'infoflow', enabled: true, text: 'IFLOW', sessionPrefixes: ['infoflow-'] },
    { path: OTHER, title: 'AgentDir', enabled: false, text: '', sessionPrefixes: [] },
  ],
}
const warnings = []
const { store, report } = migrateStore(v1, (m) => warnings.push(m))
assert.equal(store.version, 2)
assert.equal(store.personas.length, 1, 'empty+disabled v1 entry dropped')
assert.equal(store.personas[0].name, 'infoflow')
assert.equal(store.personas[0].text, 'IFLOW')
assert.deepEqual(store.personas[0].targets, [
  { kind: 'workspace', match: 'exact', value: WS },
  { kind: 'sessionId', match: 'prefix', value: 'infoflow-' },
])
assert.equal(report.dropped.length, 1)
assert.ok(warnings.some((w) => /migrated/.test(w)))
// a v1 default with content becomes a catch-all persona
const withDefault = migrateStore({ version: 1, default: { enabled: true, text: 'D' }, workspaces: [] })
assert.deepEqual(withDefault.store.personas.map((p) => [p.name, p.targets.length]), [['默认人设（v1 兜底）', 0]])
// v2 documents round-trip untouched
const v2 = { version: 2, personas: [{ id: 'x', name: 'n', enabled: true, text: 't', targets: [T('workspace', 'exact', WS)] }] }
assert.equal(migrateStore(v2).report, undefined)
assert.equal(migrateStore(v2).store.personas[0].targets[0].match, 'exact')

// ── legacy layout adoption: loose files under $DSH_HOME move into the plugin dir
writeFileSync(legacyStorePath, JSON.stringify({
  version: 1,
  default: { enabled: false, text: '' },
  workspaces: [{ path: WS, title: 'legacy-ws', enabled: true, text: 'FROM LEGACY', sessionPrefixes: ['legacy-'] }],
}))
writeFileSync(join(home, 'workspace-persona.state.json'), '{"loadedAt":"old"}')
const migrations = []
const adoptingCtx = {
  logger: { info: () => {}, warn: (m) => migrations.push(m) },
  systemPrompt: { getSectionOrder: () => 0, section: () => () => {} },
  effect: (fn) => fn(),
  get: () => { throw new Error('no service') },
}
mod.apply(adoptingCtx)
assert.ok(existsSync(storePath), 'legacy data was written to the new location')
assert.ok(!existsSync(legacyStorePath), 'legacy data file was moved away')
assert.ok(existsSync(join(stateDir, 'personas.legacy.bak.json')), 'a backup of the legacy file was kept')
assert.ok(!existsSync(join(home, 'workspace-persona.state.json')), 'the old heartbeat was removed')
assert.deepEqual(JSON.parse(readFileSync(storePath, 'utf8')).personas.map((p) => [p.name, p.text]), [['legacy-ws', 'FROM LEGACY']])
assert.ok(migrations.some((m) => /moved the old store/.test(m)))

// ── live store read by the plugin: catch-all + silence + priority through apply()
writeFileSync(storePath, JSON.stringify({
  version: 2,
  personas: [
    { id: 'a', name: 'infoflow', enabled: true, text: 'IFLOW {{model}}', targets: [T('sessionId', 'prefix', 'infoflow-')] },
    { id: 'b', name: 'quiet-agentdir', enabled: true, text: '', targets: [T('workspace', 'exact', OTHER)] },
    { id: 'c', name: 'fallback', enabled: true, text: 'FALLBACK', targets: [] },
  ],
}))
const sections = []
const fakeCtx = {
  logger: { info: () => {}, warn: () => {} },
  systemPrompt: { getSectionOrder: () => 0, section: (s) => { sections.push(s); return () => {} } },
  effect: (fn) => fn(),
  get: () => { throw new Error('no service') },
}
mod.apply(fakeCtx)
assert.equal(sections.length, 1)
assert.equal(sections[0].name, 'workspace-persona')
assert.equal(sections[0].order, 1)
const section = sections[0]
assert.equal(section.text({ agent: { session: { header: { id: 'infoflow-3743-g3', cwd: '/tmp/x' } } } }), 'IFLOW {{model}}')
assert.equal(section.text({ agent: { session: { header: { id: 'session-9', cwd: OTHER } } } }), '', 'quiet workspace silences')
assert.equal(section.text({ agent: { session: { header: { id: 'session-9', cwd: '/tmp/elsewhere' } } } }), 'FALLBACK')
const beat = JSON.parse(readFileSync(heartbeatPath, 'utf8'))
assert.equal(beat.personas, 3)
assert.equal(beat.storeVersion, 2)
assert.equal(beat.storePath, storePath, 'heartbeat names the store it read')

console.log(JSON.stringify({ ok: true, checks: 48, section: { name: section.name, order: section.order }, migrated: report.migrated, dropped: report.dropped }))
