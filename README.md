# opencode-ollama-orchestrator

<p align="center">
  Multi-agent orchestrator for OpenCode — hard-locked to Ollama with full config inheritance.
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/opencode-ollama-orchestrator.svg?style=flat-square" alt="npm version">
  <img src="https://img.shields.io/badge/opencode-%3E%3D1.17.0-blue?style=flat-square" alt="OpenCode compat">
  <img src="https://img.shields.io/badge/node-%3E%3D20-green?style=flat-square" alt="Node version">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-brightgreen?style=flat-square" alt="License"></a>
</p>

## Why this exists

The original `opencode-orchestrator` stomps your agent configs and ignores your model assignments. This replacement:

- **Preserves every setting** you define in `opencode.json` (model, temperature, thinking, skills, permission...)
- **Hard-locks to Ollama** — rejects non-Ollama models at startup and at every inference call
- **5 agent roles** with clear separation: Strategist, Architect, Engineer, Auditor, Specialist
- **Customizable agent names** — rename them to whatever fits your workflow
- **Subagent delegation** via SDK v2 session APIs with depth limiting
- **7 slash commands**: `/task`, `/plan`, `/agents`, `/status`, `/delegate`, `/retry`, `/abort`

## Install

```bash
npm install -g opencode-ollama-orchestrator
```

## Quick Start

Add to your `opencode.json`:

```json
{
  "plugin": [
    "opencode-ollama-orchestrator"
  ],
  "agent": {
    "strategist": { "model": "ollama/deepseek-v4-pro", "temperature": 0.3 },
    "architect":  { "model": "ollama/deepseek-v4-flash", "temperature": 0.8 },
    "engineer":   { "model": "ollama/kimi-k2.7-code", "temperature": 0.2 },
    "auditor":    { "model": "ollama/kimi-k2.6", "temperature": 0.3 },
    "specialist": { "model": "ollama/deepseek-v4-flash", "temperature": 0.5 }
  }
}
```

Restart OpenCode. Done.

## Commands

| Command | Mode | Handler | Description |
|---------|------|---------|-------------|
| `/task "description"` | Manual | Strategist | Start mission, pause for review after planning |
| `/auto "description"` | Automatic | Strategist | Full auto: plan → execute → audit → complete |
| `/plan` | Manual | Architect | Regenerate or view plan |
| `/status` | Both | Strategist | Show mission progress |
| `/agents` | Both | Auditor | List active agents |
| `/delegate` | Manual | Strategist | Manually delegate a task |
| `/retry` | Both | Strategist | Retry failed tasks |
| `/abort` | Both | Strategist | Abort all missions |
| `/version` | Both | — | Show plugin version |

### Manual vs Automatic

**`/task`** — Planner creates `.opencode/plans/{slug}/plan.md` and `.opencode/todo/{slug}.md`, then pauses. You review the plan, then run `/auto` to continue.

**`/auto`** — Runs the entire pipeline without stopping. Architect writes plan, Engineers execute all todos in dependency order, Auditor verifies critical path, Strategist reports completion.

**File locations** (per-project):
```
{project}/
├── .opencode/
│   ├── plans/
│   │   └── build-auth-system/          # Mission directory (slugified name)
│   │       ├── plan.md                 # Architect's plan
│   │       └── state.json              # Mission state
│   └── todo/
│       └── build-auth-system.md        # Todos for this mission
```

## Full Config Reference

### Agent config (inherits everything)

Every field is optional. What's not set uses orchestrator defaults.

```json
{
  "agent": {
    "strategist": {
      "model": "ollama/deepseek-v4-pro",
      "fallbackModel": "ollama/deepseek-v4-flash",
      "temperature": 0.3,
      "topP": 0.9,
      "topK": 40,
      "maxTokens": 8192,
      "thinking": { "type": "enabled", "budgetTokens": 4000 },
      "skills": ["project-analysis", "risk-assessment"],
      "permission": "strict",
      "prompt": "custom full prompt (replaces default)",
      "systemPrompt": "prepended to default prompt",
      "color": "#ff0000"
    }
  }
}
```

### Plugin-level options

```json
{
  "plugin": [
    [
      "opencode-ollama-orchestrator",
      {
        "agents": {
          "strategist": "boss",
          "architect": "planner",
          "engineer": "coder",
          "auditor": "qa",
          "specialist": "expert"
        },
        "maxParallelWorkers": 5,
        "maxRetries": 3,
        "verbose": false,
        "requireApproval": false,
        "maxSubagentDepth": 2
      }
    ]
  ]
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `agents` | `{}` | Rename any of the 5 roles |
| `maxParallelWorkers` | `5` | Concurrent Engineer sessions |
| `maxRetries` | `3` | Retries before escalation |
| `verbose` | `false` | Extra mission logging |
| `requireApproval` | `false` | Approve shell commands in subagents |
| `maxSubagentDepth` | `2` | How deep Specialist chains can go |

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed flow diagrams and state persistence.

## Examples

- [Minimal config](examples/minimal.json) — just agent models
- [Advanced config](examples/advanced.json) — custom names, thinking mode, skills, fallbacks

## Ollama Lock

Three enforcement layers:

1. **Startup**: Scans all agent configs; throws if any model isn't `ollama/*`
2. **Session creation**: `delegate_task` validates before spawning subagents
3. **Inference-time**: `chat.params` hook blocks every non-Ollama request

Example error:

```
[ollama-orchestrator] Non-Ollama model blocked: "openai/gpt-4o".
Only Ollama providers are supported.
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT
