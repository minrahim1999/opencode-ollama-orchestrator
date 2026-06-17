# Agent Reference

## Agent Hierarchy

```
Strategist (PRIMARY)
├── Architect (subagent)
├── Engineer (subagent) × up to 3 parallel
├── Auditor (subagent) — conditional
└── Specialist (subagent) — on-demand
```

Only **Strategist** is primary. All others are subagents. The Strategist orchestrates; subagents execute.

---

## Strategist

**Mode:** `primary` (hard-coded, cannot be overridden)

**Role:** Mission detection, pipeline orchestration, user communication, phase gate management.

**When it runs:**
- On every user message (heuristic detection)
- Between phases when a gate completes
- After all tasks finish for final summary
- When Specialist reports diagnosis results

**What it does:**
1. Reads user message → assesses if mission request
2. If vague/missing details → asks 1-2 clarification questions, **waits** for answer
3. Once clear → auto-creates mission, commissions Architect
4. Waits for plan files
5. Reads todos, dispatches Engineers (up to 3 parallel)
6. On critical-path completion → spawns Auditor
7. On `phase-gate: yes` completion → **pauses**, asks user for continuation
8. On "yes" → calls `MissionController.resume()`
9. On "no" → stays in HOLD, summarizes progress
10. On stuck detection → spawns Specialist
11. All done → `MISSION_COMPLETE` summary

**Prompt highlights:**
- "There are NO slash commands"
- "You do not take commands. You observe user messages, decide if a mission is needed"
- "If VAGUE or MISSING DETAILS → ask 1-2 concise clarification questions"
- "When Engineer completes a task with phase-gate: yes → PAUSE mission, present gate message to user"
- "On 'yes' → call MissionController.resume(). On 'no' → remain in HOLD, log to DOX"

**DOX compliance:**
- Reads `.opencode/DOX/{slug}.md` for historical context on long missions
- After mission completion, summary appended to `.opencode/AGENTS.md`

---

## Architect

**Mode:** `subagent`

**Role:** Plan decomposition, todo generation, phase structuring.

**When it runs:**
- Once per mission, commissioned by Strategist
- Re-commissioned by Specialist if replanning needed

**What it does:**
1. Reads mission description from Strategist
2. Decomposes into logical phases with `## Phase N: Name` headers
3. Writes plan to `.opencode/plans/{slug}/plan.md`
4. Writes todos to `.opencode/todo/{slug}.md`
5. Signals completion — **never executes code**

**Plan structure:**
```markdown
# Mission: {title}
## Overview
Brief summary.

## Phases
### Phase 1: Setup
- OBJECTIVE: What must be true after this phase
- FILES: Expected files
- RISKS: What could go wrong

### Phase 2: Core Feature
...

## Task Registry
TASK-001: description
TASK-002: description

## Rollback Strategy
If critical tasks fail, what can be safely undone?
```

**Todo format:**
```markdown
## Phase 1: Setup
- [ ] TASK-001: Description (@engineer, critical-path: yes, phase-gate: yes)
  - Acceptance: Verifiable condition
  - Depends: []
```

**Phase gate rules in prompt:**
- "Use phase-gate: yes on the LAST task of each phase"
- "If phase-gate: yes is present, the Strategist WILL pause after that task"
- "By default, ALL multi-phase plans MUST include at least one phase-gate: yes"
- "If the plan has only ONE phase, it runs fully automatically without gates"

---

## Engineer

**Mode:** `subagent`

**Role:** Code implementation, file creation/modification.

**When it runs:**
- Dispatched by MissionController for each pending todo
- Up to 3 Engineers run in parallel

**What it does:**
1. Receives task prompt with description, acceptance criteria, file paths
2. Implements the task (writes/edits code)
3. Updates todo status to completed with evidence
4. Signals completion

**Task prompt includes:**
- Task description
- Acceptance criteria
- Current phase name
- Retry count and max retries
- Whether approval is required
- Subagent depth limit
- Names of Specialist and Auditor (for escalation)

**Token efficiency rules:**
- "Avoid verbose comments — self-documenting code preferred"
- "Do not re-write entire files for small changes"
- "Use targeted edits, not wholesale replacement"
- "Prefer standard libraries over custom implementations"
- "Write minimal but complete tests"

**BLOCKED protocol:**
If Engineer cannot proceed:
```
BLOCKED: {reason}
EVIDENCE: {what was tried}
REQUIRED: {what is needed to unblock}
```
This triggers Specialist automatically.

---

## Auditor

**Mode:** `subagent`

**Role:** Verification of critical-path tasks only.

**When it runs:**
- After each `critical-path: yes` task completes
- **Not** run for non-critical tasks (token efficiency)

**What it does:**
1. Reads acceptance criteria from completed task
2. Runs tests, checks for regressions
3. Verifies all criteria are met
4. Reports PASS, PARTIAL, or FAIL

**Decision logic:**
- **PASS** → All criteria met, no regressions → signal to Strategist → continue
- **PARTIAL** → Mostly met, minor issues → list required fixes → Engineer retries
- **FAIL** → Criteria not met, regressions found, or security issue → **halt critical path**, trigger Specialist

**Only fires for critical-path tasks** — saves ~60% of verification overhead on typical missions.

---

## Specialist

**Mode:** `subagent`

**Role:** Diagnosis and recovery when missions get stuck.

**When it runs:**
- Task timeout > 10 minutes
- Same error repeats ≥ 3 times
- Circular dependency detected
- All tasks failed
- No progress for > 10 minutes
- Ollama queue/resource exhaustion

**What it does:**
1. Receives stuck context: task history, error logs, retry counts
2. Reads `.opencode/DOX/{slug}.md` for historical failures
3. Categorizes the stuck reason:
   - **Timeout**: Worker unresponsive, suggests shorter task chunks
   - **Retry loop**: Same error repeating, suggests different approach
   - **Circular dependencies**: Task A → B → A, suggests restructuring
   - **All failed**: Systemic issue, suggests simplified scope
   - **Stalled**: No progress, suggests throttling or queue check
   - **Resource exhausted**: Ollama overloaded, suggests waiting
4. Recommends resolution strategy:
   - `RETRY_WITH_CHANGES` → adjust approach, retry
   - `REPLAN` → call Architect to rewrite remaining phases
   - `SIMPLIFY` → reduce scope, break into smaller chunks
   - `MANUAL` → escalate to user for human decision

**Output format:**
```
DIAGNOSIS: {category}
ROOT_CAUSE: {explanation}
RECOMMENDATION: {strategy}
REQUIRED_ACTION: {specific steps}
CONFIDENCE: high|medium|low
```

**Boundaries:**
- NEVER calls or relies on built-in OpenCode agents
- Focuses only on the orchestrator's subagents and mission state
- References DOX run logs for context on repeated failures

---

## Built-in OpenCode Agents (NOT Our Agents)

OpenCode has its own built-in subagents that operate **independently**:

| Built-in | Purpose | Our Policy |
|----------|---------|------------|
| `compaction` | Truncates chat history when context fills | State stored on disk; re-read after compaction |
| `explorer` | File system exploration | Our Engineer handles implementation |
| `worker` | Generic task execution | Our Engineer is specialized |
| `executor` | Command execution | Our Engineer with bash permission |
| `debugger` | Debug assistance | Our Specialist handles diagnosis |

**Isolation enforced by:**
1. Config handler auto-renames colliding user-defined agents
2. Every agent prompt: "NEVER interact with built-in OpenCode agents"
3. Architect naming rule: tasks must not be named after built-ins
