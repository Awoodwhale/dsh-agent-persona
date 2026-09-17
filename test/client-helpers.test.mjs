/**
 * The client bundle cannot be imported into Node (it registers itself with the
 * browser's module loader), so the pure helpers it relies on are lifted out of the
 * source and exercised here. The splitter must be lossless — it feeds Markdown
 * rendering, and dropping a line would silently change a message — and the tag
 * escaper must leave real HTML and code spans alone.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** Slice a top-level block by its start marker and the next section marker. */
const sliceBlock = (startMarker, endMarker) => {
  const from = source.indexOf(startMarker)
  const to = source.indexOf(endMarker)
  assert.ok(from !== -1 && to > from, `${startMarker} must be extractable from the client source`)
  return source.slice(from, to)
}

const splitMarkdown = new Function(`${sliceBlock('const splitMarkdown = ', '    /** HTML the renderer is known to handle')}\nreturn splitMarkdown`)()
const escapeUnknownTags = new Function(`${sliceBlock('const KNOWN_HTML_TAGS', '    /** One chunk of Markdown')}\nreturn escapeUnknownTags`)()

const plain = 'a\n\nb\n\nc'
assert.deepEqual(splitMarkdown(plain, 1000), [plain], 'a small message stays in one chunk')
assert.equal(splitMarkdown('', 10).length, 0, 'an empty message has no chunks')
assert.equal(splitMarkdown('one\ntwo').join('\n'), 'one\ntwo', 'joining the chunks reproduces the input')

const long = Array.from({ length: 400 }, (_, i) => `line ${i} with some text`).join('\n')
const chunks = splitMarkdown(long, 300)
assert.ok(chunks.length > 1, 'a long message is split')
assert.equal(chunks.join('\n'), long, 'and splitting loses nothing')
assert.ok(chunks.every((chunk) => chunk.length <= 300 || !chunk.includes('\n')), 'each chunk respects the bound')

// a fence must never be split across chunks
const fenced = ['intro', '```js', ...Array.from({ length: 200 }, (_, i) => `const x${i} = ${i}`), '```', 'outro'].join('\n')
const fencedChunks = splitMarkdown(fenced, 120)
assert.equal(fencedChunks.join('\n'), fenced, 'fenced text is reproduced exactly')
assert.ok(fencedChunks.every((chunk) => (chunk.match(/^\s*```/gm) ?? []).length % 2 === 0), 'no chunk ends inside an open fence')

// tag-shaped prose must not reach the HTML parser; real HTML and code stay put
assert.equal(
  escapeUnknownTags('每块一个 <SafeChunk>（自己的错误边界）'),
  '每块一个 &lt;SafeChunk&gt;（自己的错误边界）',
  'an unknown tag becomes literal text',
)
assert.equal(
  escapeUnknownTags('<details><summary>x</summary>y</details>'),
  '<details><summary>x</summary>y</details>',
  'known HTML is left for the renderer',
)
assert.equal(escapeUnknownTags('a < b and c > d'), 'a < b and c > d', 'a bare comparison is not a tag')
assert.equal(escapeUnknownTags('inline `a <B> c` stays'), 'inline `a <B> c` stays', 'inline code is untouched')
assert.equal(escapeUnknownTags('```html\n<MyThing/>\n```'), '```html\n<MyThing/>\n```', 'fenced code is untouched')
assert.equal(escapeUnknownTags('no tags here'), 'no tags here', 'plain text passes through')

console.log(JSON.stringify({ ok: true, clientChecks: 14 }))
