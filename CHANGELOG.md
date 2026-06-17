# Changelog

All notable changes follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.1.0] - 2026-06-17

### Added
- **Phase Gates** — Multi-phase missions can pause between phases for user review. Architect marks tasks with `phase-gate: yes` to trigger gates.
- **Mission HOLD state** — New state `hold` that pauses execution between phases. Strategist asks user for continuation.
- **Phase Gate Protocol** — On `yes` → resume next phase. On `no` → stay in hold. On change requests → Specialist replans remaining phases.
- **Phase-aware todo parser** — Extracts `phase` name from `## Phase N: Name` headers and `phaseGate` flag from todo metadata.
- **Gate message persistence** — Phase gate messages written to `.opencode/plans/{slug}/gate-message.txt` for Strategist to present to user after compaction.
- **Strategist prompt updated** — Steps 9-12 detail phase gate handling. Rules instruct to never skip gates.
- **Architect prompt updated** — Phase Gate Rules section instructs when and how to place `phase-gate: yes`.
- **Event handler** — `yes` and `no` are no longer ignored as casual chat, so they can trigger gate responses.

### Changed
- **MissionController.executeTodos** — Tracks `currentPhase`. Detects phase transitions and checks for completed gates before continuing.
- **MissionController.resume** — Now includes `hold` state in resumable states.
- **Todo parser regex** — Updated to capture `phase-gate: yes/no` in addition to `critical-path: yes/no`.
- **Todo parser phase extraction** — Parses `## Phase N: Name` headers and assigns phase names to todos.

## [2.0.1] - 2026-06-17

### Added
- **Clarification Gate** — Strategist now asks 1-2 concise questions when user requests are vague or missing details, BEFORE commissioning Architect. Prevents wasted planning cycles.
- Strategist prompt updated: step 2 is now "If VAGUE → ask user, THEN WAIT. Do NOT proceed until clear."

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
