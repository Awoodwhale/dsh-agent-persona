/**
 * Guards the client's rendering choices by reading its source: the bundle registers
 * itself with the browser's module loader, so it cannot be imported into Node.
 *
 * The rule this file exists for: the shared `MarkdownText` reads `labels.code` for every
 * code block, so a caller that passes only `text` throws on the messages that contain a
 * fence ("Cannot read properties of undefined (reading code)"). The dialog passes the
 * labels, and none of the workarounds that were tried before that diagnosis may return.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

// ── the renderer and its required props
assert.ok(source.includes('MarkdownText,'), 'the kit renderer available to plugins is imported')
assert.ok(
  source.includes("labels: { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '' }"),
  'and is called with the chrome labels it reads for each code block',
)
for (const gone of [
  'MessageText,',
  'splitMarkdown',
  'SafeChunk',
  'escapeUnknownTags',
  'fencesToHtml',
  'KNOWN_HTML_TAGS',
  'onDegrade',
  'wsp-warmup',
  'this.retry',
]) {
  assert.equal(source.includes(gone), false, `${gone} must not come back`)
}

// ── re-reading must not clear the dialog (that unmounts it: a flash)
const head = source.slice(source.indexOf('async readHeadHistory()'), source.indexOf('async readTailHistory()'))
assert.equal(head.includes('history: undefined'), false, 'readHeadHistory must not clear the dialog while it re-reads')
assert.ok(head.includes("mode: 'head'"), 'and it replaces the contents in place')

// ── a message that cannot render shows its text and the reason, without killing the page
assert.ok(source.includes('getDerivedStateFromError'), 'a failing message degrades instead of abdicating the slot')
assert.ok(source.includes('this.state.reason'), 'and the note names the reason')

// ── every element used must be imported or defined here: an undefined element is
// React error #130, which is how the conflict banner once crashed the page
const imported = new Set(source.slice(source.indexOf('const {'), source.indexOf('} = primitives')).split(/[\s,]+/).filter(Boolean))
const defined = new Set([...source.matchAll(/(?:class|const|function)\s+([A-Z][A-Za-z0-9]*)/g)].map((match) => match[1]))
const used = [...source.matchAll(/\bh\(([A-Z][A-Za-z0-9]*)/g)].map((match) => match[1])
const unresolved = [...new Set(used)].filter((name) => !imported.has(name) && !defined.has(name))
assert.deepEqual(unresolved, [], `these elements are used but never imported: ${unresolved.join(', ')}`)
assert.ok(used.length > 20, 'and the audit actually looked at the render calls')
// slot registrants are components too: they are passed as the second argument of
// ctx.slots.register, where the h(...) audit above cannot see them. An undefined one is the
// same React #130 as an undefined element.
const registrants = []
for (const match of source.matchAll(/slots\.register\(/g)) {
  const tail = source.slice(match.index, match.index + 900)
  const next = tail.match(/,\s*([A-Z][A-Za-z0-9_]*)\s*\)/)
  if (next !== null) registrants.push(next[1])
}
const unresolvedRegistrants = [...new Set(registrants)].filter((name) => !defined.has(name) && !imported.has(name))
assert.deepEqual(unresolvedRegistrants, [], `slot registrants that are never defined: ${unresolvedRegistrants.join(', ')}`)
assert.ok(registrants.length >= 4, `and the audit found the slot registrants (${registrants.length})`)
const iconsUsed = [...new Set([...source.matchAll(/\b(Icon[A-Za-z0-9]+)\b/g)].map((match) => match[1]))]
const unresolvedIcons = iconsUsed.filter((name) => !imported.has(name) && !defined.has(name))
assert.deepEqual(unresolvedIcons, [], `these icons are used but never imported: ${unresolvedIcons.join(', ')}`)
assert.ok(iconsUsed.length > 8, 'and the icon audit saw the icons')

// ── nothing inside the persona view's render may be used before it is declared:
// moving the tab row into the header shipped a TDZ ReferenceError (the page rendered as an
// empty scroll area) because `tabs` was still declared after `header`.
const personaClassAt = source.indexOf('class PersonaView')
const renderStart = source.indexOf('render() {', personaClassAt)
const renderEnd = source.indexOf("        return h('div', { className: 'wsp-view'", renderStart)
const renderBody = renderStart === -1 || renderEnd === -1 ? '' : source.slice(renderStart, renderEnd)
assert.ok(renderBody.length > 500, 'the persona view render body must be locatable')
const declared = [...renderBody.matchAll(/\n\s{8}const ([A-Za-z_$][A-Za-z0-9_$]*) =/g)].map((m) => ({ name: m[1], at: m.index }))
const misordered = []
for (const item of declared) {
  const use = renderBody.search(new RegExp(`(?<![A-Za-z0-9_$.])${item.name}(?![A-Za-z0-9_$])`))
  if (use !== -1 && use < item.at) misordered.push(item.name)
}
assert.deepEqual(misordered, [], `used before declaration in the view render: ${misordered.join(', ')}`)
assert.ok(declared.length > 3, 'and the check found the render locals')


// ── the sidebar is adapted through the sidebar plugin's own service, and only through it:
// dsh-better-sidebar owns the tab list (sidebarRightTabs.register + a guide entry is what
// appears there), and its absence must leave the plugin untouched.
assert.ok(source.includes("ctx.inject(['sidebarRightTabs']"), 'the sidebar tab service is injected')
assert.ok(source.includes('guide: ['), 'with a guide entry, which is what the sidebar lists')
assert.ok(source.includes("id: 'agent-persona',\n          kind: 'agent-persona'"), 'registered under our own id and kind')
for (const gone of ['sidebar.footer.action', 'shell.overlay', 'PersonaFooterAction', 'PersonaOverlay']) {
  assert.equal(source.includes(gone), false, `${gone} must not come back: the sidebar owns its own entry points`)
}


// ── state read inside the view's render must come out of this.state first: panelClass used
// tabFading without destructuring it, which threw a ReferenceError and emptied the whole tab.
const stateAt = source.indexOf('this.state = {', personaClassAt)
const stateKeys = [...source.slice(stateAt, source.indexOf('}', stateAt)).matchAll(/([a-zA-Z][a-zA-Z0-9]*)\s*:/g)].map((m) => m[1])
const destructured = (renderBody.match(/const \{([^}]*)\} = this\.state/) ?? [])[1]
const names = destructured === undefined ? [] : destructured.split(',').map((n) => n.trim())
const leaked = stateKeys.filter((key) => new RegExp(`(?<![.A-Za-z0-9_$])${key}(?![A-Za-z0-9_$])`).test(renderBody.replace(/this\.state\.\w+/g, '')) && !names.includes(key))
assert.deepEqual(leaked, [], `state fields used in the view render without destructuring: ${leaked.join(', ')}`)
assert.ok(stateKeys.length >= 8, `and the audit found the state fields (${stateKeys.length})`)


// ── a tab switch must not depend on anything asynchronous: the View Transitions API froze the
// page (its callback promise has to settle in time while React renders), and a two-phase state
// machine with timers can strand the panel at opacity 0. Both are out, and stay out.
for (const risky of ['startViewTransition', 'view-transition', 'tabFading', 'tabEntering', 'wsp-panel-out']) {
  assert.equal(source.includes(risky), false, `${risky} must not come back: a switch has to be a plain state change`)
}
const tabClick = source.slice(source.indexOf("onClick: () => {\n            if (item.id === tab) return"), source.indexOf('}, item.label)))'))
assert.ok(tabClick.includes('this.setState({ tab: item.id })'), 'the switch is one synchronous state change')
assert.equal(/setTimeout|requestAnimationFrame/.test(tabClick), false, 'with no timers or frames involved')


// ── interface preferences: where the page shows up, and whether edits save themselves
assert.ok(source.includes('const readPrefs = () =>'), 'preferences are read from storage')
assert.ok(source.includes('dsh-agent-persona.prefs'), 'under a namespaced key')
assert.ok(source.includes('if (prefs.showTab) ctx.slots.inject(\'conversation.view\''), 'the conversation tab is registered only when enabled')
assert.equal((source.match(/if \(prefs\.showSidebar\)/g) ?? []).length, 3, 'and the three sidebar seats follow their own switch')
assert.ok(source.includes('this.scheduleAutosave()'), 'a draft edit arms the autosave')
assert.ok(source.includes("if (this.state.prefs?.autosave !== true) return"), 'which stays idle unless the preference is on')
assert.ok(source.includes('clearTimeout(this.autosaveTimer)'), 'and its timer is cleared on unmount')


// ── the sidebar switch belongs to the sidebar plugin being installed
assert.ok(source.includes('let sidebarAvailable = false'), 'availability starts false')
assert.ok(source.includes('sidebarAvailable = true'), 'and is set where the sidebar service is injected')
assert.ok(/sidebarAvailable[\s\n]*\?\s*h\(Switch/.test(source), 'the switch is rendered only when it is available')


// ── autosave must not fire on a half-made choice: picking a workspace/session or adding a rule
// row is several clicks, and saving mid-way stores an empty row
assert.ok(source.includes('patchDraft(patch, options = {})'), 'the draft funnel takes an option')
assert.equal((source.match(/\{ autosave: false \}/g) ?? []).length, 3, 'the three rule-row edits opt out')
assert.ok(source.includes('clearTimeout(this.autosaveTimer)\n          this.autosaveTimer = undefined'), 'and a queued autosave is dropped when one of them happens')

console.log(JSON.stringify({ ok: true, clientChecks: 15 }))
