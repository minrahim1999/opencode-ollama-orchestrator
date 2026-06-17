# opencode-ollama-orchestrator

Multi-agent orchestrator for OpenCode, hard-locked to Ollama providers. Supports `/task`, `/plan`, `delegate_task` with Commander / Planner / Worker / Reviewer agents.

## Features

- **Hard Ollama lock**: Rejects any non-Ollama model at startup and at every LLM request
- **4-agent pipeline**: Commander → Planner → Worker → Reviewer
- **`/task` command**: Start missions with automatic planning and delegation
- **`delegate_task` tool**: Spawn subagent sessions dynamically via OpenCode SDK v2 APIs
- **Preserves user config**: Merges with existing agent settings in `opencode.json` (doesn't stomp your model assignments)

## Install

```bash
npm install -g opencode-ollama-orchestrator
```

Add to `opencode.json`:

```json
{
  "plugin": [
    "opencode-ollama-orchestrator"
  ],
  "agent": {
    "commander": { "model": "ollama/deepseek-v4-pro", "temperature": 0.3 },
    "planner":   { "model": "ollama/deepseek-v4-flash", "temperature": 0.8 },
    "worker":    { "model": "ollama/kimi-k2.7-code", "temperature": 0.2 },
    "reviewer":  { "model": "ollama/kimi-k2.6", "temperature": 0.3 }
  }
}
```

Restart OpenCode.

## Commands

| Command | Description |
|---------|-------------|
| `/task "description"` | Start a new mission (Commander) |
| `/plan` | Regenerate plan from todos (Planner) |
| `/agents` | List active agents and models (Reviewer) |
| `/status` | Show mission progress (Commander) |

## Architecture

```
┌──────────┐     ┌─────────┐     ┌────────┐     ┌──────────┐
│ Commander│────▶│ Planner │────▶│ Worker │────▶│ Reviewer │
│ /task    │     │ /plan   │     │ impl   │     │ verify   │
└──────────┘     └─────────┘     └────────┘     └──────────┘
```

## Requirements

- Node.js ≥ 20
- OpenCode ≥ 1.17.0
- Ollama server running locally (or accessible via configured `baseUrl`)

## License

MIT
