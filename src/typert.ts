// 该文件由 scripts/generate-remote.mjs 生成，请勿手改（改 src/endpoints.ts 后重新生成）。
import { z } from "zod"

const PKG = "dsh-agent-persona"
const direct = { kind: "direct" }
const jsonCodec = (typeSymbol) => ({
  mode: "strict",
  typeSymbol: `${PKG}#${typeSymbol}`,
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
          { name: "listPersonas", kind: "method", signature: "(): Promise<unknown>" },
          { name: "savePersona", kind: "method", signature: "(input: unknown): Promise<unknown>" },
          { name: "deletePersona", kind: "method", signature: "(input: unknown): Promise<unknown>" },
          { name: "movePersona", kind: "method", signature: "(input: unknown): Promise<unknown>" },
          { name: "duplicatePersona", kind: "method", signature: "(input: unknown): Promise<unknown>" },
          { name: "reorderPersona", kind: "method", signature: "(input: unknown): Promise<unknown>" },
          { name: "listTargets", kind: "method", signature: "(): Promise<unknown>" },
          { name: "sessionHistory", kind: "method", signature: "(input: unknown): Promise<unknown>" },
          { name: "sessionPrompt", kind: "method", signature: "(input: unknown): Promise<unknown>" },
          { name: "tunePersona", kind: "method", signature: "(input: unknown): Promise<unknown>" },
          { name: "listModels", kind: "method", signature: "(): Promise<unknown>" },
          { name: "savePrefs", kind: "method", signature: "(input: unknown): Promise<unknown>" },
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
  invocations: [
        {
          id: `dsh-agent-persona#agentPersona/listPersonas`,
          service: "agentPersona",
          namespace: "agentPersona",
          method: "listPersonas",
          invocation: direct,
          parameters: [],
          result: result("Json"),
        },
        {
          id: `dsh-agent-persona#agentPersona/savePersona`,
          service: "agentPersona",
          namespace: "agentPersona",
          method: "savePersona",
          invocation: direct,
          parameters: [
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: jsonCodec("Json"),
        },
      ],
          result: result("Json"),
        },
        {
          id: `dsh-agent-persona#agentPersona/deletePersona`,
          service: "agentPersona",
          namespace: "agentPersona",
          method: "deletePersona",
          invocation: direct,
          parameters: [
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: jsonCodec("Json"),
        },
      ],
          result: result("Json"),
        },
        {
          id: `dsh-agent-persona#agentPersona/movePersona`,
          service: "agentPersona",
          namespace: "agentPersona",
          method: "movePersona",
          invocation: direct,
          parameters: [
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: jsonCodec("Json"),
        },
      ],
          result: result("Json"),
        },
        {
          id: `dsh-agent-persona#agentPersona/duplicatePersona`,
          service: "agentPersona",
          namespace: "agentPersona",
          method: "duplicatePersona",
          invocation: direct,
          parameters: [
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: jsonCodec("Json"),
        },
      ],
          result: result("Json"),
        },
        {
          id: `dsh-agent-persona#agentPersona/reorderPersona`,
          service: "agentPersona",
          namespace: "agentPersona",
          method: "reorderPersona",
          invocation: direct,
          parameters: [
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: jsonCodec("Json"),
        },
      ],
          result: result("Json"),
        },
        {
          id: `dsh-agent-persona#agentPersona/listTargets`,
          service: "agentPersona",
          namespace: "agentPersona",
          method: "listTargets",
          invocation: direct,
          parameters: [],
          result: result("Json"),
        },
        {
          id: `dsh-agent-persona#agentPersona/sessionHistory`,
          service: "agentPersona",
          namespace: "agentPersona",
          method: "sessionHistory",
          invocation: direct,
          parameters: [
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: jsonCodec("Json"),
        },
      ],
          result: result("Json"),
        },
        {
          id: `dsh-agent-persona#agentPersona/sessionPrompt`,
          service: "agentPersona",
          namespace: "agentPersona",
          method: "sessionPrompt",
          invocation: direct,
          parameters: [
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: jsonCodec("Json"),
        },
      ],
          result: result("Json"),
        },
        {
          id: `dsh-agent-persona#agentPersona/tunePersona`,
          service: "agentPersona",
          namespace: "agentPersona",
          method: "tunePersona",
          invocation: direct,
          parameters: [
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: jsonCodec("Json"),
        },
      ],
          result: result("Json"),
        },
        {
          id: `dsh-agent-persona#agentPersona/listModels`,
          service: "agentPersona",
          namespace: "agentPersona",
          method: "listModels",
          invocation: direct,
          parameters: [],
          result: result("Json"),
        },
        {
          id: `dsh-agent-persona#agentPersona/savePrefs`,
          service: "agentPersona",
          namespace: "agentPersona",
          method: "savePrefs",
          invocation: direct,
          parameters: [
        {
          name: "input",
          wire: "input",
          source: "json",
          codec: jsonCodec("Json"),
        },
      ],
          result: result("Json"),
        },
  ],
}
