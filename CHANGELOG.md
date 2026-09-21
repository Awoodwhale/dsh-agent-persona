# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-09-21

### Fixed

- **The sidebar card could be missing after a restart even though the switch showed it on.** The two read
  different sources: the switch shows the store's `prefs.showSidebar` (through the remote view), while the
  registration resolved the sidebar service once, when this plugin applied, and gave up for good if it was not
  there yet. Plugin load order is not guaranteed, so a restart could put this plugin's client half before the
  sidebar plugin's; the card then only came back by toggling the switch by hand. The service is now awaited —
  registered immediately when it is already present, otherwise through `ctx.inject(['betterSidebar'], …)` and
  bound to the arriving context, so it is torn down with the provider. The switch still acts at once.

### Added

- A `screenshots.json` in the repository, so storefronts show the three interface screenshots and they can be
  replaced by pushing here rather than by opening a pull request elsewhere.

## [0.1.1] - 2026-09-20

### Added

- **A readable store is protected before it is replaced.** A store file that exists but cannot be read used to
  look exactly like an empty one, and the next save replaced it. The page now says what happened and why, and
  the first write copies the original to `personas.json.bak-<timestamp>` before touching it. If the copy fails
  the write fails with it, so content nothing preserved is never destroyed.
- **The persona store is no longer writable by tools.** A monotonic `ctx.tools.guard` refuses any call whose
  arguments point at the store and any shell command that mentions it together with a write feature
  (`>`, `rm`, `mv`, `cp`, `chmod`, `sed -i`, `tee`, `truncate`, …), while reads (`cat`, `md5`, …) stay allowed.
  A session running under a persona can therefore no longer rewrite or delete that persona. It is a
  **preference** (`禁止模型改写人设文件`), on by default, and the guard reads it live so a toggle applies to the
  next tool call. It is a behavioural limit, not a security boundary, and the switch says so on hover.
- **导入 / 导出.** Export writes a JSON file (and copies it to the clipboard); import takes a chosen file or a
  pasted document, **previews as you type** every persona with its size and reach, and creates them through the
  same `savePersona` call the page uses, so a document cannot bypass the host's validation. Imported personas are
  always created **disabled** and appended at the end, and the default slot is never taken over. The dialog
  colours the JSON in place, draws its own thin scrollbar, and offers the replace-everything restore behind a
  switch that names the count it would delete.
- **A release workflow** (`.github/workflows/release.yml`): publishing a GitHub Release whose tag matches
  `package.json` runs the same build/typecheck/test gates as CI and publishes to npm through Trusted Publishing
  (OIDC) — no `NPM_TOKEN`, provenance attached, prereleases going to the `next` dist-tag.
- Source links and the running version beside the settings title: GitHub and npm as two small pills carrying the
  real brand marks (inlined from simple-icons, `currentColor`, no hardcoded colours), plus the version of the
  copy actually running. The version comes from the host reading its own `package.json`, so a checkout and an npm
  install report different things — and the tooltip says which one this is. The same two fields go into the
  load heartbeat.

### Changed

- **The header spacing follows the host's own rhythm.** The title, description and counts now sit on a uniform
  12px gap, and the extra 10px margin on the preference row is gone: the counts, the switches and the cards are
  14px apart, the distance the settings shell itself uses between blocks.
- The reported test counts are counted rather than written down: both suites wrap `assert` and report what ran,
  so the number can no longer fall behind the file (200 host assertions, 165 client assertions).
- **Opening and closing a card is one CSS transition**, driven by the class the card already carries: a grid row
  interpolating between `0fr` and `1fr`, over one easing and one duration in both directions. Nothing is timed,
  nothing is unmounted, and no transform is involved, so a fixed-position tooltip can never be captured by it.
  The scope line under the header collapses in the opposite direction over the same span — it used to be mounted
  and unmounted with the state, which made the whole card jump by its height the moment a card was opened.
- The card's chevron turns exactly **90°**: it keeps one glyph, rotated by CSS. Swapping in a down-chevron as
  well turned it twice, so an open card pointed the wrong way.
- **Each preference explains itself on hover.** The switches used to carry their own label as a native tooltip,
  which explained nothing: `保护人设文件` became `禁止模型改写人设文件`, and every switch now has a real tooltip
  (also folded into its accessible name) saying what it does and what it does not.
- **Nothing is added to Settings → General.** The switches live on the Agent 人设 page alone, which none of them
  can hide, so that page is the way back from any of them.

### Fixed

- A note about a preserved store no longer disappears the moment it becomes true: a reload only clears the
  record for a *fresh* reset, not for the stamp change caused by our own write.
- **Tooltips opened inside the view or the sidebar card landed in the wrong place.** The entry animations filled
  forwards, and a transform keyframe that ends at `transform: none` still leaves an identity matrix — which
  counts as a transform, and therefore made the panel the containing block for the UI kit's fixed-position
  bubble. Every animation now fills backwards, so the final state is the element's own style, and reduced-motion
  covers the new ones too.
- **`scripts/install.sh` and `scripts/install.ps1` were rewritten**: they still carried the pre-rename package
  name, the old heartbeat path and the old page title. They now install `dsh-agent-persona`, print the version of
  the checkout, state the real store and heartbeat paths, offer upgrade and removal, and refuse a path target
  that does not exist — the CLI writes a `link:` dependency for whatever it is given, so a typo silently became a
  broken profile entry.

## [0.1.0] - 2026-09-17

### Added

- **Many personas, each scoped independently.** A persona is a first-class record
  (`id` / `name` / `enabled` / `text` / `targets[]`), and every target is
  `{ kind: 'workspace' | 'sessionId', match: 'exact' | 'prefix' | 'regex' | 'contains', value }`.
- **An explicit default persona** (`默认人设`) with a `fallback` flag: it takes every session no reach rule
  claimed, and only one persona can hold it — marking a new one releases the previous.
- **Dropdown scope pickers.** The settings page fills its pickers from the host's
  workspaces and from DSH's own sessions (newest first, with title, working
  directory and a relative timestamp), so nobody has to type a path or a session
  id. The two kinds are mutually exclusive per row — switching a row's type clears
  its value — and "自己输入…" keeps the advanced match modes reachable.
- **System-prompt injection** as section `agent-persona` at order 1
  (`DEPLOYMENT_PERSONA_PREFIX + 1`), i.e. above the workspace `AGENTS.md`, with
  `append` (default) and `replace` injection modes.
- **A 人设 tab on the conversation page**: which persona the session matched, the system prompt it actually sent
  (rendered and source views), and the full management UI in place.
- **A sidebar card** for `dsh-better-sidebar`, registered through that plugin's own service. The switch that
  controls it is **not shown at all** when that plugin is absent.
- **Interface preferences** — `编辑后自动保存`, `在对话页显示「人设」标签`, `注册到 dsh-better-sidebar` — stored in the
  persona file's `prefs` field, so they share the data's scope; the browser keeps only a load-time mirror.
- **Session history**: pick a session, hit the button next to the picker, and read that conversation. Reads are
  windowed (`sessionHistory({id, offset, events})`) so the log is never read up front: the page shows what it
  got, reports 已显示 N 条, and only reads the next window when 继续加载 is pressed. Messages are capped at 4000
  characters, and 展开全文 replaces a single bubble by reading that one event again (`offset: at, events: 1`).
- **AI rework** (polish / expand / compress / draft) that uses the model DSH itself
  is set to use, overridable per deployment with `tuneProvider` / `tuneModel`. It
  only ever produces a proposal.
- **Search** appears once a profile holds four or more personas and filters on name, workspace title/path and
  session title/id, with an explicit 「没有匹配「…」的人设」 state.
- **Drag to reorder**: a grip on each card header drags it to an absolute position (new `reorderPersona` remote
  method, `reorderPersonas` is the exported pure function); the ⋯ menu's 上移/下移 stay as the keyboard path.
- **A Schemastery config**: `storePath`, `tuneProvider`, `tuneModel`, validated when the row loads.
- **TypeScript sources with a build**: `src/**` compiles to `lib/`, and a generator derives the remote artifacts
  (`src/remote.ts`, `src/typert.ts`) from the single endpoint list in `src/endpoints.ts`; `npm test` fails if the
  generated files drift.
- **One directory for the data**: `$DSH_HOME/dsh-agent-persona/` holds
  `personas.json` and a `state.json` heartbeat. The data is re-read on every prompt
  assembly (mtimeNs/size stamp), so an edit applies to the next message.
- **Zero runtime dependencies** for the host: the client half is bundled by esbuild, the host half is plain ESM,
  and `npm test` runs both offline suites.

### Changed

- **Resolution is specificity-first.** A session-id rule outranks a workspace rule and an exact value outranks a
  pattern (`targetSpecificity`); list order only breaks ties between equally specific rules. A persona pointed at
  one exact session therefore beats a persona pointed at the whole directory, whatever the order.
- **A persona with no reach applies nowhere.** A place-less persona is a draft, and where nothing matched the
  harness prompt stands; `默认人设` is the explicit way to ask for a fallback.
- **Replace mode also drops the harness identity line**, not only the deployment's persona line.
- **Exactly one persona per workspace or session.** A save that claims a place takes it away from the persona
  that held it (exact values only, reported back to the page), and the pickers label places that are already
  taken.
- The collapsed card keeps only what reads at a glance — chevron, state dot, name, state, scope chips — and
  reordering / duplicating / deleting moved into the card's `⋯` menu.
- The status line is sticky at the bottom of the page so save/error feedback stays visible while the list
  scrolls; icon buttons grew from 24px to 28px hit targets.
- The session picker shows how often each session was talked to (`sessionStats.turns`), beside the short id and
  age, and sessions are labelled with their DSH title or their first prompt.
- Renamed the package from `dsh-workspace-persona` to **`dsh-agent-persona`**. Everything it writes now lives in
  `$DSH_HOME/dsh-agent-persona/`.
- Display preferences take effect immediately rather than on the next page load: the conversation view and the
  sidebar card are registered and unregistered at runtime.

### Fixed

- **跳到最新 did nothing**: the runtime forwarded a hand-written subset of the history options and dropped
  `tail` / `keep`, so the call degraded to a normal head read while the dialog labelled it as the tail. The
  forwarding is now an exported, asserted `historyOptions`.
- 跳到最新 kept a fixed four-message window, so a turn where the agent answered several times pushed the user's
  question out of it. The tail now returns everything from the **last user input** onwards (bounded at 60
  messages while walking).
- A message whose Markdown failed to render fell back to plain text **as a whole**, which is what made some
  bubbles show raw Markdown. Messages are now split into bounded Markdown-safe chunks (blank-line boundaries,
  never inside a code fence) and each chunk renders on its own: one awkward chunk degrades with a visible note,
  the rest of the message still renders.
- **Sessions could not be read at all**: `sessionPersistence.open(id, access)` takes the access mode as a
  second, required argument; the reader called `open(id)` and every candidate failed, so the conversation
  dialog always reported "no reader". It now opens with `'read'` (never taking write ownership) and retries
  id-only signatures for version tolerance.
- **Empty sessions are no longer offered.** A session created with a preset but never typed into
  (`sessionListMetadata.blank`, the same flag the sidebar hides on) holds no conversation to give a persona, so
  the picker drops it and counts it in the hidden tally.
- **Sub-agent and archived sessions no longer appear in the picker.** A sub-agent session (spawned by the
  model: `origin: 'subagent'` or `delegationDepth > 0`) and an archived one cannot be opened or typed into from
  the sidebar, so listing them invited personas that could never apply. The page reports how many were hidden.
- The remote manifest is generated in the shape the mount consumes: an `id` per descriptor, a strict input codec,
  `parameters: []` for the reads that take none, and the service name `agentPersona`.
- The default flag survives a store round trip again — the reader no longer drops it — and a save whose payload
  omits the flag keeps the stored value instead of clearing it.
- The session view's own draft and dirty check cover the default flag, and its switch no longer calls a method
  that only the settings component has. Together those made the switch look inert and let a save turn it off.
- The conversation dialog hides plugin-injected user-side content — `AGENTS.md`, runtime snapshots, the skill
  catalog, goal rounds — reporting only 「已隐藏 N 条插件注入内容」.

[0.1.2]: https://github.com/Awoodwhale/dsh-agent-persona/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Awoodwhale/dsh-agent-persona/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Awoodwhale/dsh-agent-persona/releases/tag/v0.1.0
