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
const service = readConst('RPC_SERVICE')
const noInputMatch = source.match(/export const RPC_NO_INPUT = \[([\s\S]*?)\]/)
const noInput = new Set([...(noInputMatch === null ? '' : noInputMatch[1]).matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]))
const header = `// 该文件由 scripts/generate-remote.mjs 生成，请勿手改（改 src/endpoints.ts 后重新生成）。\n`

const remote = `${header}const PKG = ${JSON.stringify(pkg)}

const codec = (typeSymbol, parse) => ({
  mode: "strict",
  typeSymbol: \`\${PKG}#\${typeSymbol}\`,
  schema: { parse },
})
const passthrough = (value) => value
const asInput = (value) => {
  if (value === undefined || value === null) return {}
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("input must be an object")
  return value
}
const withInput = () => [
  { name: "input", wire: "input", source: "json", codec: codec("Input", asInput) },
]
const method = (name, parameters) => ({
  id: \`\${PKG}#${service}/\${name}\`,
  service: ${JSON.stringify(service)},
  namespace: ${JSON.stringify(service)},
  method: name,
  invocation: { kind: "direct" },
  parameters,
  result: codec("View", passthrough),
})

/**
 * What the browser half mounts: ctx.remote.$mount(RPC_REMOTE). The field set matches the shape that
 * worked before this file was generated — an id per descriptor, a strict codec for the input, and an
 * empty parameter list for the reads that take none.
 */
export const RPC_REMOTE = {
  package: PKG,
  descriptors: [
${endpoints.map((name) => `    method(${JSON.stringify(name)}, ${noInput.has(name) ? '[]' : 'withInput()'}),`).join('\n')}
  ],
}
`

const signature = (name) => noInput.has(name) ? '(): Promise<unknown>' : '(input: unknown): Promise<unknown>'
const parameters = (name) => noInput.has(name) ? '[]' : `[
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: jsonCodec("Json"),
        },
      ]`
const member = (name) => `          { name: ${JSON.stringify(name)}, kind: "method", signature: ${JSON.stringify(signature(name))} },`
const invocation = (name) => `        {
          id: \`${pkg}#agentPersona/${name}\`,
          service: "agentPersona",
          namespace: "agentPersona",
          method: ${JSON.stringify(name)},
          invocation: direct,
          parameters: ${parameters(name)},
          result: result("Json"),
        },`

/**
 * The current Typert loader consumes a full host manifest from ./typert.
 * Keep this artifact generated from the same endpoint list as the browser RPC
 * descriptors so a stale simplified TYPERT_REMOTE object cannot break startup.
 */
const typert = `${header}import { z } from "zod"

const PKG = ${JSON.stringify(pkg)}
const direct = { kind: "direct" }
const jsonCodec = (typeSymbol) => ({
  mode: "strict",
  typeSymbol: \`${'${PKG}'}#\${typeSymbol}\`,
  schema: z.unknown(),
})
const result = (typeSymbol) => jsonCodec(typeSymbol)

export const TYPERT = {
  package: PKG,
  face: "host",
  schemas: [],
  model: {
    services: [
      {
        tags: [],
        key: "agentPersona",
        exportName: "agentPersona",
        description: "Workspace-scoped agent personas exposed through the host RPC service.",
        summary: "Agent persona management service",
        jsDoc: "The host service for listing, editing, matching, and tuning agent personas.",
        members: [
${endpoints.map(member).join('\n')}
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
  invocations: [
${endpoints.map(invocation).join('\n')}
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
