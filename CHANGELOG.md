# Changelog

All notable changes follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.1.16] - 2026-06-17

### Added
- **Mission resume across restarts** — `loadMissionsFromDisk()` reads `.opencode/missions/*/state.json` on startup, restoring missions in `executing`/`hold`/`retrying` state as `idle`. Survives OpenCode process restarts.
- **Memory leak prevention** — `startMemoryPurge()` removes completed missions from in-memory Map after 1 hour. Periodic purge runs every hour.
- **Graceful shutdown** — SIGTERM/SIGINT handlers: stops cleanup, waits for running tasks (30s timeout), saves active mission states, exits cleanly.
- **Circuit breaker** — Tracks consecutive failures per model. After 5 failures, permanently skips the broken model and goes straight to fallback. Clears failure count when fallback succeeds.
- **Running task tracking** — `executeTodos()` wraps `_executeTodosInner()` with `runningTasks` Map for graceful shutdown coordination.

## [2.1.15] - 2026-06-17

### Added
- **True parallel execution** — `executeTodos()` now dispatches tasks concurrently up to `maxParallelWorkers` (default 3). Tasks with met dependencies run in parallel; tasks blocked by dependencies or phase gates wait. Uses a task queue with `Promise.race` for completion tracking.
- **Task-level failure isolation** — One task failing no longer breaks the whole mission. Failed tasks are marked, retried with exponential backoff, and if max retries exceeded, the mission continues with remaining tasks. Final state is "completed" if any task succeeds, "failed" only if all tasks fail.
- **Mission memory / cross-task context** — Each mission accumulates a `memory` array of `TaskMemoryEntry` objects (taskId, agent, summary, filesChanged, issues, timestamp). The last 5 completed tasks are injected into each new task's prompt as "Mission Context (Previous Tasks)" to prevent duplicate work and re-introducing fixed issues.
- **Atomic file writes** — New `src/utils/atomic.ts` with `writeFileAtomicSync()` (write to temp, then rename). All todo updates and mission state saves use atomic writes to prevent race conditions during parallel execution.
- **In-progress task tracking** — Todo checkboxes now show `[~]` for tasks currently being executed (`in_progress` status). The regex handles `[ ]`, `[x]`, and `[~]` states.
- **Automatic mission cleanup** — Old mission directories in `.opencode/missions/` are auto-deleted after 7 days. Runs once at startup and daily thereafter.

### Changed
- `executeTodos()` completely rewritten from sequential `while` loop to parallel dispatch loop with worker pool pattern.
- `updateTodoStatus()` signature extended to accept `"in_progress"` status.
- `MissionCtx` now includes optional `memory` field.

## [2.1.14] - 2026-06-17

### Added
- **Pre-mission backup + revert** — `executeTodos()` auto-creates a backup before running any tasks. Three strategies:
  1. **Git stash** (if git repo + uncommitted changes) — named `opencode-backup:{slug}:{timestamp}`
  2. **Git commit** (if clean working tree) — empty commit as marker
  3. **Directory snapshot** (no git) — copies project files to `.opencode-backups/{slug}-{timestamp}/`
  Keeps last 10 directory backups, auto-cleans older ones.
- **revert_mission tool** — Restores project to pre-mission state using stored backup. Aborts the mission and cleans up backup file. Supports all three backup types (git stash pop, git soft reset, directory copy-back).
- **Mission backup tracking** — Each `MissionCtx` stores `backup` object with type, path, and commit hash. Exposed in status.

## [2.1.13] - 2026-06-17

### Added
- **Model fallback** — `createSession()` now tries the primary model first, catches failure, then tries `fallbackModel` (per-agent or global). If both fail, throws with a clear error showing primary + fallback model names. Prevents infinite hangs when a model is down.
- **Session tracking** — Each session now records: agent name, model, creation time, prompts sent, last prompt time, task ID, mission slug. Exposed via `sessionSummary()` method.
- **abort_mission tool** — New plugin tool to abort all active missions. Kills all active sessions.
- **mission_status tool** — Shows all active missions (slug, state, done/failed/pending/active counts, elapsed time) + all sessions (id, agent, model, prompt count, age, status).
- **skip_task tool** — Skip a specific task by ID in any mission. Marks it completed so execution continues past it.
- **resume_from tool** — Resume a mission from a specific task ID. Auto-completes all prior tasks and starts execution from that point.
- **check_watchdog tool** — Manually run the session watchdog. Detects sessions stuck for >15 minutes and marks them inactive.
- **Watchdog** — `checkWatchdog()` method monitors session activity. Any session idle for >15 minutes gets auto-killed and logged.

### Fixed
- **Audit visibility** — `runAudit()` now calls `emit()` with clear pass/fail/warning messages, so audit results are visible to the user instead of hidden in stderr. Toasts also fire on audit outcomes.
- **MissionController.abortMission(slug)** — Can abort a specific mission by slug without affecting others.

## [2.1.12] - 2026-06-17

### Fixed
- **Question tool not used by agents** — All agent prompts (Strategist, Engineer, Specialist, Architect) now explicitly instruct agents to call the `question` tool when they need user input. Previously, agents simply wrote plain text questions ("Proceed?") which appeared as terminal text instead of an interactive modal. The `question` tool was enabled but never invoked because prompts didn't tell agents to use it.
  - **Strategist ASK mode**: Now calls `question` tool with options instead of plain text
  - **Strategist RECOMMEND mode**: Now calls `question` tool with "Proceed?" + ["Proceed", "Cancel", "Modify scope"] options
  - **Strategist phase gates**: Now calls `question` tool with gate message + ["Continue", "Hold", "Modify"] options
  - **Engineer blocked**: Now calls `question` tool with error + ["Skip", "Retry", "Escalate"] options
  - **Specialist escalation**: Now calls `question` tool instead of plain text
  - **Architect phase gates**: Updated documentation to clarify question tool usage for phase progression

## [2.1.11] - 2026-06-17

### Fixed
- **Auto-pipeline per-agent model routing** — `MissionController.createSession()` and `promptSession()` now read per-agent `model` from `~/.config/opencode/opencode.json` and pass both `agent` and `model` to OpenCode SDK. Previously, the auto-pipeline (planning → execution → audit) silently fell back to the built-in "explorer" agent with the global default model, ignoring user-configured per-agent assignments.
  - `createSession()` resolves model → logs: `[opencode-orchestrator] createSession for {agent} with model {provider}/{modelID}`
  - `promptSession()` resolves model → logs: `[opencode-orchestrator] promptSession for {agent} with model {provider}/{modelID}`
- **Todo file path discovery** — `updateTodoStatus()` no longer hardcodes `.opencode/todos.md`. Added `findTodoFile()` utility that discovers the actual todo file by checking:
  1. Mission-specific `.opencode/todo/{slug}.md` (where architect writes the plan)
  2. Any `.md` in `.opencode/todo/` directory
  3. Falls back to generic `.opencode/todos.md`
  This fixes the symptom where tasks appeared completed in logs but the todo file never updated, so resuming a mission re-ran already-done tasks.
- **`buildTaskPrompt()` awareness** — Task prompt now includes the exact todo file path and instructions to update the checkbox after completion, so subagents can self-report progress.

## [2.1.10] - 2026-06-17

### Fixed
- **Strategist communication modes** — Added explicit 3-mode framework (ASK / RECOMMEND / ANSWER) to prevent the strategist from treating specific task requests as vague questions. Previously, messages like "check ticket API and compare with docs/V4-Ticket-API.md" were incorrectly classified as vague, causing unnecessary clarification loops.
  - **ASK**: Only when genuinely missing critical details (e.g., "fix the bug" with no context).
  - **RECOMMEND**: Default mode — describe plan, ask "Proceed?", wait for "yes" (e.g., "check API and compare with docs" → "I will read the doc, compare models, report mismatches. Proceed?").
  - **ANSWER**: When user asks for information, no mission created (e.g., "What is JWT?").
- **Event handler task detection** — Added `"check"`, `"compare"`, `"review"`, `"audit"`, `"sync"`, `"align"` to `looksLikeTaskRequest()` strong keywords so these verbs properly trigger mission detection instead of being rejected as casual chat.

## [2.1.9] - 2026-06-17

### Fixed
- **Per-agent model resolution** — `delegate-task` tool now reads each agent's `model` from `opencode.json` and passes it explicitly to `session.create()`. Previously, subagent sessions silently inherited the parent (strategist) model or fell back to the global default, ignoring per-agent model assignments.
  - Agent-level model (e.g., `agent.engineer.model`) is used when set.
  - Falls back to global `model` when agent-level is absent.
  - Logs resolved model to stderr: `[opencode-orchestrator] Delegating to {role} with model {provider}/{modelID}`.

### Added
- **Test coverage** — `test/delegate-task.test.ts` (6 tests) covering model resolution, fallback, multi-slash model IDs, and parent session passthrough.

## [2.1.8] - 2026-06-17

### Fixed
- README updated with full guide: quick start, configuration reference, architecture diagram, troubleshooting, testing, changelog.

## [2.1.7] - 2026-06-17

### Added
- **131 tests** via Vitest covering all core modules: config-handler, event-handler, provider-lock, todo-parser, dox, constants, paths.
- Test directory (`test/`) and `vitest.config.ts` now shipped in the npm tarball so consumers can run tests.

### Fixed
- package.json: updated description to "provider-agnostic"; removed "ollama-only" keywords.

## [2.1.6] - 2026-06-17

### Changed
- **Provider lock removed** — Plugin no longer hard-locks to Ollama. Uses whatever model/provider is configured in `opencode.json`. If no model is set, falls back to the current active model. The plugin is now provider-agnostic.
- **All "Ollama" references removed** — Agent prompts, DOX templates, config descriptions, and log prefixes updated from "Ollama Orchestrator" → "Multi-Agent Orchestrator" / "opencode-orchestrator".

### Internal
- `lockProviderToOllama()` is now a no-op that logs configured models but never throws. Kept for backward compat with external callers.
- `chat.params` hook no longer blocks non-Ollama models; instead logs the resolved model for diagnostics.
- `src/types.ts` JSDoc updated: model field no longer says "MUST start with ollama/".

## [2.1.5] - 2026-06-17

### Improved
- **Regex robustness** — `looksLikeTaskRequest()` rewritten with clear reject vs accept signals. Rejects: "explain", "what is", "how does", "cancel", "nevermind", "thanks", "ok", "don't" + weak-only signals without strong keywords. Accepts: strong task verbs ("build", "create", "implement", "fix", etc.) + compound signals ("please help me build X"). Also rejects meta prefixes (`@`, `/`, `opencode`, `hermes`).
- **Config validation** — `config-handler.ts` now validates `config.plugin` is an array before calling `.find()`, validates `pluginOpts` is an object (not null/array), and type-checks numeric fields (`maxRetries`, `maxParallelWorkers`, `maxSubagentDepth`) to prevent runtime crashes from malformed `opencode.json`.
- **Atomic state writes** — `saveMissionState()` now writes to `.tmp` then `renameSync()` to target, preventing half-written `state.json` on crashes.
- **Robust mission ID parsing** — `parseMissionTimestamp()` helper parses the last dash-separated segment of `missionId` instead of hardcoded `[1]`, handling custom ID formats safely.

## [2.1.4] - 2026-06-17

### Fixed (5 critical bugs from full audit)
- **Phase gate bypassed** — Inverted condition (`!prevPhaseGate`) let missions skip phase gates even when incomplete. Fixed gate detection to properly check both incomplete and completed gates.
- **Session never tracked** — `createSession()` didn't add sessions to `deps.sessions`, so `pollSession()` returned instantly (no wait). Now tracks all sessions properly.
- **Audit results ignored** — `runAudit()` had no return value; critical-path tasks always marked as completed regardless of audit failure. Now returns `boolean`, fails the task on audit failure, and triggers retry if retries remain.
- **Dead-locked missions never fail** — Pending tasks with all-failed dependencies kept the mission alive forever. Now counts dependency-blocked pending tasks as "failed" for mission state resolution.
- **resume() missing DOX closeout** — Resumed missions never archived DOX runs or cleaned up the `missions` map. Now mirrors `start()` finalization: DOX closeout + `missions.delete()`.
- **Event handler crash** — Unwrapped `controller.start()` could crash the plugin host. Now wrapped in `try/catch`.
- **abort() no persistence** — Aborted state lost on restart. Now calls `saveMissionState()`.
- **pollSession blind** — Only polled local session map, never used SDK `session.status()`. Now tries SDK API first, falls back to local map.

## [2.1.2] - 2026-06-17

### Fixed
- **Plugin init hang** — `lockProviderToOllama()` called `client.config.get()` during plugin initialization, which blocks indefinitely when the SDK client isn't fully ready. Now reads agent models directly from the config file instead of via SDK call.

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
