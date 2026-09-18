/**
 * Guards the client's rendering choices by reading its source (the bundle registers
 * itself with the browser's module loader, so it cannot be imported into Node).
 * The conversation dialog must render messages with the same component the chat page
 * uses, and must not carry home-made escaping on top of it.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

assert.ok(source.includes('MarkdownText,'), 'the kit renderer available to plugins is imported')
assert.ok(source.includes('h(MarkdownText, { text: escapeUnknownTags(text) })'), 'and used on transcript-safe text')
for (const workaround of ['MessageText,', 'splitMarkdown', 'SafeChunk']) {
  assert.equal(source.includes(workaround), false, `${workaround} must not come back`)
}
assert.ok(source.includes('getDerivedStateFromError'), 'while a failed message still degrades to plain text instead of killing the page')

// re-reading the conversation must not clear the dialog (that unmounts it: a flash)
const head = source.slice(source.indexOf('async readHeadHistory()'), source.indexOf('async readTailHistory()'))
assert.equal(head.includes('history: undefined'), false, 'readHeadHistory must not clear the dialog while it re-reads')
assert.ok(head.includes("mode: 'head'"), 'and it replaces the contents in place')
// a clipped fragment that cannot render fetches its full text instead of staying broken
assert.ok(source.includes('onDegrade:'), 'a degraded bubble asks for the full message')
assert.ok(source.includes('degraded: message.expanded === true'), 'and asks only once')

// every component used in the file must actually be imported or defined here: an
// undefined element is React error #130, and that is exactly how the conflict
// banner crashed the page for a user whose personas overlapped.
const imported = new Set(source.slice(source.indexOf('const {'), source.indexOf('} = primitives')).split(/[\s,]+/).filter(Boolean))
const defined = new Set([...source.matchAll(/(?:class|const|function)\s+([A-Z][A-Za-z0-9]*)/g)].map((match) => match[1]))
const primitivesUsed = [...source.matchAll(/\bh\(([A-Z][A-Za-z0-9]*)/g)].map((match) => match[1])
const unresolved = [...new Set(primitivesUsed)].filter((name) => !imported.has(name) && !defined.has(name))
assert.deepEqual(unresolved, [], `these elements are used but never imported: ${unresolved.join(', ')}`)
assert.ok(primitivesUsed.length > 20, 'and the audit actually looked at the render calls')
const iconsUsed = [...new Set([...source.matchAll(/\b(Icon[A-Za-z0-9]+)\b/g)].map((match) => match[1]))]
const unresolvedIcons = iconsUsed.filter((name) => !imported.has(name) && !defined.has(name))
assert.deepEqual(unresolvedIcons, [], `these icons are used but never imported: ${unresolvedIcons.join(', ')}`)
assert.ok(iconsUsed.length > 8, 'and the icon audit saw the icons')

console.log(JSON.stringify({ ok: true, clientChecks: 7 }))
