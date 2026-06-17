# Changelog

All notable changes to this project follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
