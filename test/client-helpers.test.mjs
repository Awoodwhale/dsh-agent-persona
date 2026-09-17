/**
 * Guards the client's rendering choices by reading its source (the bundle registers
 * itself with the browser's module loader, so it cannot be imported into Node).
 * The conversation dialog must render messages with the same component the chat page
 * uses, and must not carry home-made escaping on top of it.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

assert.ok(source.includes('MessageText,'), 'the transcript component is imported from the kit')
assert.ok(source.includes('h(MessageText, { text })'), 'and used for message bodies')
for (const workaround of ['splitMarkdown', 'escapeUnknownTags', 'SafeChunk', 'MarkdownText,']) {
  assert.equal(source.includes(workaround), false, `${workaround} must not come back: the dialog renders like the chat page`)
}
assert.ok(source.includes('getDerivedStateFromError'), 'while a failed message still degrades to plain text instead of killing the page')

// every component used in the file must actually be imported or defined here: an
// undefined element is React error #130, and that is exactly how the conflict
// banner crashed the page for a user whose personas overlapped.
const imported = new Set(source.slice(source.indexOf('const {'), source.indexOf('} = primitives')).split(/[\s,]+/).filter(Boolean))
const defined = new Set([...source.matchAll(/(?:class|const|function)\s+([A-Z][A-Za-z0-9]*)/g)].map((match) => match[1]))
const primitivesUsed = [...source.matchAll(/\bh\(([A-Z][A-Za-z0-9]*)/g)].map((match) => match[1])
const unresolved = [...new Set(primitivesUsed)].filter((name) => !imported.has(name) && !defined.has(name))
assert.deepEqual(unresolved, [], `these elements are used but never imported: ${unresolved.join(', ')}`)
assert.ok(primitivesUsed.length > 20, 'and the audit actually looked at the render calls')

console.log(JSON.stringify({ ok: true, clientChecks: 5 }))
