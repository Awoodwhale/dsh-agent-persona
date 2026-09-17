# dsh-workspace-persona

Per-workspace (and per-session) system prompts for [DSH](https://www.deepseek.com/harness/).
The persona text lives outside the workspace, so a conversation inside that workspace cannot rewrite it.

[![npm](https://img.shields.io/npm/v/dsh-workspace-persona)](https://www.npmjs.com/package/dsh-workspace-persona)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![ci](https://github.com/awoodwhale/dsh-workspace-persona/actions/workflows/ci.yml/badge.svg)](https://github.com/awoodwhale/dsh-workspace-persona/actions/workflows/ci.yml)

[中文](./README.md)

## Why this exists

I built it while wiring an InfoFlow bot into DSH and wanted that bot to have a fixed persona.

The obvious place is the workspace `AGENTS.md`. Two things went wrong with that: it is an ordinary file inside
the workspace, so any session that can read the directory can also edit it; and it only applies per directory,
so it cannot tell "this session came from InfoFlow" apart from "this session came from the web UI".

So the persona moved somewhere else: outside the workspace, delivered by working directory and session id, and
written into the **system prompt**. DSH helps here — workspace instructions are turned into a **user-role**
message by `dsh-agent-instructions`, and that message's own intro says *"They do not override system,
developer, or direct user instructions."* What this plugin writes is a system-prompt section (order 1, right
after the identity line). That ordering is the framework's, not something the plugin claims.

Note: the UI is in Chinese. The code and these docs are English.

## Install

```bash
dsh plugin --profile web add dsh-workspace-persona
```

Then **restart `dsh web`** once: profile bundles are read at startup, and that is where the plugin row comes from.

After the restart:

- Sidebar → **Settings → 工作区人设**;
- `cat ~/.dsh/dsh-workspace-persona/state.json` — the plugin's load heartbeat, which names the file that was
  actually loaded.

There is also `bash scripts/install.sh` (or `scripts/install.ps1` on Windows) if you prefer a script.

## Using it

The settings page:

![persona list](./docs/images/settings-list.png)

Hit **新建人设**, fill in the scope, flip **启用** on, save.

- **A new persona starts disabled**, so creating one never changes what any session currently gets.
- **Scope** is one or more rows of `[workspace path | session id]` + `[exact | prefix | regex | contains]` +
  a value. Rows inside one persona are OR-ed.
- **Order is priority.** The `↑ ↓` buttons reorder; the first match from the top wins.
- **A persona with no rows is a catch-all** — keep it at the bottom. And if you want somewhere to get *no*
  persona at all, give it a matching row and leave the text empty: an empty winner means "inject nothing".
- **Match test** at the bottom of the page runs the real resolver on a cwd / session id you type in, and
  reports who wins, which row matched, whether an empty text silenced it, and how many disabled personas were
  skipped. No guessing.
- **AI tuning** only ever produces a proposal. It lands in the editor when you hit 采用/追加, and is written to
  disk only when you save.

An expanded card:

![expanded editor](./docs/images/settings-editor.png)

## How matching works

On every prompt assembly the host walks the list once:

1. disabled persona → skip;
2. in list order, the first persona with **any** matching row wins;
3. a persona with no rows is a catch-all and claims everything not claimed above;
4. if the winner's text is empty, nothing is injected;
5. if nothing matches, the section renders empty, gets dropped, and the session keeps its stock DSH prompt.

Of the four match modes, only `exact` normalises paths (`/a/project/` equals `/a/project`). `prefix`, `contains`
and `regex` compare the raw string you typed — otherwise `contains "my-project"` would be useless. An empty
value, a broken regex, or a session that lacks the compared field all simply count as "no match"; none of them
throws.

## Where the files are

Everything lives in one directory:

```
~/.dsh/dsh-workspace-persona/
├── personas.json   # the data, mode 600, written atomically
└── state.json      # load heartbeat, rewritten on every load
```

Persona text may use `{{model}}` and `{{cwd}}`; they are substituted at render time. Any other `{{...}}` is
stripped — an unregistered variable makes the whole assembly throw, so this is guarded.

The data file is re-read on every assembly when its mtime changes, so edits apply to the next request. No restart.

> In earlier development versions these two files sat loose under `~/.dsh/` (`workspace-personas.json`,
> `workspace-persona.state.json`). The first load after upgrading moves the data into the directory above and
> keeps the old file next to it as `personas.legacy.bak.json`.

## Pinning the tuning model

By default the tuning button asks the host's `agentDefaultModel`. To pin a model for one deployment, override
the row in the profile's user patch layer (**do not** insert it a second time):

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: workspace-persona
  config:
    tuneProvider: your-provider
    tuneModel: your-model-id
```

The same row also accepts `storePath` if you want the data somewhere else.

## Things you should know

- **A persona is a behavioural constraint, not a security boundary.** It steers the model; it does not stop the
  model from running tools.
- `personas.json` is an **ordinary file** — any session with file tools can write it. This plugin registers no
  `tools.guard`. If you genuinely need "sessions inside the workspace cannot change the persona", handle it at
  the machine level (`chmod 400` with a different owner, or run DSH in a restricted sandbox).
- AI tuning needs a resolvable model and fails loudly if there is none.
- Matching is a linear scan. Dozens of personas are fine; hundreds would need a redesign.
- When several personas match, only the first wins — nothing is concatenated. Concatenation was considered and
  dropped because it is hard to predict and hard to debug; it is recorded in
  [docs/plans](./docs/plans/2026-09-17-v2-multi-persona.md).
- Install it once per profile. Two rows sharing the same id make the composition unbootable.

## Development

```
lib/index.js      host half: store, matching, section, remote service (this is the source, no build step)
lib/client.js     client half: the settings page, a hand-written __ModuleLoader__ module
test/             48 assertions, Node built-ins only
docs/             architecture, development notes, design decisions
scripts/          installers
```

```bash
npm test        # run the assertions
npm run check   # syntax check both halves
dsh --profile web --dump-config | grep -c 'id: workspace-persona'   # composition self-check, prints 1
```

A few things to know before you edit code:

- `lib/client.js` **content** changes recompose the client artifact — just refresh the page. Do not rename the
  file: a new name is not recomposed.
- `lib/index.js` **content** changes are **not** reloaded (ESM caches modules by URL). To iterate without a
  restart, point the patch row at a new file name; otherwise restart `dsh web`.
- Anything in `dsh.bundle.patch` or the profile's `bundles` needs a restart.

More detail: [docs/development.md](./docs/development.md) and [docs/architecture.md](./docs/architecture.md).

## License

Apache-2.0 — see [LICENSE](./LICENSE).
