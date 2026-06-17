# Architecture

## Agent Pipeline

```
User /task "Build auth system"
        |
        v
   ┌─────────┐
   │Strategist│──────┐
   │ /task    │      │ commission plan
   └─────────┘      v
               ┌─────────┐
               │Architect│
               │ /plan   │───> .opencode/todos.md
               └─────────┘      │
                                │ phase-by-phase
                                v
                          ┌─────────┐
                    ┌────│ Engineer │<───┐ (parallel, max 5)
                    │    │ impl     │    │
                    │    └─────────┘    │
                    │                   │
                    v                   v
               ┌─────────┐       ┌─────────┐
               │Auditor  │       │Specialist│ (deep domain)
               │verify   │       │escalate  │
               └─────────┘       └─────────┘
                    │
                    v
              STRATEGIST ──> MISSION_COMPLETE
```

## Data Flow

1. **Config Phase** (plugin load)
   - `config` hook merges user agent settings with orchestrator defaults
   - Validates all models are `ollama/*`
   - Injects `/task`, `/plan`, `/status`, `/agents`, `/delegate`, `/retry`, `/abort` commands

2. **Planning Phase** (Architect)
   - Reads context files
   - Writes `.opencode/todos.md` with phases, dependencies, acceptance criteria

3. **Execution Phase** (Engineers)
   - Parallel workers up to `maxParallelWorkers`
   - Each worker gets full context from parent session
   - Updates todos.md with evidence on completion

4. **Verification Phase** (Auditor)
   - Reads acceptance criteria
   - Runs tests, checks for regressions
   - Outputs PASS / CONDITIONAL / FAIL

5. **Completion Phase** (Strategist)
   - Collects all audit results
   - If all PASS, emits `MISSION_COMPLETE`
   - If any FAIL, triggers retry or escalation

## Config Inheritance

```
opencode.json agent.{name}              plugin-level options
        |                                       |
        v                                       v
   {model, temperature,                       {maxParallelWorkers,
    maxTokens, skills,                         maxRetries, verbose,
    permission, prompt,                        requireApproval,
    systemPrompt, ...}                         maxSubagentDepth}
        |                                       |
        +──────────────┬────────────────────────┤
                       v
              config-handler merges
                       |
                       v
        final agent config = { ...user, ...defaults }
```

## State Persistence

Missions are tracked in:
- `.opencode/missions/{missionId}.json` — mission state, agent assignments, todos
- `.opencode/todos.md` — human-readable plan (updated by Architect)
- In-memory `Map<string, AgentState>` — runtime session tracking

## Provider Lock

Three layers of Ollama enforcement:
1. **Startup**: `lockProviderToOllama()` scans all agent configs
2. **Session creation**: `delegate_task` validates model before spawning
3. **Runtime**: `chat.params` hook intercepts every LLM call
