/**
 * The remote surface, in one place. The host registers exactly these names, the generator turns them
 * into the ./remote and ./typert artifacts, and the browser half mounts what the generator produced —
 * so the three never drift. Regenerate with `npm run generate:remote`.
 */
export const RPC_PACKAGE = 'dsh-agent-persona'
export const RPC_CHANNEL = '/agent-persona'
export const RPC_ENDPOINTS = [
  'listPersonas',
  'savePersona',
  'deletePersona',
  'movePersona',
  'duplicatePersona',
  'reorderPersona',
  'listTargets',
  'sessionHistory',
  'sessionPrompt',
  'tunePersona',
  'listModels',
] as const
