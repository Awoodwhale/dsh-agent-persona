/**
 * Guards the client's rendering choices by reading its source (the bundle registers
 * itself with the browser's module loader, so it cannot be imported into Node), and
 * exercises the pure helpers it relies on. Two rules are pinned here: the markdown
 * handed to the kit's renderer must be transcript-safe, and fenced code must arrive as
 * HTML, so the syntax highlighter behind the kit's code-block component — which throws
 * on this content — never sees a fence.
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

const escapeUnknownTags = new Function(`${sliceBlock('const KNOWN_HTML_TAGS', '    const escapeHtmlText')}\nreturn escapeUnknownTags`)()
const fencesToHtml = new Function(`${sliceBlock('    const escapeHtmlText', '    /**\n     * Renders one message with the conversation')}\nreturn fencesToHtml`)()

// ── the renderer, and what it is fed
assert.ok(source.includes('MarkdownText,'), 'the kit renderer available to plugins is imported')
assert.ok(
  source.includes('h(MarkdownText, { text: fencesToHtml(escapeUnknownTags(text)) })'),
  'and used on text whose fences are already HTML',
)
for (const gone of ['MessageText,', 'splitMarkdown', 'SafeChunk', 'onDegrade', 'wsp-warmup']) {
  assert.equal(source.includes(gone), false, `${gone} must not come back`)
}

// ── re-reading must not clear the dialog (that unmounts it: a flash)
const head = source.slice(source.indexOf('async readHeadHistory()'), source.indexOf('async readTailHistory()'))
assert.equal(head.includes('history: undefined'), false, 'readHeadHistory must not clear the dialog while it re-reads')
assert.ok(head.includes("mode: 'head'"), 'and it replaces the contents in place')

// ── a failed render retries, and still degrades visibly rather than killing the page
assert.ok(source.includes('this.setState({ failed: false, attempt: this.state.attempt + 1 })'), 'a failed render is retried')
assert.ok(source.includes('getDerivedStateFromError'), 'and a message that keeps failing shows its text')
assert.ok(source.includes('this.state.reason'), 'with the reason on screen')

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

// ── fences become plain HTML code blocks
assert.equal(fencesToHtml('prose only'), 'prose only', 'text without fences is untouched')
assert.equal(
  fencesToHtml('```js\nconst a = 1 < 2\n```'),
  '<pre><code>const a = 1 &lt; 2</code></pre>',
  'a fence becomes an HTML code block, with its angle brackets escaped',
)
assert.equal(
  fencesToHtml('a\n```\nx\n```\nb\n```py\ny\n```\nc'),
  'a\n<pre><code>x</code></pre>\nb\n<pre><code>y</code></pre>\nc',
  'every fence in a document is converted',
)
assert.equal(fencesToHtml('```\nunterminated'), '<pre><code>unterminated</code></pre>', 'an unterminated fence still renders as code')
assert.equal(fencesToHtml('inline `a < b` stays'), 'inline `a < b` stays', 'inline code is untouched')
assert.equal(fencesToHtml(''), '', 'an empty message stays empty')

// ── tag-shaped prose must not reach the HTML parser; real HTML and code stay put
assert.equal(
  escapeUnknownTags('每块一个 <MyThing>（自己的错误边界）'),
  '每块一个 &lt;MyThing&gt;（自己的错误边界）',
  'an unknown tag becomes literal text',
)
assert.equal(
  escapeUnknownTags('<details><summary>x</summary>y</details>'),
  '<details><summary>x</summary>y</details>',
  'known HTML is left for the renderer',
)
assert.equal(escapeUnknownTags('a < b and c > d'), 'a < b and c > d', 'a bare comparison is not a tag')
assert.equal(escapeUnknownTags('inline `a <B> c` stays'), 'inline `a <B> c` stays', 'inline code is untouched')
assert.equal(escapeUnknownTags('```\n<MyThing>\n```'), '```\n<MyThing>\n```', 'fenced code is untouched')
assert.equal(escapeUnknownTags('no tags here'), 'no tags here', 'plain text passes through')

console.log(JSON.stringify({ ok: true, clientChecks: 19 }))
