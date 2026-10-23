# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.7] - 2026-10-23

### Fixed

- **开关的 toast 只讲自己那件事。** 提示文案原来只对两个显示开关按 `patch` 取，其余一律按
  `next.autosave` 计算，于是拨动「禁止模型改写人设文件」或「保存人设版本历史」时弹出来的是
  「编辑后自动保存」——一个这次根本没碰的开关的话。现在每个偏好各有一条按方向分岔的句子
  （`PREF_STATUS`），键从 `patch` 上读，未知键退化成「已保存」。
- **同一句提示连拨两次也会再弹一次。** toast 原来用固定 `key`，第二次拨回同一状态时 React 复用
  同一个组件实例：文案一样、key 一样，定时器继续走，屏幕上看不到新提示。现在 `status` 每次写入都
  推进一个 `statusSeq`，toast 按它做 key，重复的句子也会重新挂载。这也是「开启没反应、关闭才弹」
  的成因之一：两个方向的文案本来就相同，第二次写入被吞掉了。
- 顺带把「关闭自动保存」的文案从「已关闭：编辑后自动保存」改成「已关闭：改完要自己点保存」。原文案
  在关闭状态下仍然宣称会自动保存。

## [0.1.6] - 2026-10-22

### Added

- **人设版本历史（可选开关）。** 设置页新增「保存人设版本历史」，默认关闭。打开后每次保存正文都会
  追加一条 diff 到 `personas.history.json`（与主存储同目录、0600）：相等行只记行数，变更行原文保留，
  因此一条记录的成本约等于这次改动本身，而不是整份正文。
- 编辑器底部新增「版本历史」按钮：左侧列出版本（时间、`+a / −r`、首个改动行），右侧显示该版相对上一版的
  逐行 diff（红删绿增，未改动段折叠成行数）。「恢复到此版本」把选中版本写回当前人设，并且恢复本身也记成
  一条新记录，所以恢复错了还能再回滚。
- 新 RPC：`listVersions` / `versionDiff` / `restoreVersion`（远程产物由 `npm run generate:remote` 生成）。
- 链式存储：第一条版本作为 base 快照，之后每版只在上一版上重放 diff；超过 `MAX_VERSIONS`（200）时把最旧的
  几条折进 base，保证保留下来的版本仍可逐条重放。每条记录带内容 sha 摘要，历史被手改或损坏时重放会报错
  而不是静默给出别的正文。

### Changed

- README 里的截图全部重作为动图（设置列表、卡片编辑、版本历史演示、会话页「人设」标签），
  都取自 0.1.6 的实机操作：版本历史那张演示「打开 → 选较早版本 → 恢复」的完整回路。
  同时去掉了与动图重复的静态 `versions.png`。
- 兼容性不变：仍按 0.1.5 的适配结论跑在 DSH `0.2.1-rc.2` 上（`dshReleases` 里的
  `0.1.5-rc.1` / `0.1.5-rc.2` / `0.2.0-rc.2` / `0.2.1-rc.2` 标记不需要改动）。

### Notes

- 历史只记正文，不记名称、启用状态与适用范围；关掉开关后不再写新记录，已有历史仍可查看与恢复。
- 版本历史是独立于守卫的开关：守卫管的是「工具不许改存储」，历史管的是「改了就留痕」，两者互不依赖。

## [0.1.5] - 2026-10-20

### Changed

- **适配最新版 DSH `0.2.1-rc.2`。** 在 0.2.1-rc.2 上实测通过：设置页的人设列表、新建、保存
  （`listPersonas` / `savePersona`，正文按 `MAX_TEXT_BYTES` 的 64 KiB 上限测了 6 KB 长文）与
  system prompt 注入都正常；0.1.4 为 0.2.0-rc.2 补的 strict codec 契约（`create`/`decode`/`encode`）
  与图标命名在 0.2.1-rc.2 上没有变化，所以那次适配继续有效。
  `dsh.compatibility.dshReleases` 补上 `0.2.1-rc.2`（与 `0.1.5-rc.1`、`0.1.5-rc.2`、`0.2.0-rc.2`
  并列 `compatible`）；宿主代码并不读取这个字段，它服务于插件市场/商店的版本提示，补上是为了让
  "跑过哪些版本"与事实一致。
- 宿主对**每一个**工具调用都会跑 `tools.guard`（0.2.1-rc.2 上实测 `compress` 也被拦），于是下面那条
  守卫的误判从"偶尔"变成"常态"。

### Fixed

- **只读工具不再因为参数里出现人设存储路径而被拒绝。** `personaStoreGuardReason` 原来只看参数里有没有那个
  路径，于是 `read`、`grep`、`compress` 这类根本不能改写存储的调用也会被拒绝，并回一条"工具不能写入或删除它"，
  等于让会话连解释这个文件都做不到（同一个会话里 `compress` 就被挡过一次）。现在按工具名判断写意图：
  `write`/`edit`/`multiedit`/`apply_patch` 等"参数即目标路径"的工具，路径指向存储才拒绝；`bash`/`pwsh`
  等命令类工具仍要求同一个字符串里同时出现写特征（`rm`、`>`、`cp` 等）；其余只读工具一律放行。
  存储保护本身没有放松：直接写存储、命令里删/覆盖存储，仍然照旧拒绝。

## [0.1.4] - 2026-10-08

### Fixed

- **适配 DSH 0.2.0-rc.2。** 三处不兼容导致插件在新版本上完全无法使用：

  1. **Typert strict codec 缺少 `create()` 工厂方法。** 0.2.0 的 typert-loader 和 gateway 要求每个 strict codec
     提供 `create()` 并返回一个带 `parse()` 方法的对象，gateway 在处理 RPC 调用时执行 `codec.create().parse(value)`
     进行边界校验。`generate-remote.mjs` 生成的 `remote.ts` 和 `typert.ts` 中的 codec 都只有
     `{ mode, typeSymbol, schema }` 三个字段，缺少 `create`/`decode`/`encode`，导致宿主端 typert-loader 注册失败
     （启动时报 warning "1 entry did not activate"），客户端 `ctx.remote.$mount()` 抛出异常使 `capturedApi` 始终
     为 `undefined`，页面渲染回退为"插件还没加载好"错误提示，同时所有带参数的 RPC 调用（如 `sessionPrompt`、
     `savePersona`）在 gateway 层因 `codec.create()` 返回 `undefined` 而报
     "wire field \"input\" failed boundary validation"。

  2. **图标组件名称变更。** `dsh-client-ui-primitives` 0.2.0-rc.2 将图标命名规则从尺寸后缀（如 `IconPlusOutline16`）
     改为粗细后缀（如 `IconPlusOutlineRegular`），旧名称不再导出。从 primitives 解构出的 18 个图标全部为 `undefined`，
     `verifyElements()` 检查失败，页面无法渲染。

### Changed

- `dsh.compatibility.dshReleases` 新增 `0.2.0-rc.2: compatible`。

## [0.1.3] - 2026-09-23

### Fixed

- **The plugin could not load from a registry install.** `src/index.ts` imports `@deepseek-ai/schemastery` for its
  config schema, but `package.json` never declared it — a phantom dependency that npm's flat layout hid (it was
  hoisted from a transitive dependency) and pnpm's isolated layout does not: a package only resolves what its own
  manifest declares. The installed copy therefore threw `ERR_MODULE_NOT_FOUND`, which failed the whole plugin tree
  and stopped `dsh web` from starting. It was declared as a **peer dependency**, which is both what the ecosystem
  does for official `@deepseek-ai/*` packages (`dsh-context` and `dshmarket` declare the same one) and what makes
  the installer link it next to the installed copy next to the peers it already links.

  This affects every published version so far: 0.1.0, 0.1.1 and 0.1.2 all fail to load from a registry install and
  only worked while the profile resolved the plugin from a source checkout over `link:`.

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

[0.1.3]: https://github.com/Awoodwhale/dsh-agent-persona/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Awoodwhale/dsh-agent-persona/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Awoodwhale/dsh-agent-persona/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Awoodwhale/dsh-agent-persona/releases/tag/v0.1.0
