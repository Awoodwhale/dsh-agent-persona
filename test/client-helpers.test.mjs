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
const iconsUsed = [...new Set([...source.matchAll(/\b(Icon[A-Za-z0-9]+)\b/g)].map((match) => match[1]))]
const unresolvedIcons = iconsUsed.filter((name) => !imported.has(name) && !defined.has(name))
assert.deepEqual(unresolvedIcons, [], `these icons are used but never imported: ${unresolvedIcons.join(', ')}`)
assert.ok(iconsUsed.length > 8, 'and the icon audit saw the icons')

// ── nothing inside the persona view's render may be used before it is declared:
// moving the tab row into the header shipped a TDZ ReferenceError (the page rendered as an
// empty scroll area) because `tabs` was still declared after `header`.
const renderStart = source.indexOf("      render() {\n        const { data, draft, error, busy, loading, editing, copied, tab, promptView } = this.state")
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

console.log(JSON.stringify({ ok: true, clientChecks: 15 }))
