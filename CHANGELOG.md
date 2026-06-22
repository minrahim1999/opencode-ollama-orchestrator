# Changelog

All notable changes follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.5.2] - 2026-06-22

### Feature: Ponytail "Lazy Senior Dev" Integration

Integrated the [Ponytail](https://github.com/DietrichGebert/ponytail) ruleset directly into the orchestrator plugin — no external dependency, no commands needed. The ruleset is injected into every agent's system prompt via `experimental.chat.system.transform`, making all agents (strategist, architect, engineer, auditor, specialist, spark) write less code, prefer stdlib/platform features, and never over-engineer.

### Added
- **`src/core/ponytail.ts`**: Self-contained ponytail ruleset builder with 4 intensity levels (`off`, `lite`, `full`, `ultra`). Default: `full`. No dependency on the ponytail repo — the ruleset text is embedded as the single source of truth.
- **`index.ts`**: Added `experimental.chat.system.transform` hook that injects ponytail instructions into every system prompt at the configured level. Resolved once at plugin init from `cfg.ponytailLevel`.
- **`types.ts`**: Added `ponytailLevel` to `OrchestratorConfig` interface.
- **`constants.ts`**: `loadOrchestratorConfig` now reads and returns `ponytailLevel` from plugin config (default: `"full"`).
- **`config-handler.ts`**: `config.orchestrator` now includes `ponytailLevel` in the runtime config object.
- **`test/ponytail.test.ts`**: 13 tests covering level normalization, instruction generation, ladder rungs, safety sections, and intensity-specific content.

### Configuration

Add `ponytailLevel` to your plugin config in `opencode.json`:

```json
{
  "plugin": [
    ["opencode-ollama-orchestrator", {
      "ponytailLevel": "ultra"
    }]
  ]
}
```

Levels:
- `off` — No injection
- `lite` — Build what's asked, name the lazier alternative in one line
- `full` (default) — The ladder enforced. Stdlib + native first. Shortest diff
- `ultra` — YAGNI extremist. Deletion before addition. Challenge the request

### Test Results
- 226 tests passing (17 test files)
- Typecheck clean

## [2.5.1] - 2026-06-19

### Fix: Question Modal Not Working

The `chat.message` hook was auto-starting the pipeline (`controller.start()`) immediately when it detected a task-like message. This bypassed the strategist agent entirely — the pipeline ran in headless subagent sessions where the `question` tool can't show TUI modals, so questions appeared as plain text.

### Changed
- **event-handler.ts**: Removed auto-start of `controller.start()`. The hook now only handles `/btw` sideline questions. All other messages are processed by the strategist agent (the primary session) which can call the `question` tool to show interactive modals.
- **index.ts**: Added `start_mission` tool — called by the strategist after user confirms via the question modal. Takes a `description` argument and calls `controller.start(description, true)`.
- **strategist.ts**: Updated prompt to instruct the strategist to call `start_mission` after the user selects "Proceed" from the question tool modal.
- **config-handler.ts**: Added `start_mission` to the strategist agent's default tools and permissions.

### Flow (New)
```
User message → Strategist processes in primary session
  → Strategist calls question tool → Interactive modal shows
  → User selects "Proceed" → Strategist calls start_mission tool
  → Pipeline launches (architect → engineers → auditor)
```

### Test Results
- 213 tests passing (16 test files)
- Typecheck clean

## [2.5.0] - 2026-06-19

### Critical Fix: Model Switching Was Completely Broken

The orchestrator was not switching models between subagents — every subagent used the same (default/global) model throughout the entire pipeline. Three root causes identified and fixed:

### Fixed (Critical Bugs)

- **Bug #1: Automatic pipeline never fired (event-handler.ts)**
  - The `event` hook listened for `message.created` — an event type that **does not exist** in OpenCode 1.17.x+. The SDK's actual event types are `message.updated`, `session.created`, `session.updated`, etc. There is no `message.created`.
  - As a result, `controller.start()` was **never called automatically**. When the user typed a task and hit enter, OpenCode just answered with the current model. The entire multi-agent pipeline (architect → engineer → auditor) was dead on arrival.
  - **Fix:** Switched from the `event` hook to the `chat.message` hook — the OpenCode plugin SDK's dedicated hook for intercepting new user messages. This hook provides `{ message: UserMessage, parts: Part[] }` directly, no event type guessing needed.
  - Exported function renamed: `createEventHandler` → `createChatMessageHandler`.
  - `index.ts` updated: `event:` hook → `"chat.message":` hook.

- **Bug #2: session.create() does not accept model or agent (session-manager.ts)**
  - The OpenCode SDK's `SessionCreateData.body` only accepts `{ parentID?, title? }`. There is **no `model` or `agent` field**. The plugin was passing `{ agent, model: { providerID, modelID } }` to `session.create`, which were silently ignored by the SDK.
  - **Fix:** `session.create` now only sends `{ directory, title, parentID? }`. The `agent` and `model` are passed to `session.prompt()` instead, which is the correct SDK call for model/agent selection (`SessionPromptData.body` accepts `{ model?: { providerID, modelID }, agent?, parts }`).
  - `promptSession()` now explicitly passes both `agent` and `model` on every prompt call, ensuring each subagent uses its configured model.
  - Fallback model logic updated: the fallback model is now resolved and stored, then passed on `promptSession()` if the primary model's circuit breaker is open.

- **Bug #3: delegate-task.ts had the same session.create issue**
  - Same fix applied: `session.create` receives only `{ directory, title, parentID? }`. `session.prompt` receives `{ agent, model, parts }`.
  - `parentID` is correctly kept on `session.create` (the SDK does accept it there).

### Changed
- `event-handler.ts`: `createEventHandler` → `createChatMessageHandler`. Hook type changed from `event` to `chat.message`.
- `index.ts`: Hook registration changed from `event:` to `"chat.message":`.
- `session-manager.ts`: Removed `agent` and `model` from all `session.create` calls (both primary and fallback paths). `promptSession()` now explicitly passes `agent` alongside `model`.
- `delegate-task.ts`: Removed `agent` and `model` from `session.create`. Added `agent` and `model` to `session.prompt` call.

### Added (Tests)
- 5 new tests for `createChatMessageHandler`: task detection, casual chat rejection, `/btw` sideline routing, empty message handling, multi-part text joining.
- 1 new test for `promptSession` model+agent passing (v2.5.0 fix verification).
- Updated `createSession` tests to verify `session.create` does NOT receive `model`/`agent`.
- Updated `delegate-task` tests to verify model+agent are on `session.prompt`, not `session.create`.

### Test Results
- 214 tests passing (16 test files)
- 0 failures (1 pre-existing unhandled rejection from fake-timers edge case in `pollForFile` test)

## [2.4.0] - 2026-06-18

### Architecture: God Class Split + Integration Tests

### Added
- **SessionManager** (`src/core/session-manager.ts`, 325 lines) — extracted from MissionController. Owns all session lifecycle logic: `createSession`, `promptSession`, `pollSession`, `pollForFile`, model fallback chain, circuit breaker, rate limiter. Exposes introspection getters (`getModelFailures`, `getBrokenModels`, `getRateLimiter`) for testing.
- **MissionStore** (`src/core/mission-store.ts`, 201 lines) — extracted from MissionController. Owns persistence: `saveMissionState`, `loadMissionsFromDisk`, `startCleanup`, `stopCleanup`, `startMemoryPurge`.
- **28 integration tests** for SessionManager and MissionStore (13 + 15):
  - SessionManager: primary model success, fallback, both-fail, circuit breaker tracking, prompt tracking, SDK status polling, local map fallback, file polling, rate limiter
  - MissionStore: save/load state.json, restore executing/hold/retrying missions, ignore completed, handle corrupted JSON, cleanup old dirs, memory purge

### Changed
- **MissionController** reduced from 1613 → 1252 lines (22% smaller). Now delegates to SessionManager and MissionStore instead of containing all logic inline.
- **SessionManager**: createSession now works when no model is configured (previously threw "unknown error" — now lets SDK use its default model).
- **Shared `sessions` Map pattern**: both SessionManager and MissionStore receive shared maps in their constructors and mutate in place, preserving the existing sharing with event-handler and delegate-task tool.

## [2.3.0] - 2026-06-18

### Major Overhaul — Critical Bug Fixes, Deduplication, Dead Code Cleanup

### Fixed (Critical Bugs)
- **`Logger.stop()` was unreachable** — `process.exit(0)` ran before `Logger.stop()` in the shutdown handler, so the final log buffer flush never happened. Reordered to `Logger.stop()` → `process.exit(0)`.
- **`writeFileAtomicSync` never cleaned up temp files** — the catch block was empty. Now calls `unlinkSync(tmpPath)` on failure to prevent temp file leaks in `os.tmpdir()`.
- **`revertBackup` git_commit used `--soft` reset** — `git reset --soft` only moves HEAD, working tree stays mutated. Changed to `--hard` to actually revert files.
- **`revertBackup` directory strategy left orphan files** — only copied snapshot files over current ones. Now deletes files that exist in the project but NOT in the snapshot (created during the mission).
- **`updateTodoStatus` race condition** — read-modify-write was not atomic across concurrent calls. Now uses `updateFileAtomicSync()` with a callback updater, preventing lost updates when parallel tasks complete simultaneously.
- **Shell injection in `revertBackup`** — `execSync` with string interpolation replaced by `execFileSync` with arg arrays throughout `backup.ts`.
- **Fast-mode notifications sent to public ntfy topics** — `notify({ ntfyTopic: String(this.config.mode) })` sent mission events to `https://ntfy.sh/fast` (public). Now uses the user's configured `notifyConfig` and only sends when actually configured.
- **`pollSession` could run 20 minutes instead of 10** — if the SDK status API loop timed out without throwing, it fell through to a second polling loop. Added `return` after SDK loop exhaustion.
- **`loadMissionTodos` didn't parse `[~]` (in_progress)** — the duplicated inline parser only matched `[ ]` and `[x]`. Replaced with shared `parseTodos()` call, eliminating the divergence.
- **`maxParallelWorkers` default mismatch** — `constants.ts` defaulted to 5, `config-handler.ts` hard-capped to 3. Aligned default to 3.
- **`sparkPerm` typo** — used `skills` (plural) instead of `skill` (singular). Spark's skill permission was silently ignored. Fixed.
- **`looksLikeTaskRequest` had dead branch** — `(!hasWeakSignal && strongKeywords.some(...))` was fully subsumed by `hasStrongKeyword`. Simplified to `return hasStrongKeyword`.
- **Logger rotation never ran** — `Logger.rotate()` was defined but never called. Now called on `init()`. Also used `require("node:fs")` inside ESM module — replaced with already-imported fs functions.
- **Logger intervals not unref'd** — `setInterval` for flush timer kept process alive. Added `.unref()`.
- **Hallucination guard absolute-path bypass** — `existsSync(f)` for absolute `f` checked the real filesystem, so `/etc/passwd` passed the scope check. Now rejects absolute paths outside `workingDir`.
- **Backup copies `.env`/secrets** — directory snapshot didn't skip `.env`, `.env.local`, `.env.production`, `.env.staging`. Added to skip list.

### Changed (Architecture)
- **Deduplicated `loadUserConfig`/`parseModel`** — was copy-pasted in both `mission-controller.ts` and `delegate-task.ts`. Extracted to shared `utils/config-loader.ts` with mtime-based caching (eliminates ~300 sync disk reads per 50-task mission).
- **Deduplicated `resolveAgentAlias`** — was duplicated in `constants.ts` and `delegate-task.ts`. Now `delegate-task.ts` imports from `constants.ts`.
- **Consolidated `MissionState`/`MissionCtx` types** — `core/types.ts` had unused dead types (`DiagnosticReport`, `StuckReason`, `WatchdogConfig`, `DEFAULT_WATCHDOG`) with divergent `MissionState`/`MissionCtx` definitions. Cleaned to one canonical set.
- **`backup.ts` git commands use `execFileSync`** — all `execSync(\`git ... "${var}"\`)` replaced with `execFileSync("git", [...args])` to prevent shell injection.

### Removed (Dead Code)
- **`src/utils/provider-lock.ts`** — deprecated no-op since v2.1.6. Deleted along with its test file.
- **`src/core/types.ts` dead types** — `StuckReason`, `DiagnosticReport`, `WatchdogConfig`, `DEFAULT_WATCHDOG`, old `MissionCtx` with unused fields (`loopCounts`, `diagnostics`, `startTime`, `lastProgressAt`). All removed.
- **Unused `FastModeConfig` import** in `index.ts`.

## [2.2.1] - 2026-06-18

### Fixed
- **Critical: Plan/todo files never created** — root cause was absolute path mismatch.
  - `mission-controller.start()` sent **absolute paths** (e.g. `/Users/.../.opencode/plans/{slug}/plan.md`) to the architect agent in prompts, but the architect's write permissions use **relative globs** (`.opencode/plans/**`). OpenCode silently denied the write, the file was never created, and `pollForFile()` timed out after 5 minutes with no visible error.
  - Fix: All agent prompts now use **relative paths** (`.opencode/plans/{slug}/plan.md`, `.opencode/todo/{slug}.md`) which match the permission globs.
  - Same fix applied to `buildTaskPrompt()` (engineer todo path) and `runAudit()` (audit result path).
- **Silent timeout failure** — when `pollForFile()` timed out, the error was caught by the event handler and logged to stderr only, with no TUI toast. Now emits a visible error toast with actionable message and sets mission state to `failed`.
- **Mission memory not persisted after every task** — `saveMissionState()` was only called at state transitions (planning→executing, executing→completed). If the process crashed mid-task, accumulated `TaskMemoryEntry[]` context was lost. Now `saveMissionState()` is called after every `addTaskMemory()` — on success, audit-fail, and error-fail paths.

## [2.2.0] - 2026-06-18

### Added
- **Spark sideline agent** (`/btw`) — fire-and-forget Q\u0026A sessions that run in parallel with active missions.
  - Usage: `/btw how does OAuth2 PKCE work?`
  - Read-only permissions — cannot write, edit, or spawn subagents.
  - Non-blocking: spawns a separate session via `client.v2.session.create()`, does not await completion.
  - Toast notification on spawn so user knows answer is coming.
  - Default maxTokens 2048, temperature 0.3. Can override with `smallModel` plugin option.
- **Anti-recursion guards** in all agent prompts:
  - Engineer: added "NEVER spawn subagents via task tool — you are the worker, do the task yourself"
  - Architect: added "NEVER spawn subagents or call task tool — your job ends after writing the plan"
  - Auditor: added "NEVER spawn subagents to complete verification — do the audit yourself"
  - Specialist: added "NEVER spawn additional subagents — call the question tool or write your recommendation"
  - Strategist: added "NEVER attempt to do work yourself — always delegate" and "Sideline questions → delegate to Spark subagent"
- **Spark agent registration** — `config-handler` registers `spark` as a `subagent` with read-only tools/permissions.

### Changed
- **Strengthened question-tool compliance** across all agent prompts to ensure modal picker (not plain text):
  - Strategist: Mode 1/2/phase-gate instructions now say "ALWAYS call the 'question' tool. NEVER write plain text."
  - Architect: phase-gate rules now remind Strategist to call question tool, not write plain text.
  - Engineer: blocked-task and oversized-task rules now say "ALWAYS call the 'question' tool. NEVER write plain text."
  - Specialist: ESCALATE_TO_USER now says "ALWAYS call the 'question' tool. NEVER write plain text."
- `ResolvedNames` and `DEFAULT_NAMES` expanded to include `spark`.
- `AgentNameConfig` expanded to support `spark` custom name override.
- `buildAgentConfig` assigns `maxTokens: 2048` and `temperature: 0.3` for spark role.
- Event handler (`createEventHandler`) intercepts `/btw ` and `btw ` prefix before task-request detection.

## [2.1.18] - 2026-06-17

### Added
- **Operating Modes** — `slow` (default) vs `fast` runtime mode selector.
  - `slow`: Current behavior — multi-agent, parallel, phase gates, full quality.
  - `fast`: Autonomous 24/7 — single-worker, no human gates, aggressive timeouts.
- **Hallucination Guard** — `src/core/hallucination-guard.ts`. Validates every agent write for file existence, evidence citation, confidence threshold. Rejects, revises, or escalates suspicious outputs. Mandatory in fast mode.
- **Token Budget Manager** — `src/core/token-budget.ts`. Per-task token ceiling + rolling context window with auto-summarize trigger at 80% fill. Hard stop when total budget exhausted.
- **Fast Mode Controller** — `src/core/fast-mode.ts`. Serial mission queue, watcher loop (5s interval), mission-level timeout, structured notifications.
- **Mode config** — `fastMode` block in `opencode.json`: `mode`, `confidenceThreshold`, `maxTokensPerTask`, `contextWindowBudget`, `enableFastTrack`, `fastModels`.
- **Fast-track detection** — Keyword-based detection (fix, bug, test, refactor, lint, typo) routes quick tasks straight to fast execution.
- **New tools**:
  - `fast_run` — queue a mission for fast-mode execution
  - `set_orchestrator_mode` — record mode switch request
- **Biome linting** — replaced placeholder `echo` with real `biome check`. CI now fails on lint errors.

### Changed
- `loadOrchestratorConfig()` now parses `fastMode` from plugin options and exposes `mode` + `fastMode`.
- CI `lint` step no longer `continue-on-error: true`.

### Tests
- Added `test/mode.test.ts` — mode resolution, fast-track detection, clamping
- Added `test/hallucination-guard.test.ts` — evidence extraction, validation, guard instructions
- Added `test/token-budget.test.ts` — budget tracking, exhaustion, summarize, estimation
- Added `test/fast-mode.test.ts` — queue, serial execution, token pause, resume
- Added `test/ratelimiter.test.ts` — TokenBucket burst, refill, waitForTokens
- Added `test/backup.test.ts` — directory snapshot, revert, exclusions, cleanup

## [2.1.17] - 2026-06-17

### Added
- **Rate limiting** — Token-bucket `createOllamaRateLimiter(...)` based on `maxParallelWorkers`. Every `createSession(...)` acquires a token before dispatch. Prevents overwhelming local Ollama.
- **Actual session kill** — `checkWatchdog()` now calls `client.v2.session.close(...)` on stuck sessions (not just marking Map entries inactive). Sends notification on kill.
- **Notifications** — `src/utils/notifier.ts` supports ntfy.sh push and custom webhooks. Events: `mission_started`, `mission_completed`, `mission_failed`, `mission_stuck`, `backup_created`. Configured via `notify` in `opencode.json`.
- **Structured logging** — `Logger.log(level, component, msg, meta)` writes JSON to `.opencode/logs/orchestrator-{date}.ndjson`. Severity levels: trace, debug, info, warn, error, fatal.

### Changed
- `executeTodos()` is now gated by rate limiter; waits up to 60s for capacity.
- `checkWatchdog()` is now async (returns `Promise<void>`).

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
