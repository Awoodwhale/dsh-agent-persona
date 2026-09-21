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

// Count the assertions that actually run, so the reported number cannot drift behind the file.
let assertions = 0
for (const name of ['equal', 'deepEqual', 'ok', 'match', 'notEqual', 'throws']) {
  const original = assert[name]
  assert[name] = (...args) => {
    assertions += 1
    return original(...args)
  }
}

const source = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')

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
assert.ok(registrants.length >= 2, `and the audit found the slot registrants (${registrants.length})`)
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


// ── the sidebar card goes through the sidebar plugin's own service, the way the working third-party
// plugin in this deployment does. sidebarRightTabs is not a path a plugin can use: dsh-context registers
// through it and its card is missing from the sidebar's 侧边栏内容 list.
assert.ok(source.includes("ctx.get('betterSidebar')"), 'the sidebar service is resolved')
assert.ok(source.includes('service.registerTab({'), 'and the card registered through its registerTab')
// The service must be awaited rather than read once: plugin load order is not guaranteed, so after a restart
// our client half can apply before the sidebar plugin provides its service. Reading it once and giving up left
// the card missing until the switch was toggled by hand, while the switch still showed true from the store.
assert.ok(source.includes("ctx.inject(['betterSidebar'], (sidebarCtx) => {"), 'a late provider is waited for')
assert.ok(source.includes('sidebarCtx.effect(() => {'), 'and that registration is bound to the arriving context')
assert.ok(source.includes('syncSidebarModule = () => mountTab(sidebarService ?? resolveSidebar())'), 'the switch reuses the service it already resolved, falling back to a fresh resolve')
assert.ok(source.includes("title: () => 'Agent 人设'"), 'with our own title')
assert.equal(source.includes("ctx.inject(['sidebarRightTabs']"), false, 'the unusable path is gone')
assert.ok(source.includes('id: NS,'), 'registered under our own id (registerTab takes no kind)')
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
assert.equal((source.match(/if \(prefs\.showSidebar\)/g) ?? []).length, 0, 'the sidebar is no longer gated at load')
assert.ok(source.includes('readPrefs().showSidebar === false'), 'the tab type follows the switch at runtime instead')
assert.ok(source.includes('betterSidebar'), "and turning it on places the module through the sidebar plugin's service")
assert.ok(source.includes('this.scheduleAutosave()'), 'a draft edit arms the autosave')
assert.ok(source.includes("if (this.state.prefs?.autosave !== true) return"), 'which stays idle unless the preference is on')
assert.ok(source.includes('clearTimeout(this.autosaveTimer)'), 'and its timer is cleared on unmount')


// ── the sidebar switch belongs to the sidebar plugin being installed
assert.ok(source.includes('let sidebarAvailable = false'), 'availability starts false')
assert.ok(source.includes("typeof service.registerTab === 'function'"), 'and is set from the sidebar service that is actually usable')
assert.ok(source.includes('syncSidebarModule = () => mountTab('), 'with a synchroniser the preference can call')
assert.equal(/sidebarAvailable[\s\n]*\?\s*h\(Switch/.test(source), false, 'the switches are always rendered, never gated on availability')


// ── autosave must not fire on a half-made choice: picking a workspace/session or adding a rule
// row is several clicks, and saving mid-way stores an empty row
assert.ok(source.includes('patchDraft(patch, options'), 'the draft funnel takes an option')
assert.equal((source.match(/\{ autosave: false \}/g) ?? []).length, 3, 'the three rule-row edits opt out')
assert.ok(source.includes('clearTimeout(this.autosaveTimer)\n          this.autosaveTimer = undefined'), 'and a queued autosave is dropped when one of them happens')


// ── the list switch writes to the store, so an open card's draft must follow it: otherwise the card
// reads as 未保存 and saving puts the old value back, silently undoing the switch
assert.ok(source.includes('const openDraft = this.state.openId === persona.id'), 'the switch syncs the open draft')
assert.ok(source.includes('...(openDraft === undefined ? {} : { draft: openDraft })'), 'and hands it to the same state update as the view')


// ── the default-persona switch has to take part in the change tracking and in the save payload,
// otherwise flipping it looks inert: no dirty state, no autosave, nothing written
assert.ok(source.includes('f: value.fallback === true'), 'the draft fingerprint compares the flag')
assert.ok((source.match(/fallback: draft\.fallback === true/g) ?? []).length >= 2, 'and both editors send it')


// ── the persona list the cards read must carry the default flag: the switch showed off after saving
// because the field had landed on the workspace/session rows instead
const hostSrc = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
const viewAt = hostSrc.indexOf('const view = () =>')
const viewBody = hostSrc.slice(viewAt, hostSrc.indexOf('\n  }', viewAt))
assert.ok(viewBody.includes('fallback: persona.fallback === true'), 'the view payload carries the flag')
assert.equal(viewBody.includes('noTargets: persona.targets.length === 0'), true, 'beside the other derived fields')


// ── the 人设 tab marks the default persona, and only when it is one
const viewClassAt = source.indexOf('class PersonaView')
const chipRegion = source.slice(viewClassAt, source.indexOf('class ', viewClassAt + 10))
assert.ok(chipRegion.includes("'默认人设'"), 'the persona tab shows the default tag')
assert.ok(chipRegion.includes('persona.fallback === true'), 'only for the persona that holds the flag')


// ── the generated artifacts must keep the shapes their consumers expect. Getting this wrong is what
// broke the boot: the generator emitted an invented { package, descriptors } object, the typert loader
// found no manifest and refused the plugin tree ("no TYPERT manifest object"). The contract now has a
// test, so a future generator edit cannot quietly return to a made-up shape.
const manifest = readFileSync(new URL('../src/typert.ts', import.meta.url), 'utf8')
assert.ok(manifest.includes('face: "host"'), 'the manifest declares the face the loader reads')
assert.ok(manifest.includes('model:'), 'and a model block')
assert.ok(manifest.includes('invocations:'), 'holding one invocation per endpoint')
assert.ok(manifest.includes('from "zod"') || manifest.includes("from 'zod'"), 'with zod codecs')
assert.ok(manifest.includes('name: "listPersonas"'), 'and a member entry per endpoint')
const remote = readFileSync(new URL('../src/remote.ts', import.meta.url), 'utf8')
assert.ok(remote.includes('export const RPC_REMOTE'), 'the remote artifact exports the object the client mounts')
// ── the descriptor manifest must name the service the host registers. Filling these two fields with
// the package name instead mounts the namespace under a key nothing ever looks up: the page renders,
// every read stays pending, and nothing reports an error.
const endpointsSrc = readFileSync(new URL('../src/endpoints.ts', import.meta.url), 'utf8')
const serviceName = (endpointsSrc.match(/RPC_SERVICE = '([^']+)'/) ?? [])[1]
assert.equal(serviceName, 'agentPersona', 'the single source declares the service name')
assert.ok(source.includes("from './remote.js'"), 'the client mounts the descriptor manifest')
assert.ok(source.includes('$mount(RPC_REMOTE)'), 'passing it to the remote service')
assert.ok(readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8').includes(`super(ctx, '${serviceName}')`), 'which is what the host registers')
assert.ok(remote.includes(`service: "${serviceName}"`), 'the generated remote names that service')
assert.ok(remote.includes(`namespace: "${serviceName}"`), 'under that namespace')
assert.equal(remote.includes('service: "dsh-agent-persona"'), false, 'never the package name')


// ── the view's own draft and dirty check must cover the default flag. Without it the card's switch
// looked inert and saving wrote the stored value back, which is the bug the user kept hitting.
const viewAt2 = source.indexOf('class PersonaView')
const viewBody2 = source.slice(viewAt2, source.indexOf('class ', viewAt2 + 10))
assert.ok(/fallback: data\.persona\.fallback === true/.test(viewBody2), "the view's draft carries the flag")
assert.ok(/draft\.fallback === true\) !== \(persona\.fallback === true\)/.test(viewBody2), 'and its dirty check compares it')


// ── the view has patch(), the settings component has patchDraft(); calling the other one throws
// inside an event handler, so the control simply does nothing and nothing is reported anywhere.
const pvAt = source.indexOf('class PersonaView')
const pvBody = source.slice(pvAt, source.indexOf('class ', pvAt + 10))
const setAt = source.indexOf('class WorkspacePersonaSection')
const setBody = source.slice(setAt, source.indexOf('class ', setAt + 10))
assert.equal(pvBody.includes('this.patchDraft('), false, 'the view must not call the settings-only patchDraft')
assert.equal(setBody.includes('this.patch('), false, 'and the settings component must not call the view-only patch')
assert.ok(pvBody.includes('patch(patch) {'), 'the view has patch()')
assert.ok(setBody.includes('patchDraft(patch'), 'the settings component has patchDraft()')


// ── preferences live in the store file with the personas; localStorage is only the load-time mirror
assert.ok(source.includes("typeof api.savePrefs !== 'function'"), 'a preference save goes through the host')
assert.ok(source.includes('writePrefs(view.prefs)'), 'and every view refreshes the local mirror')
assert.ok(source.includes('store is the source of truth for preferences'), 'which the comment states, so nobody mistakes the mirror for the truth')


// ── the switches live on the settings page only, and that seat must stay ungated: it is the way back
// from them, since the conversation tab and the sidebar card can both be switched off from there.
assert.equal(source.includes("ctx.slots.inject('settings.general.item'"), false, 'General settings does not carry this plugin')
const settingsSeat = source.slice(source.indexOf("ctx.slots.inject('settings.section'"), source.indexOf('}, WorkspacePersonaSection'))
assert.equal(/if \(prefs\./.test(settingsSeat), false, 'and the settings seat is registered unconditionally')
assert.ok(source.includes('const persistPrefs = (api, unwrap, current, patch, report)'), 'both surfaces share one save implementation')
assert.ok(source.includes('persistPrefs(this.api(), (result) => this.unwrap(result)'), 'which the settings page uses')


// ── without the sidebar plugin there is no sidebar to register into, so that switch must not appear.
// It is resolved live rather than once at load, so plugin ordering cannot hide it by mistake.
assert.ok(source.includes('let sidebarProbe = () => undefined'), 'the probe exists')
assert.ok(source.includes('sidebarProbe = () => {'), 'and is assigned in apply')
assert.ok(source.includes("return ctx.get('betterSidebar')"), 'probing the sidebar plugin itself')
assert.equal((source.match(/sidebarProbe\(\) === undefined/g) ?? []).length, 1, 'the settings page gates that one switch on it')

// ── the project links beside the settings title carry the real brand marks, inlined rather than
// borrowed from the component library (which ships none), and the version chip reports the copy that
// is actually running rather than a string written into the source.
assert.ok(source.includes('M12 .297c-6.63'), 'the GitHub mark is inlined')
assert.ok(source.includes('M1.763 0C.786 0'), 'the npm mark is inlined')
assert.equal((source.match(/fill: 'currentColor'/g) ?? []).length, 2, 'both marks take the pill colour, so no colour is hardcoded')
assert.ok(source.includes("href: 'https://github.com/Awoodwhale/dsh-agent-persona'"), 'the GitHub link is the repository')
assert.ok(source.includes("href: 'https://www.npmjs.com/package/dsh-agent-persona'"), 'the npm link is the package page')
const hostSourceForVersion = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
assert.ok(hostSourceForVersion.includes("new URL('../package.json', import.meta.url)"), 'the host reads its own manifest for the version')
assert.ok(hostSourceForVersion.includes('pluginVersion: PLUGIN_INFO.version'), 'and reports it in the view')
assert.ok(hostSourceForVersion.includes('installOrigin: PLUGIN_INFO.origin'), 'along with whether this copy came from npm or a checkout')
assert.equal(/pluginVersion: '0\./.test(hostSourceForVersion), false, 'never a version string baked into the source')

// ── the page explains a store it could not read, and offers the two transfer actions without a new
// endpoint: export is built from the view the page already holds, and import reuses savePersona so every
// document passes the host's own validation instead of a second, weaker reader on this side.
assert.ok(source.includes("health.status === 'reset'"), 'the page distinguishes a reset store from an empty one')
assert.ok(source.includes('已保留读不出来的人设文件'), 'and reports where the original was preserved')
assert.ok(source.includes('personas.json.bak-<时间戳>'), 'and tells the user what the next save will do')
assert.ok(source.includes('const exportDocument = (personas) => ({'), 'export builds a portable document')
assert.equal(/exportDocument[\s\S]{0,600}?id: persona\.id/.test(source), false, 'which leaves the local ids out')
assert.ok(source.includes('URL.createObjectURL(new Blob('), 'and hands it to the browser as a download')
assert.ok(source.includes('const parseImportDocument = (text) => {'), 'import parses the document on this side')
assert.ok(source.includes("throw new Error('不是合法的 JSON')"), 'and says so when it is not JSON')
assert.ok(source.includes('await api.savePersona({\n              name: item.name,'), 'while the write itself goes through savePersona')
assert.ok(source.includes('enabled: false,\n              mode: item.mode,'), 'every imported persona arrives disabled')
assert.equal(/importPersonas|api\.importPersonas/.test(source), false, 'and no new endpoint was invented for it')
// The dialog reads as you type instead of hiding everything behind a button, and the file picker is a real
// button driving a hidden input — a bare <input type=file> renders as the browser's own control.
assert.equal(source.includes('previewImport()'), false, 'no button has to be pressed before anything appears')
assert.ok(source.includes('onImportText(value) {'), 'typing goes through a debounced reader')
assert.ok(source.includes('this.importTimer = setTimeout(() => this.parseImportText(value, seq, next), 300)'), 'which waits for the text to settle')
assert.ok(source.includes('clearTimeout(this.importTimer)'), 'and is cleared on unmount and on close')
// The parse must not read state: setState is asynchronous, so a file picked a moment ago would still look
// empty and the preview would silently never appear (that is what the sequence token replaced).
assert.ok(source.includes('parseImportText(value, seq, base) {'), 'the parse is handed its base and a token')
assert.ok(source.includes('seq !== this.importSeq'), 'and drops a run a newer input has superseded')
assert.equal(/parseImportText[\s\S]{0,200}?this\.state\.transfer/.test(source), false, 'so it never reads the async state back')
assert.ok(source.includes("className: 'wsp-import-file'"), 'the file input stays hidden')
assert.ok(source.includes('icon: h(IconFolderOpen16, {})'), 'while a real button with an icon opens it')
assert.ok(source.includes('this.importFileRef.current?.click()'), 'by forwarding the click to that input')
assert.ok(source.includes("input.value = ''"), 'and the same file can be chosen again after an error')
// The JSON in that box is coloured, and its scrollbar is themed and inset rather than the platform default
// hugging the frame.
assert.ok(source.includes('const highlightJson = (text) => {'), 'the box has a JSON highlighter')
assert.ok(source.includes("className: 'wsp-import-highlight'"), 'painted as a copy behind a real textarea')
assert.ok(source.includes('color: transparent; caret-color: var(--wsp-text)'), 'so the textarea stays editable with its own text hidden')
assert.ok(source.includes('syncImportScroll(source) {'), 'and the copy is kept in step while scrolling')
assert.ok(source.includes('text.length > HIGHLIGHT_LIMIT'), 'with a size cut-off, so a huge paste is not re-tokenised')
assert.ok(source.includes('.wsp-import-modal ::-webkit-scrollbar-thumb'), 'the dialog draws its own scrollbar')
assert.ok(source.includes('padding-right: 14px'), 'and its scrollbar is inset from the frame')
// Collapsing and expanding a card is the standard CSS accordion: one grid row interpolating 0fr to 1fr, one
// easing and one duration for both directions, no timer, no unmount, no scripting.
assert.ok(source.includes('grid-template-rows: minmax(0, 0fr);'), 'the closed state is a zero-height grid row')
assert.ok(source.includes('grid-template-rows: minmax(0, 1fr);'), 'and the open state is its content height')
assert.ok(source.includes('transition: grid-template-rows 240ms ease, visibility 0s linear 240ms;'), 'one easing and one duration close it')
assert.ok(source.includes('transition: grid-template-rows 240ms ease, visibility 0s;'), 'and the same pair opens it')
assert.equal(/transition:[^;]*grid-template-rows[^;]*(cubic-bezier|linear)\(/.test(source), false, 'no custom curve is layered on the row')
assert.equal(/\.wsp-card-body-wrap[^}]*opacity/.test(source), false, 'and no second property competes with the height')
assert.equal(/@keyframes wsp-(card-open|body-in|body-out)/.test(source), false, 'no keyframe animation is left for the card')
assert.equal(/clearTimeout\(this\.closeTimer\)|closingId/.test(source), false, 'and no timer or closing state is left in the component')
// The item clips its own overflow and may carry no padding or border: an fr track's minimum is its content, and
// the body's padding was the 27px the collapse used to stall at. Its child must be plain block flow, because a
// flex container resizes its rows on every frame as the height falls.
assert.ok(source.includes('.wsp-card-body { display: block; overflow: hidden; min-height: 0;'), 'the item clips and stays shrinkable')
assert.ok(source.includes('.wsp-card-body-inner { display: flex; flex-direction: column; gap: 12px; padding: 12px 14px 14px;'), 'with the padding and the flex column one level in')
assert.ok(source.includes("h('div', { className: 'wsp-card-body-inner', key: 'inner' }, ["), 'and that inner box is what the body renders')
assert.equal(/\.wsp-card-body-wrap[^}]*align-self/.test(source), false, 'the item is stretched, not start-aligned')
// The wrapper must stay in the document for a transition to run, so every card renders a body.
assert.ok(source.includes("className: 'wsp-card-body-wrap',"), 'the wrapper is rendered unconditionally')
assert.ok(source.includes('const draft = (isOpen ? state.draft : undefined) ?? this.draftFrom(persona)'), 'a closed card falls back to the stored values')
assert.equal(/\.wsp-card-body-wrap[^}]*transform/.test(source), false, 'no transform is animated, which would capture the fixed tooltips')
assert.ok(source.includes('.wsp-card-body-wrap, .wsp-card-open .wsp-card-body-wrap { transition: none; }'), 'and reduced motion turns the transition off')
// The scope line belongs to the collapsed card, so it collapses in the opposite direction — and leaves the tab
// order with its own visibility transition, exactly like the body. Mounting it with the state instead made the
// whole card jump by its height the instant a card opened.
assert.ok(source.includes('.wsp-card-open .wsp-scope-lines {'), 'the scope line collapses with the card open')
assert.ok(source.includes('grid-template-rows: minmax(0, 0fr);\n  visibility: hidden;'), 'and is hidden, not merely zero-height')
assert.ok(source.includes('visibility 0s linear 240ms;\n}'), 'once its transition is over')
assert.ok(source.includes('            scopeLines(persona),'), 'it is rendered unconditionally, so it can animate')
assert.equal(/state\.openId === persona\.id \? null : scopeLines\(persona\)/.test(source), false, 'and never mounted and unmounted with the state')
// A switch whose tooltip only repeats its own label explains nothing, and a label like 保护人设文件 does not
// say what is protected from whom.
assert.ok(source.includes('const Switch = ({ checked, disabled, label, hint, onChange })'), 'switches can carry an explanation')
assert.ok(source.includes("title: hint === undefined ? label : undefined"), 'which replaces the label-as-title when present')
assert.ok(source.includes('h(Tooltip, { label: hint, side: \'top\', delayMs: 260, maxWidth: 320 }, control)'), 'rendered as a real tooltip')
assert.ok(source.includes("'aria-label': hint === undefined ? label : `${label}：${hint}`"), 'and folded into the accessible name')
assert.ok(source.includes('label: \'禁止模型改写人设文件\''), 'the guard switch says who is forbidden')
assert.ok(source.includes('模型的文件与命令工具不能写入或删除人设存储'), 'and its explanation says what is blocked')
assert.ok(source.includes('这是行为层面的限制，不是安全边界'), 'and what it is not')
// A filled animation that ends with a transform keeps an identity matrix, which is still a transform and
// therefore a containing block for the kit's fixed-position tooltips: opening one inside the view or the
// sidebar card put the bubble in the wrong place. Every animation here must fill backwards instead.
// Comments are stripped first: this file's own explanation mentions the trap by name.
const cssOnly = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
assert.equal(/animation:[^;]*\bboth\b/.test(cssOnly), false, 'no animation uses fill-mode both')
assert.ok(source.includes('animation: wsp-enter 260ms cubic-bezier(0.22, 1, 0.36, 1) backwards'), 'the panel enters with a backwards fill')
assert.ok(source.includes('transform: none; } }'), 'and its last keyframe is an explicit transform: none')

console.log(JSON.stringify({ ok: true, clientChecks: assertions }))
