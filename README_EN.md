<div align="center">

# dsh-workspace-persona

**A system-prompt persona for every workspace and every session**

One persona, one *scope*: delivered precisely by working directory or session id.<br />
Many independent personas, an orderable priority, catch-alls and exceptions — all managed from a Web settings page.<br />
Personas live **outside any workspace**, so a conversation inside a workspace cannot be the source of its own identity.

<a href="https://www.npmjs.com/package/dsh-workspace-persona"><img alt="npm version" src="https://img.shields.io/npm/v/dsh-workspace-persona" /></a>
<a href="https://www.npmjs.com/package/dsh-workspace-persona"><img alt="npm downloads" src="https://img.shields.io/npm/dm/dsh-workspace-persona" /></a>
<a href="https://github.com/awoodwhale/dsh-workspace-persona/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/awoodwhale/dsh-workspace-persona/actions/workflows/ci.yml/badge.svg" /></a>
<a href="https://github.com/awoodwhale/dsh-workspace-persona/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/awoodwhale/dsh-workspace-persona" /></a>
<a href="https://opensource.org/licenses/Apache-2.0"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/License-Apache--2.0-blue.svg" /></a>
<a href="https://www.npmjs.com/package/@deepseek-ai/dsh?activeTab=versions"><img alt="Supported DSH: 0.1.5-rc.1+ (verified on 0.1.5-rc.2)" src="https://img.shields.io/badge/DSH-0.1.5--rc.1%2B_%28verified_rc.2%29-4d6bfe" /></a>
<a href="https://dshfind.com/en/plugins/awoodwhale/dsh-workspace-persona"><img alt="dshfind" src="https://dshfind.com/api/badge/awoodwhale/dsh-workspace-persona?lang=en" /></a><br /><br />
<img alt="Many personas" src="https://img.shields.io/badge/-Many%20personas-4d6bfe" /> <img alt="Scoped matching" src="https://img.shields.io/badge/-Scoped%20matching-4d6bfe" /> <img alt="Order is priority" src="https://img.shields.io/badge/-Order%20is%20priority-4d6bfe" /> <img alt="Match test" src="https://img.shields.io/badge/-Match%20test-4d6bfe" /> <img alt="Markdown editing" src="https://img.shields.io/badge/-Markdown%20editing-4d6bfe" /> <img alt="AI tuning" src="https://img.shields.io/badge/-AI%20tuning-4d6bfe" /> <img alt="Zero runtime deps" src="https://img.shields.io/badge/-Zero%20runtime%20deps-4d6bfe" />

<div>
  🌏 <a href="./README.md">中文</a> · <a href="./README_EN.md"><b>English</b></a>
</div>

<div>
  <img alt="Workspace personas: the accordion list and priority order" src="./docs/images/settings-list.png" width="620" />
</div>

</div>

> A [DeepSeek Harness](https://www.deepseek.com/harness/) (DSH) plugin. The UI is localized in Chinese;
> the code, docs and this README are in English (the Chinese README is the primary one: [README.md](./README.md)).

## 📑 Table of contents

- [✨ Features](#-features)
- [🚀 Install](#-install)
- [🖼️ Tour](#️-tour)
- [🧭 Matching rules](#-matching-rules)
- [🗄️ Storage & injection](#️-storage--injection)
- [⚙️ Row config](#️-row-config)
- [🔌 Service API](#-service-api)
- [🛠️ Development](#️-development)
- [🔐 Security](#-security) · [⚠️ Known limitations](#️-known-limitations) · [🖥️ Platforms](#️-platforms)
- [🆕 Changelog](#-changelog) · [🤝 Contributing](#-contributing) · [📄 License](#-license)

## ✨ Features

- **👥 Many personas.** Not "one persona per workspace": keep as many as you like, each enabled/disabled,
  renameable, duplicable and reorderable on its own.
- **🎯 Scoped delivery.** Every persona carries its own rules — `workspace` (the session's cwd) or
  `sessionId`, matched **exactly / by prefix / by regex / by substring**; rules inside one persona are OR-ed.
- **↕️ Order is priority.** The first match from the top wins; the `↑ ↓` buttons on a card reorder it.
- **🪄 Catch-alls and exceptions.** A persona with no rules is a catch-all; a persona whose text is empty
  means "no persona here" once it matches — which is how you carve an exception out of a catch-all.
- **📝 Everything in the settings page.** Accordion list → inline editor → scope-rule editor → Markdown
  editing with preview → AI tuning → save (`⌘/Ctrl+S`).
- **🔍 Match test.** Give a `cwd` and/or session id and the **host** runs the real resolver: which persona
  wins, which rule matched, whether it is silenced by an empty text, and how many disabled personas were
  skipped. The page can never drift from what actually gets injected.
- **🤖 AI tuning.** Polish / expand / compress / draft; the model only produces a **proposal**
  (adopt / append / discard) and never saves by itself. The model comes from the UI choice, then the row
  config, then the host's `agentDefaultModel`.
- **🧱 System-prompt level.** Injected as the system-prompt section `workspace-persona` at order 1 —
  **above workspace `AGENTS.md`**.
- **🗂️ Outside any workspace.** Stored in `$DSH_HOME/workspace-personas.json`; edits apply to the **next
  request** with no restart.
- **📦 Zero runtime dependencies, no build step.** The host half is a plain ESM plugin, the client half is a
  hand-written `__ModuleLoader__` module — `lib/` *is* the source; the test suite uses Node built-ins only.

## 🚀 Install

```bash
# install into the web profile (the CLI wires the package into the profile's bundles layer)
dsh plugin --profile web add dsh-workspace-persona

# restart dsh web — profile bundles are read at startup
```

Or use the scripts shipped in this repo:

```bash
bash scripts/install.sh              # default profile: web
pwsh -File scripts/install.ps1       # Windows
```

**After the restart:**

1. Sidebar → **Settings → the left nav now has “工作区人设” (Workspace personas)**;
2. `cat "$DSH_HOME/workspace-persona.state.json"` — the host half's load heartbeat (it names the file that
   was actually loaded).

## 🖼️ Tour

<table>
<tr>
<td width="50%">

**The list**: index / state dot / name / state badge / scope chips / character count, with `↑ ↓` for
priority, plus duplicate, edit and a two-step delete. **New personas start disabled**, so creating one never
changes what any session currently gets.

</td>
<td width="50%">

**The editor**: name + enable switch, the scope-rule editor, Markdown body with edit/preview, collapsible AI
tuning, and a footer with the character count, `⌘S`, duplicate / delete / collapse / save.

</td>
</tr>
<tr>
<td><img alt="Persona list" src="./docs/images/settings-list.png" /></td>
<td><img alt="Expanded editor" src="./docs/images/settings-editor.png" /></td>
</tr>
</table>

## 🧭 Matching rules

A rule is `{ kind, match, value }`:

- `kind` — `workspace` (compares the session's `cwd`) or `sessionId` (compares the session id)
- `match` — `exact` / `prefix` / `regex` / `contains`
- Only `exact` normalises paths (so `…/project/` equals `…/project`); `prefix`, `contains` and `regex`
  compare **the raw string you typed**, which is what makes `contains "my-project"` usable.

**Resolution order** (the host runs this on every prompt assembly):

1. a **disabled** persona is skipped entirely;
2. personas are tried in **list order**: the first one whose **any** rule matches wins;
3. a persona with **no rules** is a catch-all and matches anything not claimed above (keep it at the bottom);
4. if the winner's text is **empty**, nothing is injected (an explicit exception to a catch-all);
5. if nothing matches, the section renders empty and is dropped → the session keeps the **stock DSH system
   prompt**.

## 🗄️ Storage & injection

| Item | Value |
|---|---|
| Persona data | `$DSH_HOME/workspace-personas.json` (default `~/.dsh/workspace-personas.json`, atomic write, mode 600) |
| Load heartbeat | `$DSH_HOME/workspace-persona.state.json` |
| Injection point | system-prompt section `workspace-persona`, order = `DEPLOYMENT_PERSONA_PREFIX + 1` = **1** |
| Template variables | `{{model}}`, `{{cwd}}` (any other `{{…}}` is stripped so assembly can never fail) |
| When it applies | the store is re-read on every assembly when its `mtimeNs:size` stamp changed → the **next request** |

**Why this outranks `AGENTS.md`**: workspace instructions are turned into a **user-role** message by
`dsh-agent-instructions`, whose own intro says *"They do not override system, developer, or direct user
instructions."* This plugin writes a **system-prompt section**. That is a structural guarantee.

## ⚙️ Row config

Pin the model used by AI tuning for a deployment (override the row in the profile's user patch layer —
**do not** insert it again):

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: workspace-persona
  config:
    tuneProvider: your-provider
    tuneModel: your-model-id
```

## 🔌 Service API

The host half exposes the `workspacePersona` remote namespace (typert source-mode — **no codegen**); the
settings page uses exactly this API:

| Method | Purpose |
|---|---|
| `listPersonas` | the whole view (store path, section info, vocabularies, counts, personas) |
| `savePersona` / `deletePersona` | create (no `id`) / update / delete |
| `movePersona` / `duplicatePersona` | reorder priority / duplicate (the copy starts disabled) |
| `previewMatch` | resolve a `cwd` / `sessionId` to a winner plus the matching rules |
| `tunePersona` / `listModels` | AI tuning and the selectable models |

Contracts, the result envelope and the gotchas: [docs/architecture.md](./docs/architecture.md).

## 🛠️ Development

```bash
npm test        # 40 assertions: matching engine, v1→v2 migration, injection, heartbeat
npm run check   # syntax check for both halves
dsh --profile web --dump-config | grep -c 'id: workspace-persona'   # composition self-check, expect 1
```

**How code changes take effect** (`patchReload: live` only watches patch files):

- `lib/client.js` **content** → the client artifact is recomposed, just refresh the page (do not rename the
  file: a new name is not recomposed);
- `lib/index.js` (host) **content** → **not** re-imported (ESM caches by URL); to iterate without a restart,
  point the patch row at a new file name, or restart `dsh web`;
- `dsh.bundle.patch` in `package.json`, or `profile.bundles` → restart.

Details: [docs/development.md](./docs/development.md). Decisions: [docs/plans/](./docs/plans/).

## 🔐 Security

- A persona is a **behavioural constraint**, not a security boundary: it steers the model, it does not stop
  the model from using tools.
- `$DSH_HOME/workspace-personas.json` is an **ordinary file**: any session with file tools can write it
  (this plugin registers no `tools.guard`). If you need "conversations inside the workspace cannot change
  the persona", harden it at the machine level (e.g. `chmod 400` owned by another user, or run DSH inside a
  restricted sandbox).
- The repo and the npm tarball contain **no credentials**; persona text is yours to maintain.

## ⚠️ Known limitations

- AI tuning needs a resolvable model (UI choice → row config → host `agentDefaultModel`); otherwise it fails
  with a clear message.
- Matching is a **linear scan** (dozens of rules); it is not designed for very large persona counts.
- Multiple matches are **not concatenated** — only the first wins (the concatenation alternative is recorded
  as rejected in `docs/plans/`).
- One `workspace-persona` section per process: do not install the plugin twice into the same profile.

## 🖥️ Platforms

The host half uses Node built-ins only; the client half is a browser module. macOS / Linux / Windows all
work; `scripts/` ships both a Bash and a PowerShell installer. Nothing here depends on terminals or PTYs.

## 🆕 Changelog

See [CHANGELOG.md](./CHANGELOG.md). `0.1.0` is the first release: many personas, scoped matching, the match
test, AI tuning, and automatic v1 → v2 migration.

## 🤝 Contributing

- Issues: please include your DSH version (`dsh --version`), `$DSH_HOME/workspace-persona.state.json`, and the
  `[workspace-persona]` lines from the host log.
- Before a PR: run `npm run check && npm test`, and extend `test/personas.test.mjs` for new behaviour.
- Commit messages follow conventional commits (`feat:` / `fix:` / `docs:` …).

## 📄 License

[Apache-2.0](./LICENSE) © 2026 awoodwhale
