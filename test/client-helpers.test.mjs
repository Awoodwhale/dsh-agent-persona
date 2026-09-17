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

console.log(JSON.stringify({ ok: true, clientChecks: 5 }))
