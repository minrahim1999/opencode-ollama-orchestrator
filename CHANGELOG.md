# Changelog

All notable changes to this project follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.0] - 2026-06-17

### Added
- **MissionController** — async state machine for fully automatic missions (`/auto` command)
- **Per-project directories** — plans stored in `{project}/.opencode/plans/{slug}/`, todos in `{project}/.opencode/todo/{slug}.md`
- **`/auto` command** — single command runs full pipeline: plan → execute → audit → complete
- **Session polling** — `pollSession()` waits for LLM completion instead of blind sleep
- **File-based plan watching** — `pollForFile()` detects when architect writes plan/todo files
- **`/version` command** — shows plugin version
- **14 vitest tests** — covering todo parser, constants, and path utilities
- **Slugification** — mission directories named from description (kebab-case, max 50 chars)

### Changed
- **Event handler rewritten** — delegates to MissionController for all mission logic
- **`/task` now runs manual mode** — pauses after planning, lets user review before `/auto` or `/plan`
- **`/retry` now uses MissionController.resume()`** — continues from current state
- **Agent prompts updated** — instruct agents to write to per-project directories
- **Delegate tool** — runtime alias resolution (planner→architect, worker→engineer, etc.)

### Fixed
- Removed all `require()` calls — pure ESM output
- `Map.values()` iterator fixed with `Array.from()` for TypeScript strict mode
- Mission state type comparison cast to avoid TS2367

## [1.0.0] - 2026-06-17

### Added
- Initial release of `opencode-ollama-orchestrator`
- Five configurable agent roles: Strategist, Architect, Engineer, Auditor, Specialist
- Full config inheritance from `opencode.json`: model, fallbackModel, temperature, topP, topK, maxTokens, thinking, skills, permission, prompt, systemPrompt, color
- Hard Ollama provider lock: validates at startup and every LLM request via `chat.params` hook
- `/task`, `/plan`, `/agents`, `/status`, `/delegate`, `/retry`, `/abort` slash commands
- `delegate_task` tool with Zod schema for spawning subagent sessions via SDK v2 APIs
- Subagent depth limiting (default: 2 levels)
- Max parallel workers control (default: 5)
- Max retry control (default: 3)
- Mission state tracking in `.opencode/missions/`
- Plugin-level configuration in `opencode.json`
- GitHub Actions CI (Node 20, 22) and auto-publish on release
- Comprehensive TypeScript types for all configs
