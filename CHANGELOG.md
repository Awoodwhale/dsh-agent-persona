# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-09-17

### Changed

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
- **Session history peek**: pick a session, hit the button next to the picker, and read its last messages
  (`sessionHistory`) before pointing a persona at it.
- The scope pickers can go back from 「自己输入…」 to the list, and the match mode only appears in that
  manual mode.


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
  `__ModuleLoader__` client half (no build step), with 52 offline assertions in
  `npm test`.

[Unreleased]: https://github.com/awoodwhale/dsh-agent-persona/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/awoodwhale/dsh-agent-persona/releases/tag/v0.1.0
