import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
/**
 * agent-persona — host half (v2: many personas, each with its own scope).
 *
 * Model
 * -----
 * A persona is a first-class record: `{ id, name, enabled, text, targets[] }`.
 * Every target says WHERE the persona applies:
 *
 *     { kind: 'workspace' | 'sessionId', match: 'exact' | 'prefix' | 'regex' | 'contains', value: string }
 *
 * Resolution (see {@link resolvePersona}) is deliberately simple and explainable:
 *
 *   1. personas are tried in ARRAY ORDER (the settings page shows that order and
 *      lets it be reordered) — the first match wins;
 *   2. inside one persona the targets are OR-ed (any target matching is enough);
 *   3. a persona with NO targets applies nowhere (a draft), it is never a catch-all: so it
 *      belongs at the bottom of the list;
 *   4. a DISABLED persona is skipped entirely;
 *   5. a matching persona whose text is EMPTY wins and contributes nothing —
 *      that is how you carve an exception out of a catch-all ("no persona here");
 *   6. when nothing matches, the section renders `''` and `renderPrompt()` drops
 *      it, so the agent keeps the stock DSH system prompt.
 *
 * Placement: ONE global system-prompt section at
 * `getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') + 1` (order 1) — right after the
 * harness identity (-1000) and the persona prefix (0), ahead of every
 * tool-guidance section (500+). Workspace `AGENTS.md` is not a section at all
 * (`dsh-agent-instructions` turns it into a durable USER-role message whose own
 * intro says it does not override system instructions), so a persona here
 * outranks `AGENTS.md` structurally.
 *
 * Storage lives in this plugin's own directory — `$DSH_HOME/dsh-agent-persona/`
 * holds `personas.json` (the data) and `state.json` (a load heartbeat), so a
 * deployment does not scatter loose files across `$DSH_HOME`. The data file is
 * re-read on every assembly when its `mtimeNs:size` stamp changes, so edits apply
 * to the next request.
 *
 * The settings page offers dropdowns instead of asking for raw paths and ids;
 * `listTargets` is what feeds them (workspaces + sessions with titles).
 *
 * Row config (all optional):
 *   tuneProvider / tuneModel — pin the model used by the AI-tuning button for
 *   this deployment; when unset it uses the model DSH itself is set to use
 *   (`agentDefaultModel`), which is also what the settings page preselects.
 *   storePath — override the persona store location (default
 *   `$DSH_HOME/dsh-agent-persona/personas.json`).
 */

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export const name = 'agent-persona'
export const inject = ['systemPrompt']

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
/** Everything this plugin writes lives under one directory of its own. */
const STATE_DIR = join(DSH_HOME, 'dsh-agent-persona')
const STORE_FILE = join(STATE_DIR, 'personas.json')
const HEARTBEAT_FILE = join(STATE_DIR, 'state.json')
/** Pre-0.1.1 layout: loose files directly under $DSH_HOME. Migrated on first load. */
const SECTION_NAME = 'agent-persona'
/** The prompt section a deployment (or a preset) uses for its own persona line. */
const PERSONA_PREFIX_SECTION = 'deployment:persona-prefix'
/** The harness's own identity line, the section a `replace` persona also takes over. */
const HARNESS_IDENTITY_SECTION = 'harness:identity'
const HARNESS_IDENTITY_TEXT = 'You are an AI agent powered by DeepSeek Harness'
/** Persona injection modes: append after the preset persona, or replace it. */
export const PERSONA_MODES = ['append', 'replace']
const MAX_TEXT_BYTES = 64 * 1024
const STORE_VERSION = 1

/** Prompt variables a persona may reference; anything else is de-braced. */
const ALLOWED_VARIABLES = new Set(['model', 'cwd'])

/** Target vocabulary, surfaced to the settings page. */
export const TARGET_KINDS = ['workspace', 'sessionId']
export const TARGET_MATCHES = ['exact', 'prefix', 'regex', 'contains']

const TUNE_MODES = new Set(['polish', 'expand', 'compress', 'draft'])

// ─────────────────────────────────────────────────────────── store

const emptyStore = () => ({ version: STORE_VERSION, personas: [] })

/**
 * Move one persona to an absolute position (what a drag-and-drop emits).
 * @param store - the store to adjust in place.
 * @param id - persona to move.
 * @param toIndex - target position, clamped into range.
 * @returns whether the order actually changed.
 */
export const reorderPersonas = (store, id, toIndex) => {
  const personas = store?.personas ?? []
  const from = personas.findIndex((persona) => persona.id === id)
  if (from === -1) return false
  const to = Math.max(0, Math.min(personas.length - 1, Number.isFinite(toIndex) ? Math.trunc(toIndex) : from))
  if (to === from) return false
  const [persona] = personas.splice(from, 1)
  personas.splice(to, 0, persona)
  return true
}

/**
 * A workspace or a session belongs to exactly one persona. When a save claims a
 * value that another persona holds with the same kind and the same exact value,
 * the claim moves to the incoming persona and the other one loses that row.
 *
 * Only exact values can be reasoned about: prefix / regex / contains rows may
 * still overlap, and the first match in list order wins there.
 * @param store - the store to adjust in place.
 * @param persona - the persona whose claims win.
 * @returns the names of the personas that lost a row.
 */
export const takeOverClaims = (store, persona) => {
  const claimed = new Set(
    (persona.targets ?? [])
      .filter((target) => target.kind !== undefined && target.value !== '')
      .map((target) => `${target.kind}\u0000${target.value}`),
  )
  if (claimed.size === 0) return []
  const moved = []
  for (const other of store.personas ?? []) {
    if (other === persona || other.id === persona.id) continue
    const kept = (other.targets ?? []).filter((target) => !claimed.has(`${target.kind}\u0000${target.value}`))
    if (kept.length !== (other.targets ?? []).length) {
      other.targets = kept
      moved.push(other.name)
    }
  }
  return moved
}

const clone = (value) => JSON.parse(JSON.stringify(value))

const newId = () => `psn_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`

const normalizeTarget = (raw) => ({
  kind: TARGET_KINDS.includes(raw?.kind) ? raw.kind : 'workspace',
  match: TARGET_MATCHES.includes(raw?.match) ? raw.match : 'exact',
  value: typeof raw?.value === 'string' ? raw.value : '',
})

const normalizePersona = (raw) => ({
  id: typeof raw?.id === 'string' && raw.id !== '' ? raw.id : newId(),
  name: typeof raw?.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : '未命名人设',
  enabled: raw?.enabled !== false,
  fallback: raw?.fallback === true,
  text: typeof raw?.text === 'string' ? raw.text : '',
  mode: raw?.mode === 'replace' ? 'replace' : 'append',
  targets: (Array.isArray(raw?.targets) ? raw.targets : []).map(normalizeTarget),
})

/**
 * Bring a stored document to the v2 shape. v1 kept one persona per workspace
 * plus one `default`; each entry that carried anything meaningful becomes a
 * persona, and the v1 default becomes a persona with no targets (imported, but inert until it is
 * given at least one).
 * @param parsed - the raw JSON document (any version).
 * @param warn - diagnostic sink.
 * @returns the v2 store plus a migration report (empty when nothing moved).
 */
const loadStore = (storePath, warn) => {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(storePath, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') warn(`could not read ${storePath}; starting from an empty store`, error)
    return emptyStore()
  }
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.personas)) {
    warn(`${storePath} is not a persona store; starting from an empty one`)
    return emptyStore()
  }
  return { version: STORE_VERSION, personas: parsed.personas.map(normalizePersona) }
}

const persist = (store, storePath) => {
  mkdirSync(dirname(storePath), { recursive: true })
  const tmp = `${storePath}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, storePath)
}

export const sanitizePersona = (text, warn = () => {}) => {
  const dropped = []
  const neutral = String(text).replaceAll('{{', '\u0000').replaceAll('}}', '\u0001')
  const out = neutral
    .replace(/\u0000\s*([A-Za-z_][A-Za-z0-9_]*)\s*\u0001/g, (_match, variable) => {
      if (ALLOWED_VARIABLES.has(variable)) return `{{${variable}}}`
      dropped.push(variable)
      return variable
    })
    // Stray markers (a `{{` with no complete group) are dropped rather than
    // turned into spaces, so the sentence does not gain run-on whitespace.
    .replaceAll('\u0000', '')
    .replaceAll('\u0001', '')
  if (dropped.length > 0) warn(`persona text references unsupported prompt variables (${[...new Set(dropped)].join(', ')}); rendered as plain text`)
  return out
}

// ─────────────────────────────────────────────────────────── matching

const regexCache = new Map()
const compile = (value) => {
  if (regexCache.has(value)) return regexCache.get(value)
  let compiled
  try {
    compiled = new RegExp(value)
  } catch {
    compiled = undefined
  }
  regexCache.set(value, compiled)
  return compiled
}

const subjectFor = (target, subject) => (target.kind === 'sessionId' ? subject.sessionId : subject.cwd)

/**
 * Does one target claim this subject?
 * @param target - normalized target record.
 * @param subject - `{ cwd?: string, sessionId?: string }`.
 * @returns true when the target matches; an unusable target (empty value, bad
 * regex, or a subject field the session does not have) never matches.
 */
export const matchTarget = (target, subject) => {
  const value = target.value.trim()
  if (value === '') return false
  const raw = subjectFor(target, subject)
  if (typeof raw !== 'string' || raw === '') return false
  const isPath = target.kind === 'workspace'
  // Only `exact` normalises paths (so a trailing slash or `..` still matches);
  // prefix/contains/regex compare the raw strings the user typed, which is what
  // makes a plain substring like `project-x` usable on a cwd.
  switch (target.match) {
    case 'exact':
      return isPath ? resolve(raw) === resolve(value) : raw === value
    case 'prefix':
      return raw.startsWith(value)
    case 'contains':
      return raw.includes(value)
    case 'regex': {
      const compiled = compile(value)
      return compiled === undefined ? false : compiled.test(raw)
    }
    default:
      return false
  }
}

/** The target list that claims this subject, empty when none does. */
/**
 * How specific one matching rule is. A session-level rule beats a directory-level
 * one, and an exact value beats a pattern, so the most specific claim wins without
 * the user having to order the list by hand.
 * @param target - the matching row.
 * @returns 6 (sessionId/exact) down to 1 (workspace pattern); a target-less
 * persona scores 0, i.e. it only takes what nothing else claimed.
 */
export const targetSpecificity = (target) => {
  if (target?.kind === undefined) return 0
  const kind = target.kind === 'sessionId' ? 3 : 1
  const match = target.match === 'exact' ? 2 : target.match === 'prefix' ? 1 : 0
  return kind * 2 + match
}

export const matchingTargets = (persona, subject) => (persona.targets ?? []).filter((target) => matchTarget(target, subject))

/**
 * Pick the persona that owns this assembly.
 * @param personas - the store's persona list, already in priority order.
 * @param subject - `{ cwd?, sessionId? }` for the assembling agent.
 * @returns the winning persona and why, or `reason: 'none'`.
 */
export const resolvePersona = (personas, subject) => {
  // Most specific claim wins; the list order only breaks ties. A persona with no
  // targets) scores 0 and therefore takes exactly what nothing else claimed.
  let winner
  let winnerScore = -1
  for (const persona of personas ?? []) {
    if (!persona.enabled) continue
    // A persona without a target applies nowhere: it is a draft, not a catch-all. Nothing
    // claimed means the harness keeps its own system prompt, which is the honest default.
    if (persona.targets.length === 0) continue
    const matchedBy = matchingTargets(persona, subject)
    if (matchedBy.length === 0) continue
    const score = Math.max(...matchedBy.map(targetSpecificity))
    if (score > winnerScore) {
      winner = { persona, reason: 'target', matchedBy, specificity: score }
      winnerScore = score
    }
  }
  if (winner !== undefined) return winner
  // Nothing claimed a position: the persona marked as the default takes the rest, and if there is
  // none the harness keeps its own system prompt.
  for (const persona of personas ?? []) {
    if (!persona.enabled || persona.fallback !== true) continue
    return { persona, reason: 'fallback', matchedBy: [], specificity: 0 }
  }
  return { persona: undefined, reason: 'none', matchedBy: [], specificity: -1 }
}

const headerOf = (agent) => agent?.session?.header ?? agent?.session ?? {}

export const subjectOf = (agent) => {
  const header = headerOf(agent)
  const id = typeof header?.id === 'string' && header.id !== '' ? header.id : agent?.id
  const cwd = typeof header?.cwd === 'string' && header.cwd !== '' ? resolve(header.cwd) : undefined
  return { cwd, sessionId: typeof id === 'string' ? id : undefined }
}

/** The persona text one assembly should carry, or `''` for the stock prompt. */
export const personaTextFor = (personas, agent, warn = () => {}) => {
  // An agent-less assembly has no cwd/session, so no persona with targets can
  // claim it — which is exactly what makes a deployment-wide persona possible.
  const picked = resolvePersona(personas, subjectOf(agent))
  if (picked.persona === undefined) return ''
  return picked.persona.text.trim() === '' ? '' : sanitizePersona(picked.persona.text, warn).trim()
}

// ─────────────────────────────────────────────────────────── remote service

/**
 * Everything the picker needs about a session, out of ONE read of DSH's
 * projection cache: the title, the first prompt and the latest prompt.
 *
 * The projection file is the cheapest source by a wide margin — a session log is
 * 2.6x-5.8x larger on a real machine and is a zstd-compressed append-only file
 * that cannot be seeked, so reading its tail would be the most expensive option
 * of all. The service is tried first (the intended fast path) but its
 * `recordFor(id)` needs an identity witness a listed header cannot reconstruct,
 * so the file below is what actually answers; both are cached per process.
 */
/**
 * Clip one message for transport without breaking its Markdown. A cut that lands
 * inside an open ``` fence would swallow every line after it (and can push the
 * renderer into its plain-text fallback), so the fence is closed first.
 * @param text - the message body.
 * @param maxChars - how much to keep.
 * @returns the clipped body with a truncation note.
 */
export const clipMarkdown = (text, maxChars) => {
  if (text.length <= maxChars) return text
  // The notice is the interface's job (it renders its own truncated row), so the text itself
  // stays clean — what a reader copies is the message, not a note glued to its end.
  const head = text.slice(0, maxChars)
  // Cut at a block boundary: the renderer asked for fields a fragment does not have
  // ("Cannot read properties of undefined (reading 'code')") only for clipped text,
  // and never for the same message read in full, so the kept text must be a whole
  // sequence of blocks rather than a slice that ends inside one.
  const paragraph = head.lastIndexOf('\n\n')
  const lineBreak = head.lastIndexOf('\n')
  const floor = maxChars * 0.4
  let cut = paragraph > floor ? head.slice(0, paragraph) : lineBreak > floor ? head.slice(0, lineBreak) : head
  const fences = (cut.match(/^```/gm) ?? []).length
  if (fences % 2 === 1) {
    const opening = cut.lastIndexOf('\n```')
    cut = opening === -1 ? '' : cut.slice(0, opening)
  }
  if ((cut.match(/`/g) ?? []).length % 2 === 1) cut = cut.slice(0, cut.lastIndexOf('`'))
  return cut.trimEnd()
}

/** One line, at most 48 characters, for a label taken from a prompt. */
const summarize = (text) => {
  const flat = String(text).replace(/\s+/g, ' ').trim()
  return flat.length > 48 ? `${flat.slice(0, 48)}…` : flat
}

const projectionLabels = new Map()

const labelFromProjections = async (ctx, id) => {
  if (projectionLabels.has(id)) return projectionLabels.get(id)
  const resolved = await readProjectionLabel(ctx, id)
  if (projectionLabels.size > 400) projectionLabels.clear()
  projectionLabels.set(id, resolved)
  return resolved
}

const projectionValue = (record, key) => {
  const row = record?.rows?.[key] ?? record?.[key]
  if (row === undefined) return undefined
  return typeof row === 'object' && row !== null && 'val' in row ? row.val : row
}

const readProjectionLabel = async (ctx, id) => {
  const fromRecord = (record) => {
    if (record === undefined) return undefined
    const title = projectionValue(record, 'title')
    const inputs = projectionValue(record, 'titleInput')
    const outline = projectionValue(record, 'turnOutline')?.turns
    const latest = Array.isArray(outline) && outline.length > 0 ? outline[outline.length - 1]?.prompt : undefined
    const stats = projectionValue(record, 'sessionStats')
    const metadata = projectionValue(record, 'sessionListMetadata')
    // How many times this session was talked to — same file, no extra read.
    const turns = Number.isFinite(stats?.turns) ? stats.turns
      : Array.isArray(outline) && outline.length > 0 ? outline.length
        : Number.isFinite(inputs?.count) ? inputs.count : undefined
    return {
      title: typeof title === 'string' && title !== '' ? title : undefined,
      firstPrompt: typeof inputs?.first?.text === 'string' ? inputs.first.text : undefined,
      latestPrompt: typeof latest === 'string' ? latest : undefined,
      ...(turns === undefined ? {} : { turns }),
      ...(metadata?.blank === true ? { blank: true } : {}),
    }
  }
  try {
    const cache = ctx.get('sessionProjectionCache')
    const record = cache?.recordFor?.(id)
    const fromView = fromRecord(cache?.viewRecord?.(record, ['title', 'titleInput', 'turnOutline'])) ?? fromRecord(record)
    if (fromView !== undefined && (fromView.title !== undefined || fromView.firstPrompt !== undefined || fromView.latestPrompt !== undefined)) {
      return fromView
    }
  } catch {
    /* fall through to the file */
  }
  try {
    const file = join(DSH_HOME, 'storages', 'session_projcache', 'sessions', `${id}.json`)
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    return fromRecord(parsed?.record) ?? fromRecord(parsed) ?? {}
  } catch {
    return {}
  }
}

/**
 * The candidate lists the settings page offers as dropdowns. Every source is
 * probed defensively: a deployment whose services differ simply gets an empty
 * list, and the page falls back to typing a value.
 * @param ctx - host context.
 * @param warn - warning sink.
 * @returns workspaces (`{path,title,sessionCount}`) and the newest 200 sessions
 * (`{id,title?,cwd,createdAt}`, newest first).
 */
export const collectTargets = async (ctx, { personas = [], warn = () => {} } = {}) => {
  /** Which enabled persona claims a value exactly, if any. */
  const ownerOf = (kind, value) => {
    // Ownership must agree with injection: the winner is the most specific match,
    // not whichever persona happens to sit first in the list.
    const subject = kind === 'workspace' ? { cwd: value } : { sessionId: value }
    const winner = resolvePersona(personas, subject).persona
    if (winner === undefined) return undefined
    const claims = (winner.targets ?? []).some((target) => target.kind === kind && matchTarget(target, subject))
    return claims ? { id: winner.id, name: winner.name } : undefined
  }

  const workspaces = []
  try {
    const registry = ctx.get('workspaceRegistry')
    const list = registry?.list
    if (typeof list !== 'function') throw new Error('this deployment exposes no workspace list')
    for (const workspace of (await list.call(registry)) ?? []) {
      const path = typeof workspace?.path === 'string' ? workspace.path : undefined
      if (path === undefined) continue
      let sessionCount = 0
      try {
        sessionCount = (workspace.sessionIds ?? []).length
      } catch {
        sessionCount = 0
      }
      const owner = ownerOf('workspace', path)
      workspaces.push({
        path,
        title: typeof workspace.title === 'string' && workspace.title !== '' ? workspace.title : path,
        sessionCount,
        ...(owner === undefined ? {} : { owner }),
      })
    }
  } catch (error) {
    warn('the workspace list is unavailable; target values must be typed', error)
  }

  const sessions = []
  // Archived ids and the hidden-session tallies live at function scope: the loop
  // that fills them runs inside the try below.
  const archived = collectArchivedSessionIds(ctx)
  const hidden = { subagents: 0, archived: 0, blank: 0 }
  try {
    const persistence = ctx.get('sessionPersistence') ?? ctx.get('sessions')
    const list = persistence?.list
    if (typeof list !== 'function') throw new Error('this deployment exposes no session list')
    const rows = (await list.call(persistence)) ?? []
    const titles = ctx.get('sessionTitle')
    const live = ctx.get('sessions')
    for (const row of rows) {
      const header = row?.header ?? row
      const id = header?.id
      if (typeof id !== 'string') continue
      // Only conversations a human can open and type into: a sub-agent session
      // (spawned by the model — origin 'subagent' / depth > 0) and an archived one
      // are both unreachable from the sidebar.
      if (header?.origin === 'subagent' || (typeof header?.delegationDepth === 'number' && header.delegationDepth > 0)) {
        hidden.subagents += 1
        continue
      }
      if (archived.has(id)) {
        hidden.archived += 1
        continue
      }
      let title
      try {
        const session = live?.get?.(id) ?? row?.session
        const value = session === undefined ? undefined : titles?.get?.(session)
        if (typeof value === 'string' && value !== '') title = value
      } catch {
        /* a title is a nice-to-have, never a requirement */
      }
      const owner = ownerOf('sessionId', id)
      sessions.push({
        id,
        ...(title === undefined ? {} : { title }),
        cwd: typeof header?.cwd === 'string' ? header.cwd : null,
        createdAt: typeof header?.createdAt === 'number' ? header.createdAt : null,
        ...(owner === undefined ? {} : { owner }),
      })
    }
  } catch (error) {
    warn('the session list is unavailable; target values must be typed', error)
  }
  sessions.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  const newest = sessions.slice(0, 200)
  // Reading a session is the expensive path, so only the newest handful without
  // a title pay for it — and they are the ones a user picks from anyway.
  // Projection files are large (they carry context timelines: ~265 KB each on a
  // real machine, up to ~850 KB) and parsing one costs ~1 ms, so only the newest
  // slice is read inline — enough to label the flat "recent sessions" list and
  // the first directory groups. Reads are async (the loop keeps running) and every
  // answer is cached for the process, so each session is read at most once.
  let projectionBudget = 16
  const empty = []
  for (const session of newest) {
    if (session.title !== undefined || projectionBudget <= 0) continue
    projectionBudget -= 1
    const label = await labelFromProjections(ctx, session.id)
    // A session nobody ever typed into (the flag the sidebar itself hides on):
    // it holds no conversation to give a persona.
    if (label.blank === true) {
      empty.push(session)
      continue
    }
    if (label.turns !== undefined) session.turns = label.turns
    const fallback = label.title ?? label.firstPrompt ?? label.latestPrompt
    if (fallback !== undefined && fallback.trim() !== '') session.title = summarize(fallback)
  }
  for (const session of empty) {
    const at = newest.indexOf(session)
    if (at !== -1) newest.splice(at, 1)
    hidden.blank += 1
  }
  return { workspaces, sessions: newest, hidden }
}

/**
 * Apply a persona's injection mode to an assembled prompt.
 *
 * The persona text itself always rides in this plugin's own section, so
 * `replace` only has to drop the deployment's persona line — `append` leaves the
 * assembly untouched. A section already carrying something else (an agent preset
 * or a subagent shadowed it) is never overwritten: another author's persona wins.
 * @param assembly - the `system-prompt/assemble` value.
 * @param options.mode - `append` or `replace`.
 * @param options.deploymentPrefix - the deployment's own persona text, when readable.
 * @returns the assembly to hand on (the input object when nothing changes).
 */
export const applyPersonaMode = (assembly, { mode, deploymentPrefix }) => {
  if (mode !== 'replace' || assembly === null || typeof assembly !== 'object') return assembly
  const sections = assembly.sections
  if (!Array.isArray(sections)) return assembly
  const next = sections.slice()
  let changed = false
  // The deployment's own identity ("You are a coding agent powered by …"), but only when
  // it still is that text: a preset's own persona is not ours to remove.
  const prefix = next.findIndex((entry) => entry?.name === PERSONA_PREFIX_SECTION)
  if (prefix !== -1) {
    const current = typeof next[prefix].text === 'string' ? next[prefix].text : ''
    if (deploymentPrefix === undefined || current === deploymentPrefix) {
      next[prefix] = { ...next[prefix], text: '' }
      changed = true
    }
  }
  // The harness's own identity line as well, so a replace persona is the only identity
  // left. Matched by name, or by its text when the name is not known here.
  const identity = next.findIndex((entry) => entry?.name === HARNESS_IDENTITY_SECTION
    || (typeof entry?.text === 'string' && entry.text.trim().startsWith(HARNESS_IDENTITY_TEXT)))
  if (identity !== -1) {
    next[identity] = { ...next[identity], text: '' }
    changed = true
  }
  return changed ? { ...assembly, sections: next } : assembly
}

/** Read one event's plain text out of the shapes DSH session logs use. */
const eventText = (event) => {
  const parts = []
  const push = (value) => { if (typeof value === 'string' && value !== '') parts.push(value) }
  const data = event?.data ?? {}
  const blocks = [data.content, data.message?.content, data.text]
  for (const block of blocks) {
    if (typeof block === 'string') push(block)
    else if (Array.isArray(block)) for (const part of block) push(part?.text ?? part?.content)
  }
  return parts.join('\n').trim()
}

/**
 * Session ids the user has archived. The registry is asked first; the workspace
 * store file is the fallback, and an unreadable store simply means "none".
 */
export const collectArchivedSessionIds = (ctx) => {
  const ids = new Set()
  const add = (value) => {
    if (Array.isArray(value)) for (const id of value) if (typeof id === 'string' && id !== '') ids.add(id)
  }
  try {
    const registry = ctx.get('workspaceRegistry')
    add(registry?.archivedSessionIds)
    for (const workspace of registry?.list?.() ?? []) add(workspace?.archivedSessionIds)
  } catch {
    /* fall through to the store */
  }
  if (ids.size === 0) {
    try {
      const store = JSON.parse(readFileSync(join(DSH_HOME, 'storages', 'workspace.json'), 'utf8'))
      const rows = store?.record?.rows ?? store
      add(rows?.global?.val?.archivedSessionIds ?? rows?.global?.archivedSessionIds)
      const tables = rows?.tables?.val?.workspaces ?? rows?.tables?.workspaces
      for (const key of Object.keys(tables ?? {})) add(tables[key]?.archivedSessionIds)
    } catch {
      /* no store on disk: nothing is archived as far as we know */
    }
  }
  return ids
}

/**
 * The last system prompt a session actually sent: read out of its own event log, so it
 * is the assembled text rather than a reconstruction of it.
 * @param ctx - the plugin context.
 * @param id - the session id.
 * @returns the prompt text, or null when the log cannot be read.
 */
export const collectLastSystemPrompt = async (ctx, id) => {
  const sessionId = typeof id === 'string' ? id : ''
  if (sessionId === '') return null
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined || typeof persistence.open !== 'function') return null
  let handle
  try {
    handle = await persistence.open(sessionId, 'read')
  } catch {
    try {
      handle = await persistence.open(sessionId)
    } catch {
      return null
    }
  }
  const window = 2000
  let cursor = 0
  let last
  for (let step = 0; step < 12; step += 1) {
    let events
    try {
      const page = await handle.read(cursor, window)
      events = Array.isArray(page?.events) ? page.events : []
    } catch {
      return last ?? null
    }
    for (const event of events) {
      if (String(event?.type ?? event?.kind ?? '') !== 'system/message') continue
      const text = eventText(event).trim()
      if (text !== '') last = text
    }
    if (events.length < window) break
    cursor += events.length
  }
  return last ?? null
}

/**
 * What the persona view shows for one session: which persona applies, and the system
 * prompt that session last sent.
 * @param ctx - the plugin context.
 * @param id - the session id.
 * @param personas - the stored personas.
 * @returns the view payload.
 */
export const sessionPromptFrom = async (ctx, id, personas) => {
  const sessionId = typeof id === 'string' ? id : ''
  if (sessionId === '') return { id: '', available: false, persona: null, prompt: null, reason: 'none', matchedBy: [] }
  let cwd
  try {
    const rows = (await ctx.get('sessionPersistence')?.list?.()) ?? []
    const row = rows.find((item) => (item?.header ?? item)?.id === sessionId)
    const header = row?.header ?? row
    if (typeof header?.cwd === 'string' && header.cwd !== '') cwd = header.cwd
  } catch {
    /* a session without a readable list is still worth showing */
  }
  const picked = resolvePersona(personas ?? [], { cwd, sessionId })
  return {
    id: sessionId,
    available: true,
    cwd: cwd ?? null,
    reason: picked.reason,
    matchedBy: (picked.matchedBy ?? []).map((target) => ({ kind: target.kind, match: target.match, value: target.value })),
    persona: picked.persona === undefined ? null : {
      id: picked.persona.id,
      name: picked.persona.name,
      mode: picked.persona.mode ?? 'append',
      fallback: picked.persona.fallback === true,
      enabled: picked.persona.enabled !== false,
      text: picked.persona.text ?? '',
      targets: (picked.persona.targets ?? []).map((target) => ({ kind: target.kind, match: target.match, value: target.value })),
    },
    prompt: await collectLastSystemPrompt(ctx, sessionId),
  }
}

/**
 * The options a history call carries, in one place: the runtime used to forward a
 * hand-written subset, so a new option (tail/keep) silently never reached the
 * reader and 跳到最新 quietly read the beginning instead.
 * @param input - the remote call's payload.
 * @returns the reader options.
 */
export const historyOptions = (input) => ({
  offset: input?.offset,
  events: input?.events,
  maxChars: input?.maxChars,
  tail: input?.tail === true,
  keep: input?.keep,
})

/**
 * Read one window of a session's conversation.
 *
 * Storage is addressed through per-session handles and the backend is a
 * zstd-compressed append-only log, so a read decompresses from the start: asking
 * for many small pages costs far more than a few large ones. The contract is
 * therefore one generous window plus `nextOffset`, and the page only fetches
 * another window when the user asks for more. Each message is capped so a single
 * huge tool output cannot blow up the payload or the DOM.
 * @param ctx - host context.
 * @param id - session id.
 * @param options.offset - first event index to read (default 0).
 * @param options.events - how many events to read in this window (default 2000, max 4000).
 * @param options.maxChars - per-message text cap (default 1000).
 * @returns a page: `{ messages, offset, nextOffset, done, eventCount, unavailable }`.
 */
export const collectSessionHistory = async (ctx, id, options = {}) => {
  const sessionId = typeof id === 'string' ? id : ''
  if (sessionId === '') return { id: '', available: false, unavailable: true, messages: [] }
  const window = Number.isFinite(options?.events) ? Math.max(1, Math.min(4000, Math.trunc(options.events))) : 2000
  // `tail`: walk to the end and hand back only the last exchange, so the caller can
  // show "what were we just talking about" without shipping the whole history.
  if (options?.tail === true) {
    const keep = Number.isFinite(options?.keep) ? Math.max(1, Math.min(20, Math.trunc(options.keep))) : 4
    let cursor = 0
    let last = []
    let total = 0
    let scanned = 0
    let page
    for (let step = 0; step < 12; step += 1) {
      page = await collectSessionHistory(ctx, sessionId, { offset: cursor, events: window, maxChars: options?.maxChars })
      if (page.available === false) return page
      last = [...last, ...page.messages]
      // Keep enough history that the last *user* input survives: an agent turn can
      // emit several assistant messages, which used to push the question out of a
      // fixed four-message window.
      if (last.length > 60) last = last.slice(-60)
      total += page.messages.length
      scanned += page.eventCount ?? 0
      if (page.done === true || page.nextOffset === null) break
      cursor = page.nextOffset
    }
    const lastUser = last.map((message) => message.role).lastIndexOf('user')
    const exchange = lastUser === -1 ? last.slice(-keep) : last.slice(lastUser)
    return {
      id: sessionId,
      available: true,
      unavailable: false,
      cwd: page?.cwd ?? null,
      createdAt: page?.createdAt ?? null,
      tail: true,
      done: true,
      offset: cursor,
      nextOffset: null,
      eventCount: page?.eventCount ?? 0,
      scanned,
      total,
      messages: exchange,
    }
  }
  const offset = Number.isFinite(options?.offset) ? Math.max(0, Math.trunc(options.offset)) : 0
  const maxChars = Number.isFinite(options?.maxChars) ? Math.max(200, Math.min(40000, Math.trunc(options.maxChars))) : 1000

  let handle
  let persistence
  try {
    persistence = ctx.get('sessionPersistence')
  } catch {
    persistence = undefined
  }
  for (const name of ['open', 'openSession', 'handle', 'read', 'load', 'get']) {
    const reader = persistence?.[name]
    if (typeof reader !== 'function') continue
    // `open(id, access)`: the access mode is required, and `'read'` never takes
    // write ownership. Older/newer signatures take just the id, hence the retry.
    for (const args of [[sessionId, 'read'], [sessionId]]) {
      try {
        handle = await reader.call(persistence, ...args)
      } catch {
        handle = undefined
      }
      if (handle !== undefined && typeof handle === 'object') break
      handle = undefined
    }
    if (handle !== undefined) break
  }
  if (handle === undefined) {
    try {
      const live = ctx.get('sessions')?.get?.(sessionId)
      if (live !== undefined) handle = { header: live.header, events: live.events ?? [] }
    } catch {
      /* no live session either */
    }
  }
  if (handle === undefined) {
    return { id: sessionId, available: false, unavailable: true, messages: [], offset, nextOffset: null, done: true }
  }

  let events = []
  let more = false
  if (typeof handle.read === 'function') {
    try {
      const page = await handle.read(offset, window)
      events = Array.isArray(page?.events) ? page.events : Array.isArray(page) ? page : []
      const total = typeof page?.eventCount === 'number' ? page.eventCount : typeof page?.total === 'number' ? page.total : undefined
      more = total === undefined ? events.length >= window : offset + events.length < total
    } catch {
      events = []
    }
  } else if (Array.isArray(handle.events)) {
    events = handle.events.slice(offset, offset + window)
    more = offset + events.length < handle.events.length
  }

  const messages = []
  // Only what the user actually typed. Everything else that arrives on the user
  // side is injected by plugins — workspace instructions (13k chars in a real
  // session), runtime-context snapshots, the skill catalog, goal rounds — and
  // showing it would flood the view with text the user never wrote. Events that
  // carry no `source` at all are kept, so a future DSH that stops labelling them
  // does not hide the whole conversation.
  let skipped = 0
  let eventIndex = -1
  for (const event of events) {
    eventIndex += 1
    const kind = String(event?.type ?? event?.kind ?? '')
    if (kind !== 'user/message' && kind !== 'assistant/message') continue
    if (kind === 'user/message') {
      const source = event?.data?.source ?? event?.source
      const sourceKind = typeof source?.kind === 'string' ? source.kind : undefined
      if (sourceKind !== undefined && sourceKind !== 'user') {
        skipped += 1
        continue
      }
    }
    const text = eventText(event)
    if (text === '') continue
    const clipped = text.length > maxChars
    messages.push({
      role: kind === 'user/message' ? 'user' : 'assistant',
      // Where this message lives, so one message can be re-read in full later
      // (`sessionHistory({ offset: at, events: 1, maxChars: <big> })`).
      at: offset + eventIndex,
      text: clipped ? clipMarkdown(text, maxChars) : text,
      ...(clipped ? { truncated: true } : {}),
    })
  }
  const header = handle.header ?? {}
  return {
    id: sessionId,
    available: true,
    unavailable: false,
    cwd: typeof header.cwd === 'string' ? header.cwd : null,
    createdAt: typeof header.createdAt === 'number' ? header.createdAt : null,
    offset,
    nextOffset: more ? offset + events.length : null,
    done: !more,
    eventCount: events.length,
    total: messages.length,
    skipped,
    messages,
  }
}



/** `agentPersona` — the namespace the settings page talks to. */
class WorkspacePersonaService extends TypertRemoteService {
  constructor(ctx, runtime) {
    super(ctx, 'agentPersona')
    for (const initializer of MARKER_INITIALIZERS) initializer.call(this)
    this.runtime = runtime
  }

  /** Everything the settings page renders. */
  async listPersonas() {
    try {
      return this.runtime.view()
    } catch (error) {
      return { error: `listPersonas failed: ${String((error && error.stack) || error)}` }
    }
  }

  /** Create (no `id`) or update (with `id`) one persona. */
  async savePersona(input) {
    try {
      return this.runtime.save(input)
    } catch (error) {
      return { error: `savePersona failed: ${String((error && error.stack) || error)}` }
    }
  }

  /** Remove one persona. */
  async deletePersona(input) {
    try {
      return this.runtime.remove(input)
    } catch (error) {
      return { error: `deletePersona failed: ${String((error && error.stack) || error)}` }
    }
  }

  /** Move one persona up/down: the list order IS the priority order. */
  async movePersona(input) {
    try {
      return this.runtime.move(input)
    } catch (error) {
      return { error: `movePersona failed: ${String((error && error.stack) || error)}` }
    }
  }

  /** Copy one persona (created disabled, so a copy changes nothing). */
  async duplicatePersona(input) {
    try {
      return this.runtime.duplicate(input)
    } catch (error) {
      return { error: `duplicatePersona failed: ${String((error && error.stack) || error)}` }
    }
  }

  /** Explain which persona a given cwd/session would get, and why. */
  /** The persona view: which persona a session uses, and the prompt it last sent. */
  async sessionPrompt(input) {
    try {
      return await this.runtime.sessionPrompt(input)
    } catch (error) {
      return { error: `sessionPrompt failed: ${String((error && error.stack) || error)}` }
    }
  }

  async sessionHistory(input) {
    try {
      return await this.runtime.history(input)
    } catch (error) {
      return { error: `sessionHistory failed: ${String((error && error.stack) || error)}` }
    }
  }

  async reorderPersona(input) {
    try {
      return this.runtime.reorder(input)
    } catch (error) {
      return { error: `reorderPersona failed: ${String((error && error.stack) || error)}` }
    }
  }

  async listTargets() {
    try {
      return await this.runtime.targets()
    } catch (error) {
      return { error: `listTargets failed: ${String((error && error.stack) || error)}` }
    }
  }

  /** Rewrite a persona with the configured model; returns a proposal, saves nothing. */
  async tunePersona(input) {
    try {
      return await this.runtime.tune(input)
    } catch (error) {
      return { error: `tunePersona failed: ${String((error && error.stack) || error)}` }
    }
  }

  /** Models the tuning panel may target (host model catalog, best effort). */
  async listModels() {
    try {
      return await this.runtime.models()
    } catch (error) {
      return { error: `listModels failed: ${String((error && error.stack) || error)}`, models: [] }
    }
  }
}

const MARKER_INITIALIZERS = []
/** Attach `@Remote` markers without decorator syntax (see AGENTS.md §11). */
const markRemote = (target, methods) => {
  for (const method of methods) {
    Remote(target.prototype[method], {
      kind: 'method',
      name: method,
      static: false,
      private: false,
      addInitializer: (initializer) => MARKER_INITIALIZERS.push(initializer),
    })
  }
}

markRemote(WorkspacePersonaService, [
  'listPersonas', 'savePersona', 'deletePersona', 'movePersona', 'duplicatePersona', 'reorderPersona', 'listTargets', 'sessionHistory', 'sessionPrompt', 'tunePersona', 'listModels',
])

/** The Connection RPC channel the browser half calls into (see the plugin standard). */
export const RPC_CHANNEL = '/agent-persona'

/** RPC endpoints, in the wire envelope the connection service expects. */
export const RPC_ENDPOINTS = [
  'listPersonas', 'savePersona', 'deletePersona', 'movePersona', 'duplicatePersona',
  'reorderPersona', 'listTargets', 'sessionHistory', 'sessionPrompt', 'tunePersona', 'listModels',
]

// ─────────────────────────────────────────────────────────── plugin

/** Mount the prompt section, the store-backed service, and the load heartbeat. */
export function apply(ctx, config = {}) {
  const logger = ctx.logger ?? console
  const warn = (message, error) =>
    logger.warn?.(`[agent-persona] ${message}${error === undefined ? '' : `: ${String(error)}`}`)
  const info = (message) => logger.info?.(`[agent-persona] ${message}`)

  // Where this instance keeps its data. `storePath` in the row config overrides
  // the default (`$DSH_HOME/dsh-agent-persona/personas.json`).
  const storePath = typeof config?.storePath === 'string' && config.storePath !== ''
    ? resolve(config.storePath)
    : STORE_FILE
  try {
    mkdirSync(dirname(storePath), { recursive: true })
  } catch (error) {
    warn(`could not create ${dirname(storePath)}`, error)
  }

  // Re-read the file whenever its stamp changes, so an edit applies to the next
  // request even from an instance that is already running.
  let store = loadStore(storePath, warn)
  let storeStamp = stampOf()
  function stampOf() {
    try {
      const stat = statSync(storePath, { bigint: true })
      return `${stat.mtimeNs}:${stat.size}`
    } catch {
      return 'missing'
    }
  }
  const reload = () => {
    const stamp = stampOf()
    if (stamp !== storeStamp) {
      store = loadStore(storePath, warn)
      storeStamp = stamp
    }
    return store
  }
  const currentStore = () => (storeStamp === stampOf() ? store : reload())

  // ── model resolution for AI tuning: never bake a vendor default into the code.
  // Explicit UI choice wins; then the plugin row's config; then the host's own
  // `agentDefaultModel` service (the same selection new Agents get).
  const configuredProvider = typeof config?.tuneProvider === 'string' && config.tuneProvider !== '' ? config.tuneProvider : undefined
  const configuredModel = typeof config?.tuneModel === 'string' && config.tuneModel !== '' ? config.tuneModel : undefined
  const hostDefaultModel = () => {
    try {
      const selection = ctx.get('agentDefaultModel')?.currentSelection?.()
      if (typeof selection?.provider === 'string' && typeof selection?.model === 'string') {
        return { provider: selection.provider, model: selection.model }
      }
    } catch {
      /* service not mounted in this deployment */
    }
    return undefined
  }
  const pickModel = (input) => {
    if (typeof input?.provider === 'string' && input.provider !== '' && typeof input?.model === 'string' && input.model !== '') {
      return { provider: input.provider, model: input.model, source: 'ui' }
    }
    if (configuredModel !== undefined) {
      const provider = configuredProvider ?? hostDefaultModel()?.provider
      if (provider !== undefined) return { provider, model: configuredModel, source: 'config' }
    }
    const host = hostDefaultModel()
    return host === undefined ? undefined : { ...host, source: 'host-default' }
  }

  // `replace` mode: after assembly, drop the deployment's own persona line so
  // the persona in our section stands alone. Another author's persona (an agent
  // preset or subagent that shadowed the section) is never overwritten.
  const deploymentPrefix = () => {
    for (const read of [
      () => ctx.systemPrompt?.config?.personaPrefix,
      () => ctx.systemPrompt?.ctx?.config?.personaPrefix,
      () => ctx.get('systemPrompt')?.config?.personaPrefix,
    ]) {
      try {
        const value = read()
        if (typeof value === 'string') return value
      } catch {
        /* try the next accessor */
      }
    }
    return undefined
  }
  let replaceGuardWarned = false
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    try {
      // Waterfall rule: every listener calls next() and wraps its result. Skipping it
      // would veto the whole downstream chain, which is not what a persona does.
      const downstream = await next()
      const persona = resolvePersona(currentStore().personas, subjectOf(context?.agent)).persona
      if (persona === undefined || persona.mode !== 'replace') return downstream
      const own = deploymentPrefix()
      if (own === undefined && !replaceGuardWarned) {
        replaceGuardWarned = true
        warn('cannot read the deployment persona; replace mode will drop the section as-is')
      }
      return applyPersonaMode(downstream, { mode: 'replace', deploymentPrefix: own })
    } catch (error) {
      warn('could not apply the replace mode', error)
      return next()
    }
  })

  const order = ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') + 1
  try {
    ctx.effect(() => ctx.systemPrompt.section({
      name: SECTION_NAME,
      order,
      text: (assembly) => personaTextFor(currentStore().personas, assembly?.agent, warn),
    }), 'agent-persona.section')
    info(`section "${SECTION_NAME}" registered at order ${order} (store: ${storePath})`)
  } catch (error) {
    warn(`section "${SECTION_NAME}" is already registered; keeping the live one`, error)
  }

  /** Target decorated with the flags the page needs to explain itself. */
  const describeTarget = (target) => ({
    ...target,
    invalid: target.value.trim() === '' || (target.match === 'regex' && compile(target.value) === undefined),
  })

  const view = () => {
    const current = reload()
    const personas = current.personas.map((persona, index) => ({
      ...clone(persona),
      index,
      chars: persona.text.length,
      targets: persona.targets.map(describeTarget),
      noTargets: persona.targets.length === 0,
      fallback: persona.fallback === true,
    }))
    return {
      version: STORE_VERSION,
      storePath,
      sectionName: SECTION_NAME,
      sectionOrder: order,
      allowedVariables: [...ALLOWED_VARIABLES],
      personaModes: PERSONA_MODES,
      targetKinds: TARGET_KINDS,
      targetMatches: TARGET_MATCHES,
      tuneModes: [...TUNE_MODES],
      counts: {
        total: personas.length,
        enabled: personas.filter((persona) => persona.enabled).length,
        configured: personas.filter((persona) => persona.enabled && persona.text.trim() !== '').length,
      },
      personas,
    }
  }

  const normalizeInput = (input) => {
    const text = typeof input?.text === 'string' ? input.text : ''
    if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw new Error(`人设文本过长（上限 ${MAX_TEXT_BYTES} 字节）`)
    const targets = (Array.isArray(input?.targets) ? input.targets : [])
      .map(normalizeTarget)
      .filter((target) => target.value.trim() !== '')
    return {
      id: typeof input?.id === 'string' && input.id !== '' ? input.id : undefined,
      name: typeof input?.name === 'string' && input.name.trim() !== '' ? input.name.trim() : '未命名人设',
      enabled: input?.enabled !== false,
      // 默认人设：没有位置命中时使用它（优先级最低的保底），同一时刻只允许一条。
      fallback: input?.fallback === true,
      mode: input?.mode === 'replace' ? 'replace' : 'append',
      text,
      targets,
    }
  }

  const runtime = {
    view,
    save(input) {
      const next = normalizeInput(input)
      const current = reload()
      let persona
      if (next.id === undefined) {
        persona = { id: newId(), name: next.name, enabled: next.enabled, fallback: next.fallback, text: next.text, mode: next.mode, targets: next.targets }
        current.personas.push(persona)
        info(`created persona "${next.name}" (${current.personas.length} total)`)
      } else {
        persona = current.personas.find((item) => item.id === next.id)
        if (persona === undefined) throw new Error('人设不存在（可能已被删除）')
        persona.name = next.name
        persona.enabled = next.enabled
        persona.fallback = next.fallback
        persona.text = next.text
        persona.mode = next.mode
        persona.targets = next.targets
        info(`saved persona "${next.name}"`)
      }
      const moved = persona.enabled ? takeOverClaims(current, persona) : []
      // Only one persona can be the default: claiming it releases whoever held it.
      const released = []
      if (persona.fallback === true) {
        for (const other of current.personas) {
          if (other === persona || other.fallback !== true) continue
          other.fallback = false
          released.push(other.name)
        }
      }
      persist(current, storePath)
      const result = view()
      if (released.length > 0) {
        result.notice = `「${persona.name}」现在是默认人设；「${released.join('」「')}」已取消默认`
        info(`default persona moved from: ${released.join(', ')}`)
        return result
      }
      if (moved.length > 0) {
        result.notice = `这些位置原来属于「${moved.join('」「')}」，已转给这条人设`
        info(`took over claims from: ${moved.join(', ')}`)
      }
      return result
    },
    remove(input) {
      const current = reload()
      const id = typeof input?.id === 'string' ? input.id : ''
      const before = current.personas.length
      current.personas = current.personas.filter((persona) => persona.id !== id)
      if (current.personas.length === before) throw new Error('人设不存在（可能已被删除）')
      persist(current, storePath)
      info(`deleted persona ${id}`)
      return view()
    },
    move(input) {
      const current = reload()
      const id = typeof input?.id === 'string' ? input.id : ''
      const delta = input?.delta === 1 ? 1 : input?.delta === -1 ? -1 : 0
      const from = current.personas.findIndex((persona) => persona.id === id)
      if (from < 0) throw new Error('人设不存在（可能已被删除）')
      const to = Math.min(current.personas.length - 1, Math.max(0, from + delta))
      if (to !== from) {
        const [moved] = current.personas.splice(from, 1)
        current.personas.splice(to, 0, moved)
        persist(current, storePath)
      }
      return view()
    },
    duplicate(input) {
      const current = reload()
      const id = typeof input?.id === 'string' ? input.id : ''
      const from = current.personas.findIndex((persona) => persona.id === id)
      if (from < 0) throw new Error('人设不存在（可能已被删除）')
      const source = current.personas[from]
      // Copies start disabled: adding one must never change what any session gets.
      current.personas.splice(from + 1, 0, {
        id: newId(),
        name: `${source.name} 副本`,
        enabled: false,
        text: source.text,
        targets: clone(source.targets),
      })
      persist(current, storePath)
      info(`duplicated persona "${source.name}" (copy starts disabled)`)
      return view()
    },
    /** Drop a persona at an absolute position (what a drag-and-drop emits). */
    reorder(input) {
      const id = typeof input?.id === 'string' ? input.id : ''
      const toIndex = Number.isFinite(input?.toIndex) ? Math.trunc(input.toIndex) : -1
      const current = reload()
      if (!current.personas.some((persona) => persona.id === id)) throw new Error('人设不存在（可能已被删除）')
      if (reorderPersonas(current, id, toIndex)) {
        persist(current, storePath)
        info(`moved persona "${id}" to position ${Math.max(0, Math.min(current.personas.length - 1, toIndex)) + 1}`)
      }
      return view()
    },

    async targets() {
      return collectTargets(ctx, { personas: currentStore().personas, warn })
    },

    async sessionPrompt(input) {
      return sessionPromptFrom(ctx, input?.id, currentStore().personas)
    },

    async history(input) {
      return collectSessionHistory(ctx, input?.id, historyOptions(input))
    },

    async models() {
      const models = []
      try {
        const catalog = ctx.get('modelCatalog')
        const groups = (await catalog?.list?.()) ?? catalog?.groups ?? []
        for (const group of groups) {
          for (const model of group?.models ?? []) {
            models.push({ provider: group.id ?? 'unknown', model: model.id, name: model.name ?? model.id })
          }
        }
      } catch (error) {
        warn('model catalog unavailable; falling back to the host default model', error)
      }
      const host = hostDefaultModel()
      if (models.length === 0 && host !== undefined) models.push({ provider: host.provider, model: host.model, name: host.model })
      if (models.length === 0 && configuredModel !== undefined) {
        models.push({ provider: configuredProvider ?? 'unknown', model: configuredModel, name: configuredModel })
      }
      return {
        models,
        hostDefault: host ?? null,
        configured: configuredModel === undefined ? null : { provider: configuredProvider ?? null, model: configuredModel },
      }
    },
    async tune(input) {
      const mode = TUNE_MODES.has(input?.mode) ? input.mode : 'polish'
      const text = typeof input?.text === 'string' ? input.text : ''
      const instruction = typeof input?.instruction === 'string' ? input.instruction.trim() : ''
      if (text.trim() === '' && mode !== 'draft') throw new Error('请先写一点人设内容再让 AI 调优（或改用「按描述生成」）')
      if (mode === 'draft' && instruction === '') throw new Error('「按描述生成」需要填写要求')

      let llm
      try {
        llm = ctx.get('llm')
      } catch {
        llm = undefined
      }
      if (llm?.stream === undefined) throw new Error('宿主未提供 llm 服务，无法调用模型')

      const route = pickModel(input)
      if (route === undefined) {
        throw new Error('没有可用模型：请在设置页选择模型，或在 profile 里给 agent-persona 这一行配置 tuneProvider / tuneModel')
      }
      const provider = route.provider
      const model = route.model
      const guide = {
        polish: '润色现有文本：保持信息与意图不变，去掉冗余、统一语气、让约束更可执行。',
        expand: '补充现有文本：在保持原意的前提下补齐缺失的边界、工作方式与验收要求，可适度增加结构。',
        compress: '精简现有文本：只保留最有约束力的条款，删除重复与空话，目标长度不超过原文的一半。',
        draft: '按用户描述从零起草一份人设，结构清晰、约束可执行。',
      }[mode]

      const user = [
        `任务：${guide}`,
        text.trim() === '' ? '当前人设：<空>' : `当前人设：\n"""\n${text}\n"""`,
        instruction === '' ? '' : `用户额外要求：${instruction}`,
        '硬性要求：只输出改写后的 Markdown 正文；不要解释、不要前言、不要用代码块包裹；'
        + '不要出现 {{...}} 这类模板变量；用第二人称对"你"下指令；控制在 400–1200 字。',
      ].filter((line) => line !== '').join('\n\n')

      let out = ''
      for await (const chunk of llm.stream({
        provider,
        model,
        system: '你是 DeepSeek Harness（DSH）的 system prompt 人设编辑专家，擅长把模糊的要求写成可执行的 agent 行为约束。',
        messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
        temperature: 0.4,
      })) {
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
      }
      const cleaned = out.replace(/^\s*```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim()
      if (cleaned === '') throw new Error('模型没有返回内容，稍后再试')
      return { text: cleaned, mode, provider, model, source: route.source }
    },
  }

  try {
    new WorkspacePersonaService(ctx, runtime)
    info('remote namespace "agentPersona" registered (v2: multi-persona)')

  } catch (error) {
    warn('could not register the agentPersona service', error)
  }

  try {
    mkdirSync(dirname(HEARTBEAT_FILE), { recursive: true })
    writeFileSync(HEARTBEAT_FILE, `${JSON.stringify({
      loadedAt: new Date().toISOString(),
      loadedModule: new URL(import.meta.url).pathname,
      storePath,
      storeVersion: store.version,
      personas: store.personas.length,
      sectionName: SECTION_NAME,
      sectionOrder: order,
    }, null, 2)}\n`, { mode: 0o600 })
  } catch (error) {
    warn('could not write the load heartbeat', error)
  }
}
