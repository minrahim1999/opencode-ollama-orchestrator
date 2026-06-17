# opencode-ollama-orchestrator

<p align="center">
  Zero-command, fully automatic multi-agent orchestrator for OpenCode — Ollama-only.
</p>

---

## Philosophy

**No commands. No slash. Just talk.**

Describe what you want. The Strategist decides if a mission is needed, commissions the Architect, dispatches Engineers in parallel, verifies critical work, and reports back. If anything gets stuck, the Specialist diagnoses and recovers automatically.

You never run `/task`, `/auto`, or anything. Just type naturally.

---

## How It Works

```
User types: "Build a JWT auth system with refresh tokens"
           |
           v
   ┌───────────────┐     Heuristic detection (keywords + length)
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
   │  │ #1      │ │ #2      │ │ #3      │  (Ollama Pro limit)
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

## Anti-Stuck System

The orchestrator watches every task in real time:

| Detection | Threshold | Response |
|-----------|-----------|----------|
| **Task timeout** | > 10 minutes | Spawn Specialist to diagnose |
| **Retry loop** | Same error ≥3 times | Escalate to Specialist, stop brute-force |
| **Circular deps** | Task A → B → A | Detect before dispatch, abort with explanation |
| **All failed** | 100% failure rate | Specialist proposes simplified scope |
| **Stalled** | No progress > 10 min | Throttle workers, check Ollama health |
| **Resource exhausted** | Latency spike > 30s | Drop to 1 worker temporarily |

The Specialist uses a diagnostic protocol:
```
DIAGNOSIS: loop
ROOT_CAUSE: Worker keeps generating invalid syntax for vite.config.ts
RECOMMENDATION: retry_with_changes
REQUIRED_ACTION: Use .mjs extension, avoid ESM/CJS mismatch
CONFIDENCE: high
```

---

## Parallelism: Hard 3-Worker Limit

Ollama Pro supports **3 concurrent requests**. This is enforced at the config level:

```javascript
// In config-handler.ts
const enforcedMaxParallel = Math.min(userSetting ?? 3, 3);
```

- **Default**: 3
- **Maximum user override**: 3 (anything higher clamped)
- **Dynamic throttling**: If resource exhaustion detected, temporarily drops to 1

Workers are dispatched as:
```
Batch 1: TASK-001, TASK-002, TASK-003  ← 3 parallel
Wait for completions...
Batch 2: TASK-004, TASK-005, TASK-006  ← next 3
```

---

## File Layout (Per-Project)

Each mission gets its own directory:

```
{project}/
├── .opencode/
│   ├── plans/
│   │   └── jwt-auth-system/           # Slugified mission name
│   │       ├── plan.md                # Architect's full plan
│   │       └── state.json             # Live mission state
│   └── todo/
│       └── jwt-auth-system.md         # Task list with checkboxes
```

---

## Built-in Agent Isolation

OpenCode ships with built-in subagents (`compaction`, `explorer`, `worker`, `executor`, `debugger`). Our orchestrator agents are completely separate. To prevent collisions:

1. **Auto-rename on collision** — If you name an orchestrator agent `"worker"`, the config handler auto-renames it to `"orchestrator-worker"` and prints a warning. Built-in functionality is never overwritten.
2. **Prompt boundaries** — Every agent prompt instructs: "NEVER interact with built-in OpenCode agents."
3. **Architect naming rule** — Tasks must never be named after built-in agents to avoid namespace confusion.

## Phase Gates: User-Controlled Progression

When the LLM returns a multi-phase plan, you may want to review each phase before the next begins. **Phase gates** give you that control:

| Plan Type | Gate Behavior | User Action |
|-----------|---------------|-------------|
| Single-phase (≤1 phase) | No gates | Fully automatic |
| Multi-phase with `phase-gate: yes` | **Pauses after each phase** | Reply "yes" to continue, "no" to hold |
| Multi-phase without gates | Runs all phases | Fully automatic |

**How it works:**
1. Architect writes plan with `phase-gate: yes` on the last task of each phase (or a dedicated verification task)
2. Engineer executes tasks within a phase in parallel (up to 3 workers)
3. When a `phase-gate: yes` task completes, the mission enters **HOLD** state
4. Strategist asks: *"Phase 'Setup' is complete. Continue to 'Core Feature'? (yes/no/comment)"*
5. **"yes"** → resume to next phase. **"no"** → mission stays in hold, you can request changes
6. If you request changes during hold, Specialist replans the remaining phases

**Example gated plan:**
```markdown
## Phase 1: Database Setup
- [ ] TASK-001: Create tables (@engineer, critical-path: yes, phase-gate: yes)
  - Acceptance: Migration runs without errors
  - Depends: []

## Phase 2: API Implementation
- [ ] TASK-002: Build REST endpoints (@engineer, critical-path: yes)
  - Acceptance: All endpoints return 200/201
  - Depends: [TASK-001]
- [ ] TASK-003: Add validation middleware (@engineer)
  - Acceptance: Invalid requests rejected with 400
  - Depends: [TASK-002]
```

In this example, the mission pauses after TASK-001 completes. You review the database setup. If satisfied, reply "yes" — Phase 2 tasks dispatch automatically. If not, reply "no" and request fixes.

---

## State Persistence Across Compaction

OpenCode may compact (truncate) conversation history when context windows fill. Our orchestrator stores state in the file system so compaction never loses mission progress:

| Source | File | Survives Compaction |
|--------|------|--------------------|
| Mission plan | `.opencode/plans/{slug}/plan.md` | ✅ Yes |
| Task list | `.opencode/todo/{slug}.md` | ✅ Yes |
| Live state | `.opencode/plans/{slug}/state.json` | ✅ Yes |
| Chat history | In-memory (LLM context) | ❌ No — compaction erases this |

After any compaction event, Strategist re-grounds by re-reading these files before continuing dispatch.

---

## DOX Framework Integration

The plugin auto-integrates with the DOX (Documentation of Execution) framework:

| Feature | Default | Description |
|---------|---------|-------------|
| `doxEnabled` | `true` | Enable DOX timestamped run records |
| `doxAutoInit` | `true` | Auto-create `.opencode/DOX/` + `AGENTS.md` on first mission |
| `doxAutoCloseout` | `true` | Append run summary to `AGENTS.md` on completion |

**Per-mission files created:**
```
.opencode/
├── AGENTS.md              # DOX contract — seeded with orchestrator agents
├── DOX/
│   └── {slug}.md          # Timestamped run record with tasks, models, status
├── plans/{slug}/
│   ├── plan.md            # Architect's plan
│   └── state.json         # Live mission state
└── todo/{slug}.md         # Checkbox task list
```

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

## Installation

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
    "specialist": { "model": "ollama/deepseek-v4-flash", "temperature": 0.4 }
  }
}
```

That's it. No commands. But full agent customization is supported:

**Full opencode.json example:**
```json
{
  "plugin": [
    ["opencode-ollama-orchestrator", {
      "maxParallelWorkers": 3,
      "maxRetries": 3,
      "doxEnabled": true,
      "doxAutoInit": true,
      "doxAutoCloseout": true,
      "defaultAllowLoop": false,
      "defaultLoopCount": 0
    }]
  ],
  "agent": {
    "strategist": {
      "model": "ollama/deepseek-v4-pro",
      "fallbackModel": "ollama/deepseek-v4-flash",
      "smallModel": "ollama/gemini-3-flash-preview",
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
      "model": "ollama/deepseek-v4-flash",
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
      "model": "ollama/kimi-k2.7-code",
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
      "model": "ollama/kimi-k2.6",
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
      "model": "ollama/deepseek-v4-flash",
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

All standard agent fields are forwarded: `model`, `fallbackModel`, `smallModel`, `temperature`, `topP`, `topK`, `maxTokens`, `description`, `prompt`, `systemPrompt`, `mode`, `color`, `tools`, `permission`, `skills`, `thinking`, `allowLoop`, `loopCount`.

---

## What Triggers a Mission

The Strategist detects missions from natural language:

| Triggers | Does NOT trigger |
|----------|------------------|
| "Build auth system with JWT" | "ok" |
| "Refactor payment module" | "thanks" |
| "Convert this to TypeScript" | "haha" |
| "Fix the bug in login" | "👍" |
| "Help me set up Docker" | "cool" |
| "Create a landing page" | "yes" |

Messages shorter than 10 chars, system commands starting with `/`, and common acknowledgements are ignored.

---

## Cost Optimizations

| Mechanism | Savings |
|-----------|---------|
| **Parallelism limited to 3** | No queue overflow, no timeouts |
| **Auditor only on critical-path** | Skips ~60% of verification overhead |
| **Token-efficient Engineer prompt** | Self-documenting code, minimal comments |
| **No redundant planning** | Architect runs once per mission |
| **Loop detection** | Stops brute-force retries |
| **Dynamic worker throttling** | Reduces to 1 when Ollama stressed |

---

## State Machine

```
         idle
           |
           | user message detected
           v
   commissioning_plan  ──> Architect spawned
           |
           | plan files written
           v
     awaiting_plan  ──> pollForFile()
           |
           | todos parsed
           v
      dispatching  ──> group into batches of ≤3
           |
           v
      executing  ──> poll each session
           |
           | all done
           v
      verifying  ──> Auditor on critical items
           |
           | pass
           v
      completed  ──> Strategist summary to user
           |
           +──> detecting  ──> Specialist
           |    stuck/loop       diagnosis
           |                        |
           +────────────────────────┘ retry / replan / abort
```

---

## Roadmap

- [ ] Session status polling via SDK v2 status endpoint
- [ ] WebSocket streaming for real-time progress
- [ ] Metrics: token usage per mission, agent throughput
- [ ] Adaptive temperature: raise on repeated failures
- [ ] Agent swapping: route to different Ollama model on failure

---

## License

MIT © 2026 muhaimin
