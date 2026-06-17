# Changelog

All notable changes follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.0.0] - 2026-06-17

### Breaking Changes
- **Removed ALL slash commands** — `/task`, `/auto`, `/plan`, `/status`, `/agents`, `/delegate`, `/retry`, `/abort`, `/version` deleted. Plugin is now fully automatic.
- **Primary agent reduced to ONE** — Only `strategist` is primary. Architect, Engineer, Auditor, Specialist are all subagents.
- **API changes**: `ConfigHandlerDeps` no longer accepts `commands` key. `createConfigHandler` no longer registers any commands.

### Added
- **Natural language mission detection** — Strategist reads user messages and auto-starts missions via heuristic keyword matching
- **Anti-stuck system** — 6 detectors: timeout, retry loop, circular deps, all-failed, stalled, resource-exhausted
- **Diagnostic Specialist** — Activated automatically when stuck. Categories: TOO_BIG, UNCLEAR_SPEC, ENV_ISSUE, MODEL_LIMIT, BUGGY_CODE, EXTERNAL_BLOCK
- **Loop counter** — Tracks same-error repetitions per task; stops brute-force at 3 failures
- **Stall watcher** — Monitors `lastProgressAt`; auto-escalates to Specialist after 10 minutes no progress
- **Dynamic worker throttling** — Drops from 3 to 1 worker when Ollama latency spikes detected
- **Event handler intercepts `message.created`** — No command framework needed
- **DOX Framework Integration** — Auto-init, auto-closeout, timestamped run records in `.opencode/DOX/`
- **Full agent field forwarding** — `model`, `fallbackModel`, `smallModel`, `temperature`, `topP`, `topK`, `maxTokens`, `description`, `prompt`, `systemPrompt`, `mode`, `color`, `tools`, `permission`, `skills`, `thinking`, `allowLoop`, `loopCount` all propagated from opencode.json
- **Built-in agent collision guard** — Auto-renames to `orchestrator-{name}` if user collides with core subagents
- **Compaction resilience** — All agent prompts instruct re-read from disk after compaction events

### Changed
- **Config handler**: Removed all command registration logic. Only agents + orchestrator settings remain.
- **Strategist prompt**: Rewritten for command-free automatic orchestration
- **Architect prompt**: Instructs to write per-project `.opencode/plans/{slug}/plan.md` and `.opencode/todo/{slug}.md`
- **Engineer prompt**: Token-efficient. Self-documenting code preferred. "If blocked after 2 attempts → report BLOCKED"
- **Auditor prompt**: Only activates for `critical-path: yes` tasks. Non-critical tasks skip verification.
- **Hard parallelism cap**: `maxParallelWorkers` clamped to `Math.min(userValue, 3)`. Cannot exceed 3 regardless of config.

### Fixed
- ESM output verified: zero `require()` calls in `dist/`

## [1.1.0] - 2026-06-17

### Added
- **MissionController** — async state machine for fully automatic missions (`/auto` command)
- **Per-project directories** — plans in `.opencode/plans/{slug}/`, todos in `.opencode/todo/{slug}.md`
- **Session polling** and **file watching**
- **14 vitest tests**

## [1.0.0] - 2026-06-17

### Added
- Initial release with `/task`, `/plan`, `/agents`, `/status`, `/delegate`, `/retry`, `/abort` commands
- 5 agent roles: Strategist, Architect, Engineer, Auditor, Specialist
- Ollama provider hard lock
- Full config inheritance from opencode.json
