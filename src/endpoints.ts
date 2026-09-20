/**
 * The remote surface, in one place. The host registers exactly these names, the generator turns them
 * into the ./remote and ./typert artifacts, and the browser half mounts what the generator produced —
 * so the three never drift. Regenerate with `npm run generate:remote`.
 */
export const RPC_PACKAGE = 'dsh-agent-persona'
/**
 * The cordis service name the host registers (super(ctx, 'agentPersona')) and the namespace the
 * browser half reads (ctx.get('remote.agentPersona')). It is NOT the package name: filling these two
 * fields with the package name mounts the namespace under a key nothing ever looks up.
 */
export const RPC_SERVICE = 'agentPersona'
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
  'savePrefs',
] as const

/** The three reads that take no argument. Everything else receives one JSON object. */
export const RPC_NO_INPUT = ['listPersonas', 'listTargets', 'listModels'] as const
