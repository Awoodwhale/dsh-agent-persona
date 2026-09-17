/**
 * The client bundle cannot be imported into Node (it registers itself with the
 * browser's module loader), so the pure helpers it exports are lifted out of the
 * source and exercised here. The splitter must be lossless: it feeds Markdown
 * rendering, and dropping a line would silently change a message.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const extract = (name) => {
  const at = source.indexOf(`const ${name} = `)
  assert.notEqual(at, -1, `${name} must exist in the client source`)
  const from = source.indexOf('{', at)
  let depth = 0
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(source.indexOf('(', at), i + 1)
    }
  }
  throw new Error(`could not read ${name}`)
}
const splitMarkdown = new Function(`return ${extract('splitMarkdown')}`)()

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
const fenced = ['intro', '\u0060\u0060\u0060js', ...Array.from({ length: 200 }, (_, i) => `const x${i} = ${i}`), '\u0060\u0060\u0060', 'outro'].join('\n')
const fencedChunks = splitMarkdown(fenced, 120)
assert.equal(fencedChunks.join('\n'), fenced, 'fenced text is reproduced exactly')
assert.ok(fencedChunks.every((chunk) => (chunk.match(/^\s*\u0060\u0060\u0060/gm) ?? []).length % 2 === 0), 'no chunk ends inside an open fence')

console.log(JSON.stringify({ ok: true, clientChecks: 8 }))
