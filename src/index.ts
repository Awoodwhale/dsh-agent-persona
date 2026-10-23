// @ts-nocheck —— 迁移第一步：先建立构建与产物形状，类型逐步补全
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

import Schema from '@deepseek-ai/schemastery'
import { RPC_ENDPOINTS } from './endpoints.js'
import {
  chmodSync,
  closeSync,
  copyFileSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { basename, dirname, join, resolve, sep } from 'node:path'

export const name = 'agent-persona'
/**
 * Configuration. Written as a Schemastery schema so the defaults live here, the shape is checked
 * when the row loads, and a wrong value fails loudly instead of being ignored.
 */
export const Config = Schema.object({
  /** Where the personas live. Empty selects the default store under the DSH state directory. */
  storePath: Schema.string().default(''),
  /** Provider and model the AI-tuning button calls. Empty means whatever DSH is set to. */
  tuneProvider: Schema.string().default(''),
  tuneModel: Schema.string().default(''),
})

export const inject = ['systemPrompt', 'connection', 'webServer', 'tools']

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

const emptyStore = () => ({ version: STORE_VERSION, personas: [], prefs: normalizePrefs(undefined) })

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
/**
 * Interface preferences live in the store, next to the personas, so one file carries everything the
 * plugin remembers and two deployments pointed at different files are fully independent. The two
 * display switches default to on: a fresh install shows the page everywhere until told otherwise.
 */
const DEFAULT_PREFS = { autosave: false, showTab: true, showSidebar: true, guard: true }

export const normalizePrefs = (raw) => ({
  autosave: raw?.autosave === true,
  showTab: raw?.showTab !== false,
  showSidebar: raw?.showSidebar !== false,
  guard: raw?.guard !== false,
  /** Opt-in version history: off by default, because it writes a second file on every save. */
  history: raw?.history === true,
})

/**
 * Read the store. A missing file is a normal first run and stays silent; a file that exists but cannot be
 * used is a reset, and that fact travels back to the caller so the first write can preserve the file before
 * replacing it.
 */
const loadStore = (storePath, warn) => {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(storePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return { store: emptyStore(), reset: undefined }
    warn(`could not read ${storePath}; starting from an empty store`, error)
    return { store: emptyStore(), reset: { reason: String(error?.message ?? error), path: storePath } }
  }
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.personas)) {
    warn(`${storePath} is not a persona store; starting from an empty one`)
    return { store: emptyStore(), reset: { reason: '文件内容不是人设存储（没有 personas 数组）', path: storePath } }
  }
  return {
    store: { version: STORE_VERSION, personas: parsed.personas.map(normalizePersona), prefs: normalizePrefs(parsed.prefs) },
    reset: undefined,
  }
}

/**
 * Write a file so a crash leaves either the old bytes or the new ones: the temp file is flushed to disk
 * before the rename, and the directory entry is flushed after it. Without the fsyncs a power cut can leave
 * the renamed file present but empty, which for a store means "all personas gone".
 */
const writeFileDurable = (file, text, mode) => {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  const fd = openSync(tmp, 'w', mode)
  try {
    writeSync(fd, text)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, file)
  // A directory fsync is what makes the rename itself durable. Not every filesystem allows opening a
  // directory for fsync; the bytes are already on disk, so a refusal here must not fail the write.
  try {
    const dir = openSync(dirname(file), 'r')
    try {
      fsyncSync(dir)
    } finally {
      closeSync(dir)
    }
  } catch {
    // Directory fsync is not supported here; the file content itself is already durable.
  }
}

const persist = (store, storePath) => {
  writeFileDurable(storePath, `${JSON.stringify(store, null, 2)}\n`, 0o600)
}

/** Filename-safe local timestamp for a store backup (milliseconds keep same-second backups apart). */
export const backupStamp = (now = new Date()) => {
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${String(now.getMilliseconds()).padStart(3, '0')}`
}

/**
 * Copy the store aside before it is overwritten for the first time after a failed load. An exception here
 * has to stop the write: replacing content we could not preserve is the one outcome this exists to prevent.
 */
export const backupStoreFile = (storePath, stamp) => {
  const backupPath = `${storePath}.bak-${stamp}`
  copyFileSync(storePath, backupPath)
  chmodSync(backupPath, 0o600)
  return backupPath
}

/** One line for a failed RPC. The stack is the server's own detail; a settings panel has no use for it. */
const errorMessage = (error) => String((error && error.message) || error)

const STORE_REFUSAL = '人设存储由 agent-persona 插件管理：工具不能写入或删除它。需要修改人设时，请让用户在「设置 → Agent 人设」里操作。'

/**
 * Tools that can only read. A store path in their arguments is not a write, and refusing it turned the
 * guard into a trap for honest work: a `grep` across the state dir, or a note quoting the store path, was
 * denied with a message about writing it. Anything absent from this set is treated as a writing tool.
 */
const STORE_READ_ONLY_TOOLS = new Set(['read', 'grep', 'glob', 'ls', 'list_files', 'search_files', 'compress'])

/** Tools that run a command line instead of naming a file in a dedicated option. */
const STORE_SHELL_TOOLS = new Set(['bash', 'pwsh', 'shell', 'exec', 'terminal', 'run_command'])

/** Command names that write the paths among their arguments, so "the store is an argument" means a write. */
const STORE_WRITE_COMMANDS = new Set([
  'rm', 'rmdir', 'rd', 'del', 'erase', 'unlink', 'shred', 'truncate', 'mv', 'move', 'ren', 'rename', 'cp', 'copy',
  'install', 'dd', 'tee', 'chmod', 'chown', 'chgrp', 'chflags', 'attrib', 'setfacl', 'ln', 'touch', 'mkdir',
  'sed', 'perl', 'python', 'python3', 'node', 'ruby', 'php',
  'set-content', 'add-content', 'clear-content', 'out-file', 'remove-item', 'new-item', 'copy-item', 'move-item',
  'rename-item',
])

/** First words that mean "the rest of the string is a program", where a snippet can write a path. */
const STORE_INTERPRETERS = new Set([
  'bash', 'sh', 'zsh', 'dash', 'pwsh', 'powershell', 'cmd', 'node', 'deno', 'bun', 'python', 'python3', 'perl',
  'ruby', 'php', 'eval', 'env', 'sudo', 'nohup', 'xargs', 'find',
])

/** Calls that write a path, for a snippet that already names the store somewhere in the same string. */
const STORE_WRITE_CALLS = [
  'writefile', 'writefilesync', 'appendfile', 'appendfilesync', 'open(', 'fopen(', 'creat(', 'unlink(', 'unlinksync(',
  'rmsync(', 'rename(', 'renamesync(', 'shutil.', 'os.remove', 'os.unlink', 'os.rename', 'fs.write', 'fs.promises.write',
  'file_put_contents', 'movefile(', 'deletefile(', 'replacefile(',
]

/** `~/notes` is the same file as `/home/me/notes`; a guard that misses that only protects one spelling. */
const expandHome = (value) => {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

const stripQuotes = (value) => value.replace(/^['"`]|['"`]$/g, '')

/** The files a tool must not write: the store, and the history file this plugin keeps beside it. */
const protectedTargetsFor = (storePath) => {
  const targets = [resolve(storePath)]
  const history = resolve(historyPathFor(storePath))
  if (!targets.includes(history)) targets.push(history)
  return targets
}

/**
 * Is this one argument the store itself, its history file, or a copy of either? Backups and temp files
 * (`<store>.bak-…`, `<store>.tmp-…`) count: rewriting one of those is rewriting the store under another name.
 */
const protectsPath = (value, bases, targets) => {
  const trimmed = stripQuotes(String(value ?? '').trim())
  if (trimmed === '') return false
  const expanded = expandHome(trimmed)
  for (const base of bases) {
    for (const target of targets) {
      let resolved
      try {
        resolved = resolve(base, expanded)
      } catch {
        continue
      }
      if (resolved === target || resolved.startsWith(`${target}.`)) return true
    }
  }
  return false
}

/** Split a command line the way a shell would, without executing anything: quoted runs stay one token. */
const shellTokens = (line) => (line.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(stripQuotes)

/** The file names a redirect would create. */
const redirectTargets = (tokens) => {
  const found = []
  for (let i = 0; i < tokens.length; i += 1) {
    const redirect = /^(?:\d*|&)>{1,2}(.*)$/.exec(tokens[i])
    if (redirect === null) continue
    const inline = stripQuotes(redirect[1])
    if (inline !== '') {
      found.push(inline)
      continue
    }
    const next = tokens[i + 1]
    if (next !== undefined) found.push(stripQuotes(next))
  }
  return found
}

/** The command name of a line, without a directory or an executable suffix. */
const commandVerb = (line) => {
  const first = shellTokens(line.trim())[0] ?? ''
  return basename(first).toLowerCase().replace(/\.(exe|cmd|bat|ps1|sh|zsh)$/, '')
}

/** Does this string look like a command rather than prose? Decides whether the shell rules apply to it. */
const looksLikeCommand = (value) => {
  const verb = commandVerb(value)
  return STORE_WRITE_COMMANDS.has(verb) || STORE_INTERPRETERS.has(verb)
}

/** A string that names the store and also calls something that writes it. */
const namesWriter = (line) => {
  const lowered = line.toLowerCase()
  return STORE_WRITE_CALLS.some((call) => lowered.includes(call))
}

/** Would running this line write a protected path? */
const commandWritesStore = (line, bases, targets) => {
  const tokens = shellTokens(line)
  if (tokens.length === 0) return false
  // A redirect is a write no matter which command produced it: copying the store over itself is a write.
  for (const target of redirectTargets(tokens)) {
    if (protectsPath(target, bases, targets)) return true
  }
  // A writing command with the store among its arguments.
  if (STORE_WRITE_COMMANDS.has(commandVerb(line)) && tokens.slice(1).some((token) => protectsPath(token, bases, targets))) {
    return true
  }
  // A snippet that names the store next to a writer: an interpreter opening the store for writing.
  const mentions = targets.some((target) => line.includes(target))
  if (mentions && namesWriter(line)) return true
  return false
}

/** The paths a patch body would touch: a diff names its target after a `*** … File:` marker. */
const diffTargets = (text) => {
  if (!text.includes('***')) return []
  const found = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('***')) continue
    const colon = trimmed.indexOf(':')
    if (colon === -1) continue
    found.push(stripQuotes(trimmed.slice(colon + 1).trim()))
  }
  return found
}

/** Directories a relative path in a tool call may be relative to: the session's cwd, then the process's. */
const guardBases = (execution, cwd) => {
  const bases = []
  const sessionCwd = cwd ?? subjectOf(execution?.agent)?.cwd
  if (typeof sessionCwd === 'string' && sessionCwd !== '') bases.push(resolve(expandHome(sessionCwd)))
  const processCwd = resolve(process.cwd())
  if (!bases.includes(processCwd)) bases.push(processCwd)
  return bases
}

/** Shell rules apply to a shell tool, or to any argument that is itself a command line. */
const scansAsCommand = (name, value) => STORE_SHELL_TOOLS.has(name) || looksLikeCommand(value)

/** Every string nested anywhere in a tool call's arguments, to a bounded depth. */
const stringsIn = (value, out = [], depth = 0) => {
  if (depth > 6 || value === null || value === undefined) return out
  if (typeof value === 'string') {
    out.push(value)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) stringsIn(item, out, depth + 1)
    return out
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) stringsIn(item, out, depth + 1)
    return out
  }
  return out
}

/**
 * The store is this plugin's own instruction source, so a session running under a persona must not be able
 * to rewrite or delete that persona. This guard refuses any call that would write the store (or the history
 * file beside it), decided by what the arguments resolve to rather than by which tools happen to exist.
 *
 * Honest limits, all deliberate: it constrains behaviour rather than enforcing security (a plugin edit, a
 * manual edit, or a path assembled at runtime inside a script still get through), it reads only the strings
 * a tool call carries, and a command line is analysed statically — no shell is run to expand variables.
 */
export const personaStoreGuardReason = (execution, storePath, cwd) => {
  const name = String(execution?.name ?? '')
  // A read-only call cannot write anything, whatever paths it quotes.
  if (STORE_READ_ONLY_TOOLS.has(name)) return undefined
  const values = stringsIn(execution?.arguments)
  const targets = protectedTargetsFor(storePath)
  const bases = guardBases(execution, cwd)
  // A diff body names the file it patches, so the patch string is a path argument in disguise.
  for (const value of values) {
    for (const target of diffTargets(value)) {
      if (protectsPath(target, bases, targets)) return STORE_REFUSAL
    }
  }
  // A command line that would write a protected path, whether it came from a shell tool or a snippet.
  for (const value of values) {
    if (scansAsCommand(name, value) && commandWritesStore(value, bases, targets)) return STORE_REFUSAL
  }
  // A tool that names its own target writes exactly what it points at — under any name, including tools
  // this plugin has never heard of.
  for (const value of values) {
    if (protectsPath(value, bases, targets)) return STORE_REFUSAL
  }
  return undefined
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


// ─────────────────────────────────────────────────────────── version history

/**
 * Opt-in per-persona version history.
 *
 * Every save stores the diff against the previous text (equal runs as counts, changed lines verbatim),
 * so one record costs about as much as the edit rather than the whole document. The first version of a
 * persona is kept as a base snapshot; every later version is reconstructed by replaying the diffs from
 * that base. A hash per entry makes a corrupted or hand-edited history fail loudly instead of restoring
 * the wrong text.
 */
export const HISTORY_VERSION = 1
/** Versions kept per persona; the oldest are folded into the base snapshot when the cap is hit. */
export const MAX_VERSIONS = 200

export const historyPathFor = (storePath) => join(dirname(storePath), 'personas.history.json')

const splitLines = (text) => String(text ?? '').split('\n')

/**
 * Line diff between two texts, as a sequence of equal/removed/added runs.
 *
 * Longest-common-subsequence over lines, with the shared prefix and suffix stripped first. That keeps the
 * usual "edit one paragraph" case cheap; a pathological rewrite falls back to one remove+add pair, which
 * is still a correct (if coarse) diff.
 */
export const diffLines = (beforeText, afterText) => {
  const a = splitLines(beforeText)
  const b = splitLines(afterText)
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1
  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)
  const ops = []
  const pushEqual = (n) => {
    if (n <= 0) return
    const last = ops[ops.length - 1]
    if (last?.t === '=') last.n += n
    else ops.push({ t: '=', n })
  }
  pushEqual(head)
  const n = midA.length
  const m = midB.length
  if (n > 0 && m > 0 && n * m <= 4_000_000) {
    // DP table over the changed middle only.
    const width = m + 1
    const table = new Uint32Array((n + 1) * width)
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        table[i * width + j] = midA[i] === midB[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
      }
    }
    let i = 0
    let j = 0
    let equal = 0
    const flushEqual = () => {
      pushEqual(equal)
      equal = 0
    }
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        equal += 1
        i += 1
        j += 1
        continue
      }
      flushEqual()
      if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
        const last = ops[ops.length - 1]
        if (last?.t === '-') last.lines.push(midA[i])
        else ops.push({ t: '-', lines: [midA[i]] })
        i += 1
      } else {
        const last = ops[ops.length - 1]
        if (last?.t === '+') last.lines.push(midB[j])
        else ops.push({ t: '+', lines: [midB[j]] })
        j += 1
      }
    }
    flushEqual()
    if (i < n) ops.push({ t: '-', lines: midA.slice(i) })
    if (j < m) ops.push({ t: '+', lines: midB.slice(j) })
  } else if (n > 0 || m > 0) {
    if (n > 0) ops.push({ t: '-', lines: midA.slice() })
    if (m > 0) ops.push({ t: '+', lines: midB.slice() })
  }
  pushEqual(tail)
  return ops
}

/**
 * Replay a diff onto a text. Equal runs count lines from the current text (their content is not stored, which
 * is what keeps a record small); removals are checked against it so a mismatched history throws instead of
 * silently producing a different document.
 */
export const applyDiff = (text, ops) => {
  const lines = splitLines(text)
  const out = []
  let at = 0
  for (const op of Array.isArray(ops) ? ops : []) {
    if (op?.t === '=') {
      const n = Math.max(0, Number(op.n) || 0)
      for (let k = 0; k < n; k += 1) {
        if (at >= lines.length) throw new Error('版本历史损坏：相等的行超出当前文本')
        out.push(lines[at])
        at += 1
      }
    } else if (op?.t === '-') {
      const gone = Array.isArray(op.lines) ? op.lines : []
      for (const line of gone) {
        if (lines[at] !== line) throw new Error('版本历史损坏：删除的行与当前文本不一致')
        at += 1
      }
    } else if (op?.t === '+') {
      for (const line of Array.isArray(op.lines) ? op.lines : []) out.push(line)
    }
  }
  while (at < lines.length) {
    out.push(lines[at])
    at += 1
  }
  return out.join('\n')
}

/** `+n / -m` summary used by the list row. */
export const diffStats = (ops) => {
  let added = 0
  let removed = 0
  for (const op of Array.isArray(ops) ? ops : []) {
    if (op?.t === '+') added += op.lines.length
    if (op?.t === '-') removed += op.lines.length
  }
  return { added, removed }
}

const readHistory = (storePath, warn) => {
  const file = historyPathFor(storePath)
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') warn(`could not read the version history; starting a fresh one`, error)
    return { version: HISTORY_VERSION, personas: {} }
  }
  const parsed = (() => {
    try {
      return JSON.parse(raw)
    } catch (error) {
      warn(`the version history is not JSON; keeping a copy and starting a fresh one`, error)
      return undefined
    }
  })()
  // A history file whose `personas` is an array used to be accepted and then silently dropped every write
  // (JSON.stringify of an array ignores the string keys the recorder adds). Keep a copy, start over.
  const usable = parsed !== undefined && parsed !== null && typeof parsed === 'object' && parsed.personas !== null
    && typeof parsed.personas === 'object' && !Array.isArray(parsed.personas)
  if (usable) return { version: HISTORY_VERSION, personas: parsed.personas }
  if (parsed !== undefined) warn(`the version history has an unusable shape; keeping a copy and starting a fresh one`)
  // Whatever was there is about to be replaced: keep the bytes rather than deleting the only record of them.
  try {
    const backupPath = `${file}.bak-${backupStamp()}`
    copyFileSync(file, backupPath)
    chmodSync(backupPath, 0o600)
  } catch (error) {
    if (error?.code !== 'ENOENT') warn(`could not keep a copy of the malformed version history`, error)
  }
  return { version: HISTORY_VERSION, personas: {} }
}

const persistFile = (file, text, mode) => {
  writeFileDurable(file, text, mode)
}

const writeHistory = (storePath, history, warn) => {
  const file = historyPathFor(storePath)
  try {
    mkdirSync(dirname(file), { recursive: true })
    persistFile(file, `${JSON.stringify(history)}\n`, 0o600)
  } catch (error) {
    warn(`could not write the version history`, error)
  }
}

/** Current text of one stored version (index 0 is the oldest kept version). */
export const versionTextAt = (entryState, index) => {
  const state = entryState
  if (!state || typeof state.base !== 'string') throw new Error('这条人设还没有版本历史')
  const versions = Array.isArray(state.versions) ? state.versions : []
  if (!Number.isInteger(index) || index < 0 || index >= versions.length) throw new Error('版本不存在')
  let text = state.base
  for (let k = 0; k <= index; k += 1) text = applyDiff(text, versions[k].ops)
  return text
}

/**
 * Does the stored chain still describe the text this persona has right now? The store is a plain JSON file
 * that people are welcome to edit by hand, so a chain can legitimately drift out of step with it. When it
 * has, replaying the chain would throw on every later read; the recorder re-bases instead.
 */
const chainMatches = (state, beforeText) => {
  const versions = Array.isArray(state.versions) ? state.versions : []
  if (versions.length === 0) return state.base === beforeText
  try {
    let text = state.base
    for (const version of versions) text = applyDiff(text, version.ops)
    return text === beforeText
  } catch {
    return false
  }
}

/**
 * Record one new version. `before` is the text the persona had, `after` the text it now has.
 * Returns false when the history is off or nothing changed.
 */
export const recordVersion = (history, personaId, before, after, action, now = new Date().toISOString()) => {
  const beforeText = String(before ?? '')
  const afterText = String(after ?? '')
  if (beforeText === afterText) return false
  const ops = diffLines(beforeText, afterText)
  const stats = diffStats(ops)
  let state = history.personas[personaId]
  if (state === undefined || typeof state.base !== 'string') {
    state = { base: beforeText, baseAt: now, versions: [] }
    history.personas[personaId] = state
  } else if (!chainMatches(state, beforeText)) {
    // The stored chain no longer reproduces the current text (hand edit, partial write, older bug). Start a
    // new baseline from what the persona says now: the past is no longer recoverable, but the future is.
    state.base = beforeText
    state.baseAt = now
    state.versions = []
  }
  state.versions.push({
    at: now,
    action,
    ops,
    added: stats.added,
    removed: stats.removed,
    hash: createHash('sha256').update(afterText, 'utf8').digest('hex').slice(0, 16),
    size: Buffer.byteLength(afterText, 'utf8'),
  })
  // Fold the oldest versions into the base once the cap is hit, so every kept version stays replayable.
  while (state.versions.length > MAX_VERSIONS) {
    const [oldest] = state.versions.splice(0, 1)
    state.base = applyDiff(state.base, oldest.ops)
    state.baseAt = oldest.at
  }
  return true
}

// ─────────────────────────────────────────────────────────── matching

const regexCache = new Map()
/** A pattern that cannot match profitably is a hang, not a match: cap the length and the cache. */
const MAX_REGEX_LENGTH = 500
const MAX_REGEX_CACHE = 64

const compile = (value) => {
  const pattern = String(value ?? '')
  if (pattern.length > MAX_REGEX_LENGTH) return undefined
  if (regexCache.has(pattern)) return regexCache.get(pattern)
  let compiled
  try {
    compiled = new RegExp(pattern)
  } catch {
    compiled = undefined
  }
  if (regexCache.size >= MAX_REGEX_CACHE) regexCache.clear()
  regexCache.set(pattern, compiled)
  return compiled
}

const subjectFor = (target, subject) => (target.kind === 'sessionId' ? subject.sessionId : subject.cwd)

/** Windows and macOS compare these case-insensitively in practice; a strict compare would just miss. */
const pathKey = (value) => {
  const resolved = resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** Same file, however it was spelled (`~`, `..`, trailing slash). */
const samePath = (left, right) => pathKey(left) === pathKey(right)

/**
 * Is `path` inside `prefix`? A prefix is a directory, so the match has to end on a separator boundary:
 * `/home/me/dsh-agent` is not inside `/home/me/dsh`, and a project next door must not pick up a persona.
 */
const pathWithin = (path, prefix) => {
  const key = pathKey(path)
  const boundary = pathKey(prefix).replace(new RegExp(`${sep === '\\' ? '\\\\' : sep}+$`), '')
  return key === boundary || key.startsWith(`${boundary}${sep}`)
}

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
  // Path targets compare resolved paths (so `~`, `..`, and a trailing slash still match) and stop on a
  // separator boundary (so a sibling directory with a longer name is not "inside"). Patterns on session ids
  // keep comparing the raw strings, which is what makes a plain substring like `project-x` usable on a cwd.
  switch (target.match) {
    case 'exact':
      return isPath ? samePath(raw, expandHome(value)) : raw === value
    case 'prefix':
      return isPath ? pathWithin(raw, expandHome(value)) : raw.startsWith(value)
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
  // A cut that lands between the halves of a surrogate pair produces a lone surrogate, which is not valid
  // UTF-8: the transport replaces it with U+FFFD and the message ships with a visible broken character.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1)
  const fences = (cut.match(/^```/gm) ?? []).length
  if (fences % 2 === 1) {
    const opening = cut.lastIndexOf('\n```')
    cut = opening === -1 ? '' : cut.slice(0, opening)
  }
  if ((cut.match(/`/g) ?? []).length % 2 === 1) cut = cut.slice(0, cut.lastIndexOf('`'))
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1)
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
      return { error: `listPersonas failed: ${errorMessage(error)}` }
    }
  }

  /** Merge one or more interface preferences and return the refreshed view. */
  async savePrefs(input) {
    try {
      return this.runtime.savePrefs(input)
    } catch (error) {
      return { error: `savePrefs failed: ${errorMessage(error)}` }
    }
  }

  /** Create (no `id`) or update (with `id`) one persona. */
  async savePersona(input) {
    try {
      return this.runtime.save(input)
    } catch (error) {
      return { error: `savePersona failed: ${errorMessage(error)}` }
    }
  }

  /** Version list for one persona (opt-in history). */
  async listVersions(input) {
    try {
      return this.runtime.listVersions(input)
    } catch (error) {
      return { error: `listVersions failed: ${errorMessage(error)}` }
    }
  }

  /** One stored version with its diff. */
  async versionDiff(input) {
    try {
      return this.runtime.versionDiff(input)
    } catch (error) {
      return { error: `versionDiff failed: ${errorMessage(error)}` }
    }
  }

  /** Restore a stored version as the current persona text. */
  async restoreVersion(input) {
    try {
      return this.runtime.restoreVersion(input)
    } catch (error) {
      return { error: `restoreVersion failed: ${errorMessage(error)}` }
    }
  }

  /** Remove one persona. */
  async deletePersona(input) {
    try {
      return this.runtime.remove(input)
    } catch (error) {
      return { error: `deletePersona failed: ${errorMessage(error)}` }
    }
  }

  /** Move one persona up/down: the list order IS the priority order. */
  async movePersona(input) {
    try {
      return this.runtime.move(input)
    } catch (error) {
      return { error: `movePersona failed: ${errorMessage(error)}` }
    }
  }

  /** Copy one persona (created disabled, so a copy changes nothing). */
  async duplicatePersona(input) {
    try {
      return this.runtime.duplicate(input)
    } catch (error) {
      return { error: `duplicatePersona failed: ${errorMessage(error)}` }
    }
  }

  /** Explain which persona a given cwd/session would get, and why. */
  /** The persona view: which persona a session uses, and the prompt it last sent. */
  async sessionPrompt(input) {
    try {
      return await this.runtime.sessionPrompt(input)
    } catch (error) {
      return { error: `sessionPrompt failed: ${errorMessage(error)}` }
    }
  }

  async sessionHistory(input) {
    try {
      return await this.runtime.history(input)
    } catch (error) {
      return { error: `sessionHistory failed: ${errorMessage(error)}` }
    }
  }

  async reorderPersona(input) {
    try {
      return this.runtime.reorder(input)
    } catch (error) {
      return { error: `reorderPersona failed: ${errorMessage(error)}` }
    }
  }

  async listTargets() {
    try {
      return await this.runtime.targets()
    } catch (error) {
      return { error: `listTargets failed: ${errorMessage(error)}` }
    }
  }

  /** Rewrite a persona with the configured model; returns a proposal, saves nothing. */
  async tunePersona(input) {
    try {
      return await this.runtime.tune(input)
    } catch (error) {
      return { error: `tunePersona failed: ${errorMessage(error)}` }
    }
  }

  /** Models the tuning panel may target (host model catalog, best effort). */
  async listModels() {
    try {
      return await this.runtime.models()
    } catch (error) {
      return { error: `listModels failed: ${errorMessage(error)}`, models: [] }
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

markRemote(WorkspacePersonaService, [...RPC_ENDPOINTS])

/** The Connection RPC channel the browser half calls into (see the plugin standard). */

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
  let loaded = loadStore(storePath, warn)
  let store = loaded.store
  /** Set when the file on disk could not be used; cleared once it has been preserved and replaced. */
  let reset = loaded.reset
  /** Where the unreadable file was preserved, once that has happened. */
  let resetBackup = ''
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
      loaded = loadStore(storePath, warn)
      store = loaded.store
      // A fresh reset supersedes the previous record; our own write, which also moves the stamp, must not
      // erase the note about where the original was preserved.
      if (loaded.reset !== undefined) resetBackup = ''
      reset = loaded.reset
      storeStamp = stamp
    }
    return store
  }
  const currentStore = () => (storeStamp === stampOf() ? store : reload())

  /**
   * Every write goes through here, and it is the only place the in-memory store changes: callers hand it a
   * complete next state and it persists that state before adopting it. Keeping the assignment here means a
   * failed write leaves memory exactly as it was — the old code mutated the live object first, so a thrown
   * `persist` left the process believing it had saved something that never reached disk.
   */
  const commit = (next) => {
    if (reset !== undefined) {
      resetBackup = backupStoreFile(storePath, backupStamp())
      info(`preserved the unreadable store at ${resetBackup}`)
      reset = undefined
    }
    persist(next, storePath)
    store = next
    // Adopt the stamp of what we just wrote: without this, the next read sees a changed file and reloads,
    // throwing away the state this commit just installed (and the backup note that goes with it).
    storeStamp = stampOf()
  }

  /** A store a caller may mutate freely; committing it is what makes the change real. */
  const editableStore = () => JSON.parse(JSON.stringify(currentStore()))

  const storeHealth = () => {
    if (reset !== undefined) return { status: 'reset', path: storePath, reason: reset.reason, willBackup: true }
    if (resetBackup !== '') return { status: 'backed-up', path: storePath, backupPath: resetBackup }
    return { status: 'ok' }
  }

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

  // The store is this plugin's instruction source, so no tool call may write it. The guard is monotonic: once
  // it refuses a call nothing later can allow it. Registered through the effect, so unloading the plugin
  // removes it instead of leaving a process-wide refusal behind.
  //
  // One registration whose body reads the live preference, rather than registering and removing it: the switch
  // then applies to the next tool call, and there is only ever one path that can leave a guard behind.
  ctx.effect(() => ctx.tools.guard((execution) => (currentStore().prefs.guard === false
    ? undefined
    : personaStoreGuardReason(execution, storePath))), 'agent-persona.store-guard')
  info(`store guard registered for ${storePath} (the 禁止模型改写人设文件 preference turns it off)`)

  /** Target decorated with the flags the page needs to explain itself. */
  const describeTarget = (target) => ({
    ...target,
    invalid: target.value.trim() === '' || (target.match === 'regex' && compile(target.value) === undefined),
  })

  /**
   * The version of the copy that is actually running, and where it was loaded from — read from the
   * package beside this module, so a development checkout and an npm install report different things.
   */
  const PLUGIN_INFO = (() => {
    try {
      const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
      return {
        version: typeof manifest?.version === 'string' ? manifest.version : '',
        origin: fileURLToPath(import.meta.url).split(sep).includes('node_modules') ? 'npm' : 'local',
      }
    } catch {
      return { version: '', origin: 'unknown' }
    }
  })()

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
      prefs: normalizePrefs(current.prefs),
      storeHealth: storeHealth(),
      pluginVersion: PLUGIN_INFO.version,
      installOrigin: PLUGIN_INFO.origin,
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

  /**
   * Normalize one save payload. Every field is "only when the payload names it": a request that updates the
   * name must not clear the text or re-enable a disabled persona, which is what defaulting missing fields
   * to empty values used to do. `existing` supplies the values for fields the payload leaves out; a create
   * request (no existing persona) falls back to the same defaults the UI shows.
   */
  const normalizeInput = (input, existing) => {
    const mentions = (field) => input !== null && typeof input === 'object' && field in input
    const current = existing ?? {}
    const text = mentions('text') ? (typeof input.text === 'string' ? input.text : '') : (typeof current.text === 'string' ? current.text : '')
    if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw new Error(`人设文本过长（上限 ${MAX_TEXT_BYTES} 字节）`)
    const rawTargets = mentions('targets') ? (Array.isArray(input.targets) ? input.targets : []) : (Array.isArray(current.targets) ? current.targets : [])
    const targets = rawTargets
      .map(normalizeTarget)
      .filter((target) => target.value.trim() !== '')
    const rawName = mentions('name') ? input.name : current.name
    const rawMode = mentions('mode') ? input.mode : current.mode
    return {
      id: typeof input?.id === 'string' && input.id !== '' ? input.id : undefined,
      name: typeof rawName === 'string' && rawName.trim() !== '' ? rawName.trim() : '未命名人设',
      enabled: mentions('enabled') ? input.enabled !== false : current.enabled !== false,
      // 默认人设：没有位置命中时使用它（优先级最低的保底），同一时刻只允许一条。
      fallback: mentions('fallback') ? input.fallback === true : current.fallback === true,
      mode: rawMode === 'replace' ? 'replace' : 'append',
      text,
      targets,
    }
  }

  /** Read + write the history file around one mutation; a disabled switch costs nothing. */
  const historyEnabled = () => currentStore().prefs?.history === true
  const recordIfEnabled = (personaId, before, after, action) => {
    if (!historyEnabled() || personaId === undefined) return
    const history = readHistory(storePath, warn)
    if (!recordVersion(history, personaId, before, after, action)) return
    writeHistory(storePath, history, warn)
  }

  /** Forget a deleted persona's versions; the history of something that no longer exists is just growth. */
  const dropHistory = (personaId) => {
    try {
      const history = readHistory(storePath, warn)
      if (!(personaId in history.personas)) return
      delete history.personas[personaId]
      writeHistory(storePath, history, warn)
    } catch (error) {
      warn(`could not drop the version history of a deleted persona`, error)
    }
  }

  const runtime = {
    view,
    /** Version list for one persona (newest first for display, indices stay oldest-first). */
    listVersions(input) {
      const id = typeof input?.id === 'string' ? input.id : ''
      const persona = currentStore().personas.find((item) => item.id === id)
      if (persona === undefined) throw new Error('人设不存在（可能已被删除）')
      const history = readHistory(storePath, warn)
      const state = history.personas[id]
      const versions = Array.isArray(state?.versions) ? state.versions : []
      return {
        id,
        name: persona.name,
        enabled: historyEnabled(),
        baseAt: state?.baseAt ?? '',
        max: MAX_VERSIONS,
        current: persona.text,
        versions: versions.map((version, index) => ({
          index,
          at: version.at,
          action: version.action,
          added: version.added,
          removed: version.removed,
          size: version.size,
          preview: (version.ops ?? []).find((op) => op.t === '+')?.lines?.[0] ?? '',
        })),
      }
    },
    /** One version with the text it produced and the diff against the version before it. */
    versionDiff(input) {
      const id = typeof input?.id === 'string' ? input.id : ''
      const persona = currentStore().personas.find((item) => item.id === id)
      if (persona === undefined) throw new Error('人设不存在（可能已被删除）')
      const history = readHistory(storePath, warn)
      const state = history.personas[id]
      const index = Number(input?.index)
      const version = state?.versions?.[index]
      if (version === undefined) throw new Error('版本不存在')
      const after = versionTextAt(state, index)
      const before = index === 0 ? state.base : versionTextAt(state, index - 1)
      return {
        id,
        index,
        at: version.at,
        action: version.action,
        added: version.added,
        removed: version.removed,
        ops: version.ops,
        before,
        after,
        current: persona.text,
      }
    },
    /** Put a stored version back as the persona text; the restore itself is recorded as a new version. */
    restoreVersion(input) {
      const current = editableStore()
      const id = typeof input?.id === 'string' ? input.id : ''
      const persona = current.personas.find((item) => item.id === id)
      if (persona === undefined) throw new Error('人设不存在（可能已被删除）')
      const history = readHistory(storePath, warn)
      const text = versionTextAt(history.personas[id], Number(input?.index))
      const before = persona.text
      persona.text = text
      commit(current)
      recordIfEnabled(id, before, text, 'restore')
      info(`restored persona "${persona.name}" to version ${String(input?.index)}`)
      const result = view()
      result.notice = `已恢复到第 ${Number(input?.index) + 1} 个版本`
      return result
    },
    /** Merge preferences into the store; every field is optional so one switch can be saved. */
    savePrefs(input) {
      const current = editableStore()
      current.prefs = normalizePrefs({ ...current.prefs, ...(input ?? {}) })
      commit(current)
      info(`preferences saved: ${JSON.stringify(current.prefs)}`)
      return view()
    },
    save(input) {
      const current = editableStore()
      const next = normalizeInput(input, current)
      const beforeText = next.id === undefined ? '' : (current.personas.find((item) => item.id === next.id)?.text ?? '')
      const created = next.id === undefined
      let persona
      if (next.id === undefined) {
        persona = { id: newId(), name: next.name, enabled: next.enabled, fallback: next.fallback, text: next.text, mode: next.mode, targets: next.targets }
        current.personas.push(persona)
        info(`created persona "${next.name}" (${current.personas.length} total)`)
      } else {
        persona = current.personas.find((item) => item.id === next.id)
        if (persona === undefined) throw new Error('人设不存在（可能已被删除）')
        // `normalizeInput` already filled every field the payload left out from the stored persona, so this
        // assignment cannot erase a field the caller never mentioned.
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
      commit(current)
      if (next.text !== beforeText) recordIfEnabled(persona.id, beforeText, next.text, created ? 'create' : 'update')
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
      const current = editableStore()
      const id = typeof input?.id === 'string' ? input.id : ''
      const before = current.personas.length
      current.personas = current.personas.filter((persona) => persona.id !== id)
      if (current.personas.length === before) throw new Error('人设不存在（可能已被删除）')
      commit(current)
      // The versions belong to a persona that no longer exists; keeping them grows the history file forever
      // and leaves every replay of a deleted id in the store's own file.
      dropHistory(id)
      info(`deleted persona ${id}`)
      return view()
    },
    move(input) {
      const current = editableStore()
      const id = typeof input?.id === 'string' ? input.id : ''
      const delta = input?.delta === 1 ? 1 : input?.delta === -1 ? -1 : 0
      const from = current.personas.findIndex((persona) => persona.id === id)
      if (from < 0) throw new Error('人设不存在（可能已被删除）')
      const to = Math.min(current.personas.length - 1, Math.max(0, from + delta))
      if (to !== from) {
        const [moved] = current.personas.splice(from, 1)
        current.personas.splice(to, 0, moved)
        commit(current)
      }
      return view()
    },
    duplicate(input) {
      const current = editableStore()
      const id = typeof input?.id === 'string' ? input.id : ''
      const from = current.personas.findIndex((persona) => persona.id === id)
      if (from < 0) throw new Error('人设不存在（可能已被删除）')
      const source = current.personas[from]
      // Copies start disabled: adding one must never change what any session gets.
      current.personas.splice(from + 1, 0, {
        id: newId(),
        name: `${source.name} 副本`,
        enabled: false,
        // A copy is not the default persona, but it is the same kind of persona: a `replace` copy that
        // degraded to `append` would quietly change what the copy means once someone enables it.
        fallback: false,
        mode: source.mode === 'replace' ? 'replace' : 'append',
        text: source.text,
        targets: clone(source.targets),
      })
      commit(current)
      info(`duplicated persona "${source.name}" (copy starts disabled)`)
      return view()
    },
    /** Drop a persona at an absolute position (what a drag-and-drop emits). */
    reorder(input) {
      const id = typeof input?.id === 'string' ? input.id : ''
      const toIndex = Number.isFinite(input?.toIndex) ? Math.trunc(input.toIndex) : -1
      const current = editableStore()
      if (!current.personas.some((persona) => persona.id === id)) throw new Error('人设不存在（可能已被删除）')
      if (reorderPersonas(current, id, toIndex)) {
        commit(current)
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
    // Written through the same durable path as the store: a reader that catches this file mid-write used to
    // see half a JSON document, and that is indistinguishable from a corrupt heartbeat.
    writeFileDurable(HEARTBEAT_FILE, `${JSON.stringify({
      loadedAt: new Date().toISOString(),
      loadedModule: fileURLToPath(import.meta.url),
      pluginVersion: PLUGIN_INFO.version,
      installOrigin: PLUGIN_INFO.origin,
      storePath,
      storeVersion: store.version,
      personas: store.personas.length,
      sectionName: SECTION_NAME,
      sectionOrder: order,
    }, null, 2)}\n`, 0o600)
  } catch (error) {
    warn('could not write the load heartbeat', error)
  }
}
