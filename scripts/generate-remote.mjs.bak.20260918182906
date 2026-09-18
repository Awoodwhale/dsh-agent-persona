/**
 * Generates the remote artifacts from src/endpoints.ts.
 *
 * This build has no vendor Typert generator (dsh-typert-protocol ships no bin and the CLI has no such
 * command), so the equivalent is kept here: one source of truth for the endpoint names, and two files
 * emitted from it. `--check` regenerates in memory and compares, so CI fails if the artifacts are ever
 * edited by hand or left stale.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const listPath = join(root, 'src', 'endpoints.ts')

const source = readFileSync(listPath, 'utf8')
const readConst = (name) => {
  const match = source.match(new RegExp(`export const ${name} = ([^\\n]+)`))
  if (match === null) throw new Error(`src/endpoints.ts must export ${name}`)
  return match[1].trim().replace(/^['"]|['"]$/g, '')
}
const names = source.match(/export const RPC_ENDPOINTS = \[([\s\S]*?)\]/)
if (names === null) throw new Error('src/endpoints.ts must export RPC_ENDPOINTS as an array literal')
const endpoints = [...names[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map((match) => match[1])
if (endpoints.length === 0) throw new Error('RPC_ENDPOINTS is empty')
for (const name of endpoints) {
  if (!new RegExp(`\\b${name}\\b`).test(readFileSync(join(root, 'src', 'index.ts'), 'utf8'))) {
    throw new Error(`endpoint ${name} is not referenced by src/index.ts`)
  }
}

const pkg = readConst('RPC_PACKAGE')
const channel = readConst('RPC_CHANNEL')
const header = `// 该文件由 scripts/generate-remote.mjs 生成，请勿手改（改 src/endpoints.ts 后重新生成）。\n`

const descriptor = (name) => `    {
      service: ${JSON.stringify(pkg)},
      namespace: ${JSON.stringify(pkg)},
      method: ${JSON.stringify(name)},
      invocation: { kind: 'direct' },
      parameters: [{ name: 'input', wire: 'input', source: 'json', codec: { parse: (value) => value } }],
      result: { mode: 'strict', typeSymbol: ${JSON.stringify(`${pkg}#View`)}, schema: { parse: (value) => value } },
    },`

const remote = `${header}export const RPC_CHANNEL = ${JSON.stringify(channel)}

/** What the browser half mounts: ctx.remote.$mount(RPC_REMOTE). */
export const RPC_REMOTE = {
  package: ${JSON.stringify(pkg)},
  descriptors: [
${endpoints.map(descriptor).join('\n')}
  ],
}
`

const typert = `${header}export const RPC_CHANNEL = ${JSON.stringify(channel)}

/** The host-side description of the same surface, for tooling and documentation. */
export const TYPERT_REMOTE = {
  package: ${JSON.stringify(pkg)},
  methods: [
${endpoints.map((name) => `    ${JSON.stringify(name)},`).join('\n')}
  ],
}
`

const files = [
  [join(root, 'src', 'remote.ts'), remote],
  [join(root, 'src', 'typert.ts'), typert],
]
const check = process.argv.includes('--check')
let drift = false
for (const [path, text] of files) {
  if (check) {
    let current = ''
    try {
      current = readFileSync(path, 'utf8')
    } catch {
      current = ''
    }
    if (current !== text) {
      drift = true
      console.error(`out of date: ${path.replace(root + '/', '')} — run npm run generate:remote`)
    }
  } else {
    writeFileSync(path, text)
    console.log(`wrote ${path.replace(root + '/', '')}`)
  }
}
if (check && drift) process.exit(1)
console.log(check ? `remote artifacts are current (${endpoints.length} endpoints)` : `generated ${endpoints.length} endpoints`)
