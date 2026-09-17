# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-09-17

### Added

- **Many personas, each with its own scope.** A persona is a first-class record
  (`id` / `name` / `enabled` / `text` / `targets[]`); every target is
  `{ kind: 'workspace' | 'sessionId', match: 'exact' | 'prefix' | 'regex' | 'contains', value }`.
- **Resolution rules**: list order is priority (first match wins), targets inside
  one persona are OR-ed, a target-less persona is a catch-all, a disabled persona
  is skipped, and a matching persona with empty text means "no persona here"
  (an explicit exception to a catch-all).
- **Web settings page** (Settings → 工作区人设): accordion of personas with an
  inline editor, scope-rule editor, Markdown editing with preview, `⌘/Ctrl+S`,
  a host-computed **match test**, and **AI tuning** (polish / expand / compress /
  draft) that only ever produces a proposal.
- **System-prompt injection** as section `workspace-persona` at order 1
  (`DEPLOYMENT_PERSONA_PREFIX + 1`), i.e. above workspace `AGENTS.md`.
- **Store outside any workspace**: `$DSH_HOME/workspace-personas.json`, re-read on
  every prompt assembly (mtimeNs/size stamp), so edits apply to the next request.
- **Automatic v1 → v2 migration** of the earlier "one persona per workspace"
  document shape.
- **Zero runtime dependencies**: plain ESM host half + a hand-written
  `__ModuleLoader__` client half (no build step); 40 offline assertions in `npm test`.

[Unreleased]: https://github.com/awoodwhale/dsh-workspace-persona/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/awoodwhale/dsh-workspace-persona/releases/tag/v0.1.0
