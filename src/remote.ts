// 该文件由 scripts/generate-remote.mjs 生成，请勿手改（改 src/endpoints.ts 后重新生成）。
const PKG = "dsh-agent-persona"

const codec = (typeSymbol, parse) => ({
  mode: "strict",
  typeSymbol: `${PKG}#${typeSymbol}`,
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
  id: `${PKG}#agentPersona/${name}`,
  service: "agentPersona",
  namespace: "agentPersona",
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
    method("listPersonas", []),
    method("savePersona", withInput()),
    method("deletePersona", withInput()),
    method("movePersona", withInput()),
    method("duplicatePersona", withInput()),
    method("reorderPersona", withInput()),
    method("listTargets", []),
    method("sessionHistory", withInput()),
    method("sessionPrompt", withInput()),
    method("tunePersona", withInput()),
    method("listModels", []),
  ],
}
