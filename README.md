# opencode-ollama-orchestrator

<p align="center">
  <b>Zero-command, fully automatic multi-agent orchestrator for OpenCode.</b><br>
  Provider-agnostic. Works with any model — Ollama, OpenAI, Anthropic, Gemini, and more.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#testing">Testing</a> ·
  <a href="#troubleshooting">Troubleshooting</a>
</p>

---

## Philosophy

**No commands. No slash. Just talk.**

Describe what you want in natural language. The Strategist decides if a mission is needed, commissions the Architect, dispatches Engineers in parallel, verifies critical work, and reports back. If anything gets stuck, the Specialist diagnoses and recovers automatically.

You never run `/task`, `/auto`, or anything. Just type naturally.

---

## Quick Start

1. **Install the plugin**

   ```bash
   npm install -g opencode-ollama-orchestrator
   ```

2. **Add to your `~/.config/opencode/opencode.json`**

   ```json
   {
     "plugin": [
       "opencode-ollama-orchestrator"
     ],
     "agent": {
       "strategist": { "model": "deepseek-v4-pro", "temperature": 0.3 },
       "architect":  { "model": "gemini-3-flash-preview", "temperature": 0.8 },
       "engineer":   { "model": "kimi-k2.7-code", "temperature": 0.2 },
       "auditor":    { "model": "kimi-k2.6", "temperature": 0.3 },
       "specialist": { "model": "deepseek-v4-flash", "temperature": 0.4 }
     }
   }
   ```

   Use any provider prefix: `ollama/`, `openai/`, `anthropic/`, `google/`, or omit entirely for local models.

3. **Start OpenCode and talk naturally**

   ```
   "Build a JWT auth system with refresh tokens"
   ```

---

## Features

| Feature | Description |
|---------|-------------|
| **Zero commands** | No `/task`, `/auto`, or slash commands. Natural language input only. |
| **Provider-agnostic** | Works with any model/provider. Uses whatever is configured per agent. |
| **Parallel execution** | Up to 3 engineers run concurrently, with dependency-aware scheduling. |
| **Smart task detection** | Confidence-scoring heuristic rejects casual chat ("ok", "thanks", "explain how X works") and accepts real requests ("build", "fix", "implement"). |
| **Critical-path auditing** | Auditor verifies only mission-critical tasks. ~60% of tasks skip audit for speed. |
| **Anti-stuck system** | Loop detection, timeout watchdog, and Specialist auto-recovery. |
| **Phase gates** | Optional user-controlled pauses between multi-phase plans for review. |
| **State persistence** | Mission state survives conversation compaction via filesystem storage. |
| **DOX integration** | Auto-generates timestamped run records and maintains `AGENTS.md`. |
| **Built-in isolation** | Auto-detects name collisions with OpenCode's built-in agents and renames safely. |

---

## Architecture

```
User types: "Build a JWT auth system with refresh tokens"
           |
           v
   ┌───────────────┐     Heuristic detection (confidence-scored)
   │  Strategist   │ ─── confirms this is a mission request
   │  (PRIMARY)    │
   └───────────────┘
           |
           | 1. Commission plan
           v
   ┌───────────────┐     Writes:
   │   Architect   │ ─── .opencode/plans/{slug}/plan.md
   │  (subagent)   │     .opencode/todo/{slug}.md
   └───────────────┘
           |
           | 2. Wait for files
           v
   ┌───────────────────────────────────┐
   │        DISPATCH LOOP               │
   │                                    │
   │  ┌─────────┐ ┌─────────┐ ┌─────────┐
   │  │Engineer │ │Engineer │ │Engineer │  Max 3 parallel
   │  │ #1      │ │ #2      │ │ #3      │  (configurable)
   │  └────┬────┘ └────┬────┘ └────┬────┘
   │       │           │           │
   │       └────┬──────┴─────┬─────┘
   │            v            v
   │       ┌────────┐  ┌────────┐
   │       │Auditor │  │Auditor │   Only critical-path tasks
   │       │(CP #1) │  │(CP #2) │   Non-critical skips audit
   │       └────┬───┘  └───┬────┘
   │            │          │
   │            v          v
   │       ┌──────────────────┐
   │       │  Loop detector   │   Same error ≥3 times?
   │       │  Timeout watcher │   Stalled >10 min?
   │       │  Resource guard  │   Queue full?
   │       └────────┬─────────┘
   │                │ YES → activate Specialist
   │                v
   │       ┌──────────────────┐
   │       │   Specialist     │   Diagnose, recommend, recover
   │       │  (subagent)      │   RETRY / REPLAN / SIMPLIFY
   │       └──────────────────┘
   │
   └───────────────────────────────────┘
           |
           | 3. All done
           v
   ┌───────────────┐     Summarize to user
   │  Strategist   │     Deliverables, issues, next steps
   │  (PRIMARY)    │
   └───────────────┘
```

---

## Agent Roles

| Agent | Mode | Responsibility | Cost Optimizations |
|-------|------|----------------|-------------------|
| **Strategist** | `primary` | Detect missions, orchestrate flow, summarize results | Only lightweight analysis |
| **Architect** | `subagent` | Write plans and todos | Runs once per mission |
| **Engineer** | `subagent` | Implement code | Parallelized, non-interfering |
| **Auditor** | `subagent` | Verify critical-path tasks | Only audits "critical-path: yes" |
| **Specialist** | `subagent` | Diagnose stuck missions, recover | Activates only on failure |

---

## Configuration

### Minimal Config

```json
{
  "plugin": [
    "opencode-ollama-orchestrator"
  ],
  "agent": {
    "strategist": { "model": "deepseek-v4-pro" },
    "architect":  { "model": "gemini-3-flash-preview" },
    "engineer":   { "model": "kimi-k2.7-code" },
    "auditor":    { "model": "kimi-k2.6" },
    "specialist": { "model": "deepseek-v4-flash" }
  }
}
```

### Full Config with Plugin Options

```json
{
  "plugin": [
    ["opencode-ollama-orchestrator", {
      "maxParallelWorkers": 3,
      "maxRetries": 3,
      "maxSubagentDepth": 2,
      "doxEnabled": true,
      "doxAutoInit": true,
      "doxAutoCloseout": true,
      "defaultAllowLoop": false,
      "defaultLoopCount": 0,
      "verbose": false,
      "requireApproval": false
    }]
  ],
  "agent": {
    "strategist": {
      "model": "deepseek-v4-pro",
      "fallbackModel": "deepseek-v4-flash",
      "smallModel": "gemini-3-flash-preview",
      "temperature": 0.3,
      "topP": 0.9,
      "maxTokens": 8192,
      "mode": "primary",
      "description": "Auto-orchestrator — detects missions, clarifies ambiguity, drives pipeline",
      "skills": ["dox-system"],
      "permission": {
        "read": "allow",
        "task": "allow",
        "skill": { "*": "allow" }
      }
    },
    "architect": {
      "model": "gemini-3-flash-preview",
      "temperature": 0.8,
      "mode": "subagent",
      "permission": {
        "write": { ".opencode/plans/*": "allow", ".opencode/todo/*": "allow", "AGENTS.md": "allow", "*": "deny" },
        "read": "allow",
        "task": "allow",
        "skill": { "*": "allow" }
      }
    },
    "engineer": {
      "model": "kimi-k2.7-code",
      "temperature": 0.2,
      "mode": "subagent",
      "tools": { "bash": true, "edit": true, "write": true },
      "permission": {
        "edit": "allow",
        "bash": "allow",
        "write": "allow",
        "skill": { "*": "allow" }
      }
    },
    "auditor": {
      "model": "kimi-k2.6",
      "temperature": 0.3,
      "mode": "subagent",
      "tools": { "bash": true },
      "permission": {
        "bash": "allow",
        "read": "allow",
        "skill": { "*": "allow" }
      }
    },
    "specialist": {
      "model": "deepseek-v4-flash",
      "temperature": 0.4,
      "mode": "subagent",
      "allowLoop": true,
      "loopCount": 3,
      "permission": {
        "read": "allow",
        "task": "allow",
        "skill": { "*": "allow" }
      }
    }
  }
}
```

### Plugin Options Reference

| Option | Type | Default | Range | Description |
|--------|------|---------|-------|-------------|
| `maxParallelWorkers` | number | `3` | 1–3 | Max concurrent engineer tasks |
| `maxRetries` | number | `3` | 0–5 | Max retries per failed task |
| `maxSubagentDepth` | number | `2` | 1–3 | Max nesting depth for subagent calls |
| `doxEnabled` | boolean | `true` | — | Enable DOX timestamped run records |
| `doxAutoInit` | boolean | `true` | — | Auto-create `.opencode/DOX/` + `AGENTS.md` |
| `doxAutoCloseout` | boolean | `true` | — | Append run summary to `AGENTS.md` on completion |
| `defaultAllowLoop` | boolean | `false` | — | Default loop permission for agents |
| `defaultLoopCount` | number | `0` | 0–5 | Default max loop count |
| `verbose` | boolean | `false` | — | Extra console logging |
| `requireApproval` | boolean | `false` | — | Require approval for shell commands |

---

## How It Works

### Task Detection

The Strategist uses a confidence-scoring heuristic to distinguish real task requests from casual chat:

| Triggers (accept) | Does NOT trigger (reject) |
|-------------------|---------------------------|
| "Build auth system with JWT" | "ok" |
| "Refactor payment module" | "thanks" |
| "Convert this to TypeScript" | "haha" |
| "Fix the bug in login" | "👍" |
| "Help me set up Docker" | "cool" |
| "Create a landing page" | "explain how closures work" |

Messages shorter than 10 chars, system commands starting with `/` or `@`, and common acknowledgements are ignored.

### Parallelism: 3-Worker Limit

The orchestrator enforces a hard cap of 3 concurrent workers (configurable down to 1):

```
Batch 1: TASK-001, TASK-002, TASK-003  ← 3 parallel
Wait for completions...
Batch 2: TASK-004, TASK-005, TASK-006  ← next 3
```

If resource exhaustion is detected (latency spikes), the system temporarily throttles to 1 worker.

### Phase Gates

When the Architect writes a multi-phase plan, you may want to review each phase before the next begins. **Phase gates** give you that control:

| Plan Type | Gate Behavior | User Action |
|-----------|---------------|-------------|
| Single-phase (≤1 phase) | No gates | Fully automatic |
| Multi-phase with `phase-gate: yes` | **Pauses after each phase** | Reply "yes" to continue, "no" to hold |
| Multi-phase without gates | Runs all phases | Fully automatic |

**How it works:**
1. Architect writes plan with `phase-gate: yes` on the last task of each phase
2. Engineer executes tasks within a phase in parallel (up to 3 workers)
3. When a `phase-gate: yes` task completes, the mission enters **HOLD** state
4. Strategist asks: *"Phase 'Setup' is complete. Continue to 'Core Feature'? (yes/no/comment)"*
5. **"yes"** → resume to next phase. **"no"** → mission stays in hold, you can request changes
6. If you request changes during hold, Specialist replans the remaining phases

### Anti-Stuck System

The orchestrator watches every task in real time:

| Detection | Threshold | Response |
|-----------|-----------|----------|
| **Task timeout** | > 10 minutes | Spawn Specialist to diagnose |
| **Retry loop** | Same error ≥3 times | Escalate to Specialist, stop brute-force |
| **Circular deps** | Task A → B → A | Detect before dispatch, abort with explanation |
| **All failed** | 100% failure rate | Specialist proposes simplified scope |
| **Stalled** | No progress > 10 min | Throttle workers, check model health |
| **Resource exhausted** | Latency spike > 30s | Drop to 1 worker temporarily |

The Specialist uses a diagnostic protocol:
```
DIAGNOSIS: loop
ROOT_CAUSE: Worker keeps generating invalid syntax for vite.config.ts
RECOMMENDATION: retry_with_changes
REQUIRED_ACTION: Use .mjs extension, avoid ESM/CJS mismatch
CONFIDENCE: high
```

### State Persistence

OpenCode may compact (truncate) conversation history when context windows fill. The orchestrator stores state in the file system so compaction never loses mission progress:

| Source | File | Survives Compaction |
|--------|------|--------------------|
| Mission plan | `.opencode/plans/{slug}/plan.md` | ✅ Yes |
| Task list | `.opencode/todo/{slug}.md` | ✅ Yes |
| Live state | `.opencode/plans/{slug}/state.json` | ✅ Yes |
| Chat history | In-memory (LLM context) | ❌ No — compaction erases this |

After any compaction event, the Strategist re-grounds by re-reading these files before continuing dispatch.

---

## File Layout (Per-Project)

Each mission gets its own directory under `.opencode/`:

```
{project}/
├── .opencode/
│   ├── AGENTS.md                        # DOX contract — seeded with orchestrator agents
│   ├── DOX/
│   │   └── {slug}.md                    # Timestamped run record with tasks, models, status
│   ├── plans/
│   │   └── jwt-auth-system/             # Slugified mission name
│   │       ├── plan.md                  # Architect's full plan
│   │       └── state.json             # Live mission state (atomic writes)
│   └── todo/
│       └── jwt-auth-system.md           # Task list with checkboxes
```

---

## DOX Framework Integration

The plugin auto-integrates with the DOX (Documentation of Execution) framework:

| Feature | Default | Description |
|---------|---------|-------------|
| `doxEnabled` | `true` | Enable DOX timestamped run records |
| `doxAutoInit` | `true` | Auto-create `.opencode/DOX/` + `AGENTS.md` on first mission |
| `doxAutoCloseout` | `true` | Append run summary to `AGENTS.md` on completion |

**Disable DOX:**
```json
{
  "plugin": [
    ["opencode-ollama-orchestrator", {
      "doxEnabled": false
    }]
  ]
}
```

---

## Testing

The plugin ships with **131 Vitest tests** covering all core modules. After installing globally, you can run the tests from the package directory:

```bash
# Find the global install path
npm ls -g opencode-ollama-orchestrator

# cd to that directory and run tests
cd $(npm root -g)/opencode-ollama-orchestrator
npm test
```

### Coverage Summary

| Module | Stmts | Branch | Funcs | Lines |
|--------|-------|--------|-------|-------|
| Agents | 100% | 100% | 100% | 100% |
| Config handler | 82.6% | 85.8% | 100% | 84.4% |
| Event handler | 62.5% | 50% | 71.4% | 55.6% |
| DOX | 100% | 88.9% | 100% | 100% |
| Provider lock | 100% | 100% | 100% | 100% |
| Todo parser | 94.1% | 80% | 75% | 95.7% |

---

## Troubleshooting

### Plugin not loading

**Symptom:** OpenCode starts but no orchestration happens.

1. Verify the plugin is installed:
   ```bash
   npm ls -g opencode-ollama-orchestrator
   ```

2. Check your `opencode.json` has the plugin entry:
   ```json
   "plugin": ["opencode-ollama-orchestrator"]
   ```

3. Ensure the plugin block is an **array** (not an object):
   ```json
   // ✅ Correct
   "plugin": ["opencode-ollama-orchestrator"]

   // ❌ Wrong — must be array
   "plugin": { "opencode-ollama-orchestrator": {} }
   ```

4. Check OpenCode console for warnings like `[opencode-orchestrator] Plugin config missing`.

### Model not found / Unauthorized

**Symptom:** `Error: Unauthorized` or model not found.

1. Verify the model name includes the correct provider prefix:
   ```json
   "model": "ollama/deepseek-v4-pro"   // Ollama Cloud
   "model": "openai/gpt-4o"             // OpenAI
   "model": "anthropic/claude-sonnet-4"  // Anthropic
   ```

2. For Ollama Cloud: ensure your API key is set in `~/.opencode/config.yaml` or environment:
   ```bash
   export OLLAMA_API_KEY=sk-...
   ```

3. The plugin is provider-agnostic — it does not validate model names. The error comes from your provider, not the plugin.

### Missions not detected

**Symptom:** You say "build a login page" but nothing happens.

1. Check if your message is too short (< 10 chars) or contains rejection keywords ("explain", "what is", "how does").
2. Messages starting with `/` or `@` are ignored as system commands.
3. Common acknowledgements ("ok", "thanks", "got it") are ignored.

### Agent name collisions

**Symptom:** Warning `[opencode-orchestrator] Built-in collision: worker -> orchestrator-worker`.

This is expected behavior. The plugin auto-renames orchestrator agents that conflict with OpenCode's built-in agents (`compaction`, `explorer`, `worker`, `executor`, `debugger`). No action needed.

### State file corruption

**Symptom:** Mission resumes from wrong state or errors on load.

The plugin uses atomic writes (write to `.tmp` then rename). If you see corruption, it's likely from a hard crash during a non-atomic external write. Delete the affected `.opencode/plans/{slug}/state.json` and the mission will start fresh.

---

## Built-in Agent Isolation

OpenCode ships with built-in subagents (`compaction`, `explorer`, `worker`, `executor`, `debugger`). Our orchestrator agents are completely separate. To prevent collisions:

1. **Auto-rename on collision** — If you name an orchestrator agent `"worker"`, the config handler auto-renames it to `"orchestrator-worker"` and prints a warning. Built-in functionality is never overwritten.
2. **Prompt boundaries** — Every agent prompt instructs: "NEVER interact with built-in OpenCode agents."
3. **Architect naming rule** — Tasks must never be named after built-in agents to avoid namespace confusion.

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for full version history.

### Recent Versions

| Version | Date | Highlights |
|---------|------|------------|
| **2.1.7** | 2026-06-17 | 131 tests added, shipped in npm tarball |
| **2.1.6** | 2026-06-17 | Provider lock removed — now provider-agnostic |
| **2.1.5** | 2026-06-17 | Regex robustness, config validation, atomic writes |
| **2.1.4** | 2026-06-17 | 9 critical bug fixes (phase gates, session tracking, audit, dead-locks) |
| **2.1.2** | 2026-06-17 | Plugin init hang fixed |

---

## License

MIT © 2026 muhaimin
