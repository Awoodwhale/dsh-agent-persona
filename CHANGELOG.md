# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-09-17

### Changed

- The settings section paints its title and description (and a skeleton card list) before any host call
  resolves, instead of showing a bare 「加载中…」; a mount race with the remote namespace retries briefly rather
  than flashing an error.

- Renamed the package from `dsh-workspace-persona` to **`dsh-agent-persona`** (settings page: 「Agent人设」).
  Everything it writes now lives in `$DSH_HOME/dsh-agent-persona/`.
- The collapsed card keeps only what reads at a glance — chevron, state dot, name, state, scope chips — and
  reordering / duplicating / deleting moved into the card's `⋯` menu.

### Added

- **Exactly one persona per workspace or session.** A save that claims a place takes it away from the persona
  that held it (exact values only, reported back to the page), and the pickers label places that are already
  taken.
- **Injection modes** `append` (default) and `replace`, implemented by listening to the
  `system-prompt/assemble` waterfall and dropping the deployment's own `deployment:persona-prefix` line for
  `replace`. A preset or subagent persona that shadowed the section is never overwritten.
- **Session history**: pick a session, hit the button next to the picker, and read that conversation. Reads are
  windowed (`sessionHistory({id, offset, events})`) so the log is never read up front: the page shows what it
  got, reports 已显示 N 条, and only reads the next window when 继续加载 is pressed. Messages are capped at 4000
  characters. Picker rows carry a short session id and the session's age on the right.
- The persona counts are two tags — 「N 条人设」 and a success-toned 「N 条在用」 — instead of a sentence in the
  meta line, and the store path moved to the right of them.
- **Unsaved changes are visible**: the open card carries a 未保存 tag while its draft differs from what is
  stored, and switching cards or collapsing reports 「改动没有保存」 in the status line instead of dropping it
  silently.
- The status line is sticky at the bottom of the page so save/error feedback stays visible while the list
  scrolls; icon buttons grew from 24px to 28px hit targets.
- The section header now matches the shipped settings pages exactly: an `<h2>` title at 18px/600, a 13px
  `p` intro in the muted label colour, no leading icon (the count moved into the meta line). Measured side by
  side against the official 「Agent 预设」 page in the same DOM: identical font size, weight and colour.
- The page is titled with the Agent-preset glyph (the same one the settings shell uses for 「Agent 预设」); the
  settings **nav** icon itself is the shell's and cannot be set by a plugin — `settings.section` accepts only
  `id` / `order` / `label`, and the shell falls back to one generic glyph for every id it does not ship.
- Creating a persona moved out of the page's top-right corner into a dashed **新建人设** row at the end of the
  list (the conventional place for an "add" affordance), keyboard reachable via Enter/Space; the header is now
  just the title and the count.
- A collapsed card shows its scope on a **second line**, workspaces and sessions apart, with human names
  (workspace titles, session titles) instead of raw paths; the picker marks a claimed target as 当前人设 when it
  belongs to the persona being edited, instead of appearing to be someone else's.
- The conversation dialog is a two-sided chat (your input right, the agent left, both in bubbles) and hides
  plugin-injected user-side content — `AGENTS.md` (13k chars in a real session), runtime snapshots, the skill
  catalog, goal rounds — reporting only 「已隐藏 N 条插件注入内容」.
- The scope pickers can go back from 「自己输入…」 to the list, and the match mode only appears in that
  manual mode.
- Session entries in the picker are labelled with their DSH title, and with the session's first prompt (or
  its latest prompt) when no title exists yet — all three come out of a **single read** of DSH's projection
  cache. The dropdown never touches a session log: those are 2.6x-5.8x larger and zstd-compressed
  append-only files that cannot be seeked.


### Added

- **Many personas, each scoped independently.** A persona is a first-class record
  (`id` / `name` / `enabled` / `text` / `targets[]`), and every target is
  `{ kind: 'workspace' | 'sessionId', match: 'exact' | 'prefix' | 'regex' | 'contains', value }`.
- **Dropdown scope pickers.** The settings page fills its pickers from the host's
  workspaces and from DSH's own sessions (newest first, with title, working
  directory and a relative timestamp), so nobody has to type a path or a session
  id. The two kinds are mutually exclusive per row — switching a row's type clears
  its value — and "自己输入…" keeps the advanced match modes reachable.
- **Resolution rules**: list order is priority (first match wins), rows inside one
  persona are OR-ed, a persona with no rows is the default persona, a disabled
  persona is skipped, and a matching persona with an empty text means "no persona
  here".
- **System-prompt injection** as section `agent-persona` at order 1
  (`DEPLOYMENT_PERSONA_PREFIX + 1`), i.e. above the workspace `AGENTS.md`.
- **One directory for the data**: `$DSH_HOME/dsh-agent-persona/` holds
  `personas.json` and a `state.json` heartbeat. The data is re-read on every prompt
  assembly (mtimeNs/size stamp), so an edit applies to the next message.
- **AI rework** (polish / expand / compress / draft) that uses the model DSH itself
  is set to use, overridable per deployment with `tuneProvider` / `tuneModel`. It
  only ever produces a proposal.
- **Zero runtime dependencies**: a plain ESM host half plus a hand-written
  `__ModuleLoader__` client half (no build step), with 89 offline assertions in
  `npm test`.

[Unreleased]: https://github.com/awoodwhale/dsh-agent-persona/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/awoodwhale/dsh-agent-persona/releases/tag/v0.1.0
