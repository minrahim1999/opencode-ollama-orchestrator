/**
 * MissionController - async state machine for fully automatic multi-agent missions.
 *
 * States:
 *   IDLE -> PLANNING -> PENDING_DEPENDENCIES -> EXECUTING -> AUDITING -> COMPLETED|FAILED|RETRYING
 *
 * No human intervention required. Transitions driven by file-system events (todos.md changes)
 * and session completion polling.
 */
import type { EventHandlerDeps } from "./types.js";
import { loadOrchestratorConfig, resolveAgentAlias } from "../utils/constants.js";
import { ensureProjectDirs, getMissionDirectory, slugify } from "../utils/paths.js";
import { parseTodos, updateTodoStatus, exportTodosJson, type ParsedTodo } from "../utils/todo-parser.js";
import { writeFileSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import {
  isDoxInitialized,
  doxInit,
  writeDoxRunHeader,
  appendDoxLog,
  doxCloseout,
  doxCheck,
  type DoxEnv,
} from "../utils/dox.js";

interface MissionCtx {
  missionId: string;
  slug: string;
  description: string;
  missionDir: string;
  state: MissionState;
  todos: ParsedTodo[];
  retryCounts: Map<string, number>;
  completedAt?: number;
}

type MissionState =
  | "idle"
  | "planning"
  | "pending_dependencies"
  | "executing"
  | "auditing"
  | "completed"
  | "failed"
  | "retrying"
  | "hold";

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 300; // 10 minutes

function parseMissionTimestamp(missionId: string): number {
  if (!missionId) return Date.now();
  const parts = missionId.split("-");
  if (parts.length < 2) return Date.now();
  const ts = parseInt(parts[parts.length - 1], 10);
  return Number.isFinite(ts) ? ts : Date.now();
}

export class MissionController {
  private deps: EventHandlerDeps;
  private missions = new Map<string, MissionCtx>();
  private active = false;

  constructor(deps: EventHandlerDeps) {
    this.deps = deps;
  }

  /**
   * Start a fully automatic mission.
   * If auto=true, runs through all states without further human input.
   */
  async start(description: string, auto = false): Promise<void> {
    const cfg = loadOrchestratorConfig(this.deps.directory);
    const names = cfg.names;
    const slug = slugify(description);
    const dirs = ensureProjectDirs(this.deps.directory);
    const missionDir = getMissionDirectory(this.deps.directory, slug);

    const missionId = `mission-${Date.now()}`;
    const ctx: MissionCtx = {
      missionId,
      slug,
      description,
      missionDir,
      state: "idle",
      todos: [],
      retryCounts: new Map(),
    };

    this.missions.set(missionId, ctx);
    this.emit(ctx, "Mission started", auto);

    // ---- DOX INIT ----
    if (cfg.doxAutoInit) {
      const doxOk = isDoxInitialized(this.deps.directory);
      const { runFile } = doxInit(this.deps.directory, slug);
      if (!doxOk) {
        this.emit(ctx, "DOX workspace initialized", auto);
      }
      const doxCheckResult = doxCheck(this.deps.directory);
      if (!doxCheckResult.ok) {
        this.emit(ctx, `DOX check: missing ${doxCheckResult.missing.join(", ")}`, auto);
      }
      // Seed the DOX run header
      writeDoxRunHeader({
        projectDir: this.deps.directory,
        slug,
        missionId,
        description,
        startedAt: Date.now(),
        status: "in_progress",
        todos: [],
        modelsUsed: [],
        filesTouched: [],
      });
      this.emit(ctx, `DOX run seeded: ${runFile}`, auto);
    }

    // ---- PLANNING ----
    ctx.state = "planning";
    this.emit(ctx, `Commissioning ${names.architect}...`, auto);

    const archSession = await this.createSession(names.architect, `Plan: ${slug}`);

    await this.promptSession(archSession.id, names.architect, [
      `Create a detailed plan for: ${description}`,
      "",
      `Write the plan to ${missionDir}/plan.md`,
      `Write the todos to ${this.deps.directory}/.opencode/todo/${slug}.md`,
      "",
      "Plan format:",
      "## Phase 1: \u003cName\u003e",
      "- Objective: ...",
      "- Deliverable: ...",
      "- Estimation: ...",
      "",
      "Todo format:",
      "## Phase 1",
      "- [ ] TASK-001: Description (@engineer, critical-path: yes/no)",
      "  - Acceptance: verifiable condition",
      "  - Depends: []",
      "",
      `Constraints: maxWorkers=${cfg.maxParallelWorkers}, maxRetries=${cfg.maxRetries}, maxDepth=${cfg.maxSubagentDepth}`,
    ].join("\n"));

    if (auto) {
      await this.pollForFile(`${this.deps.directory}/.opencode/todo/${slug}.md`);
    } else {
      this.emit(ctx, `Plan created. Run /auto or /status to continue.`, auto);
      return;
    }

    // ---- PARSING ----
    ctx.todos = parseTodos(this.deps.directory);
    // Filter to this mission's todos if stored in separate file
    const missionTodos = this.loadMissionTodos(slug);
    if (missionTodos.length > 0) ctx.todos = missionTodos;

    exportTodosJson(this.deps.directory, ctx.todos);
    this.saveMissionState(ctx);

    if (ctx.todos.length === 0) {
      ctx.state = "failed";
      this.emit(ctx, "No todos found after planning", auto);
      return;
    }

    // ---- EXECUTION ----
    ctx.state = "executing";
    this.emit(ctx, `Executing ${ctx.todos.length} tasks...`, auto);

    await this.executeTodos(ctx, cfg, names, auto);

    // ---- FINAL ----
    if ((ctx.state as MissionState) !== "failed") {
      ctx.state = "completed";
      ctx.completedAt = Date.now();
      this.emit(ctx, `✅ MISSION_COMPLETE ${ctx.completedAt - parseMissionTimestamp(ctx.missionId)}ms`, auto);
    }

    // ---- DOX CLOSEOUT ----
    if (cfg.doxAutoCloseout) {
      doxCloseout({
        projectDir: this.deps.directory,
        slug,
        missionId,
        description,
        startedAt: parseMissionTimestamp(missionId),
        endedAt: Date.now(),
        status: ctx.state === "completed" ? "completed" : "failed",
        todos: ctx.todos.map((t) => ({ id: t.id, description: t.description, status: t.status })),
        modelsUsed: [],
        filesTouched: [],
      });
      this.emit(ctx, `DOX run archived: .opencode/DOX/${slug}.md`, auto);
    }

    this.saveMissionState(ctx);
    this.missions.delete(missionId);
  }

  /**
   * Resume a paused mission (called by /auto command).
   */
  async resume(): Promise<void> {
    const active = Array.from(this.missions.values()).filter(
      (ctx) => ctx.state === "pending_dependencies" || ctx.state === "executing" || ctx.state === "retrying" || ctx.state === "hold"
    );
    for (const ctx of active) {
      const cfg = loadOrchestratorConfig(this.deps.directory);
      const names = cfg.names;
      await this.executeTodos(ctx, cfg, names, true);

      // Finalize
      if (ctx.state !== "failed") {
        ctx.state = "completed";
        ctx.completedAt = Date.now();
        this.emit(ctx, `✅ MISSION_RESUMED_COMPLETE ${ctx.completedAt - parseMissionTimestamp(ctx.missionId)}ms`, true);
      }

      // DOX closeout
      if (cfg.doxAutoCloseout) {
        doxCloseout({
          projectDir: this.deps.directory,
          slug: ctx.slug,
          missionId: ctx.missionId,
          description: ctx.description,
          startedAt: parseMissionTimestamp(ctx.missionId),
          endedAt: Date.now(),
          status: ctx.state === "completed" ? "completed" : "failed",
          todos: ctx.todos.map((t) => ({ id: t.id, description: t.description, status: t.status })),
          modelsUsed: [],
          filesTouched: [],
        });
        this.emit(ctx, `DOX run archived: .opencode/DOX/${ctx.slug}.md`, true);
      }

      this.saveMissionState(ctx);
      this.missions.delete(ctx.missionId);
      return;
    }
    console.error("[opencode-orchestrator] No resumable mission found.");
  }

  /** Abort all active missions */
  abort(): void {
    for (const [, ctx] of Array.from(this.missions.entries())) {
      ctx.state = "failed";
      this.saveMissionState(ctx); // Persist aborted state
    }
    this.active = false;
    const arr = Array.from(this.deps.sessions.entries());
    for (const [sid, state] of arr) {
      if (state.active) {
        this.deps.sessions.set(sid, { ...state, active: false });
      }
    }
  }

  /** Get current mission status summary */
  status(): string {
    const lines: string[] = [];
    for (const ctx of Array.from(this.missions.values())) {
      const pending = ctx.todos.filter((t) => t.status === "pending").length;
      const done = ctx.todos.filter((t) => t.status === "completed").length;
      const failed = ctx.todos.filter((t) => t.status === "failed").length;
      lines.push(`${ctx.slug}: ${ctx.state} | ${done}/${ctx.todos.length} done | ${failed} failed`);
    }
    return lines.join("\n") || "No active missions.";
  }

  /* ─── Private helpers ─── */

  private async executeTodos(ctx: MissionCtx, cfg: ReturnType<typeof loadOrchestratorConfig>, names: ReturnType<typeof loadOrchestratorConfig>["names"], auto: boolean) {
    let index = 0;
    let currentPhase = "";
    while (index < ctx.todos.length) {
      const todo = ctx.todos[index];
      if (todo.status === "completed") { index++; continue; }

      // Check dependencies
      const depsMet = todo.dependsOn.every((depId) => {
        const dep = ctx.todos.find((t) => t.id === depId);
        return dep?.status === "completed";
      });
      if (!depsMet) {
        ctx.state = "pending_dependencies";
        this.emit(ctx, `${todo.id} deferred (waiting dependencies)`, auto);
        index++;
        continue;
      }

      // ---- PHASE GATE ----
      // Track phase transitions. If entering a new phase, check if previous phase had a gate.
      if (todo.phase && todo.phase !== currentPhase) {
        // If previous phase had a gate task, verify it's completed before proceeding
        if (currentPhase) {
          const prevPhaseGate = ctx.todos.find((t) =>
            t.phase === currentPhase && t.phaseGate
          );
          if (prevPhaseGate && prevPhaseGate.status !== "completed") {
            // Gate not completed — hold mission
            ctx.state = "hold";
            const msg = `⛔ PHASE_GATE: Phase "${currentPhase}" gate task ${prevPhaseGate.id} not complete. Complete it before proceeding to "${todo.phase}".`;
            this.emit(ctx, msg, auto);
            const gatePath = join(ctx.missionDir, "gate-message.txt");
            writeFileSync(gatePath, msg, "utf-8");
            this.saveMissionState(ctx);
            return;
          }
          // If gate exists and IS completed, still pause for user confirmation
          if (prevPhaseGate && prevPhaseGate.status === "completed") {
            ctx.state = "hold";
            const msg = `⛔ PHASE_GATE: Phase "${currentPhase}" is complete. Next: "${todo.phase}". Reply "yes" to continue or "no" to hold.`;
            this.emit(ctx, msg, auto);
            const gatePath = join(ctx.missionDir, "gate-message.txt");
            writeFileSync(gatePath, msg, "utf-8");
            this.saveMissionState(ctx);
            return;
          }
        }
        currentPhase = todo.phase;
      }

      // ---- NORMAL EXECUTION ----
      ctx.state = "executing";
      const resolvedAgent = resolveAgentAlias(todo.agent, names);
      this.emit(ctx, `Delegating ${todo.id} to ${resolvedAgent}`, auto);

      try {
        const session = await this.createSession(resolvedAgent, `${todo.id}: ${todo.description.slice(0, 40)}`);
        await this.promptSession(session.id, resolvedAgent, this.buildTaskPrompt(todo, cfg, names));

        if (auto) {
          await this.pollSession(session.id);
        }

        if (todo.criticalPath) {
          ctx.state = "auditing";
          const auditPassed = await this.runAudit(todo, names.auditor, ctx);
          if (!auditPassed) {
            // Audit failed — mark task failed and trigger retry logic
            updateTodoStatus(this.deps.directory, todo.id, "failed", "Audit failed — acceptance criteria not met");
            ctx.todos[index] = { ...todo, status: "failed" };
            this.emit(ctx, `${todo.id} audit FAILED`, auto);
            // Trigger retry if retries remain
            const retries = ctx.retryCounts.get(todo.id) ?? 0;
            if (retries < cfg.maxRetries) {
              ctx.retryCounts.set(todo.id, retries + 1);
              ctx.state = "retrying";
              this.emit(ctx, `${todo.id} retrying after failed audit (attempt ${retries + 1})`, auto);
              await sleep(1000 * Math.pow(2, retries));
              continue;
            }
          }
        }

        updateTodoStatus(this.deps.directory, todo.id, "completed", `Done by ${resolvedAgent}`);
        ctx.todos[index] = { ...todo, status: "completed" };
        this.emit(ctx, `${todo.id} completed`, auto);

        // ---- PHASE GATE HANDLING (if this task IS the gate) ----
        if (todo.phaseGate) {
          ctx.state = "hold";
          this.emit(ctx, `⛔ PHASE_GATE: Phase "${todo.phase}" is complete. Reply "yes" to continue to the next phase or "no" to hold.`, auto);
          this.saveMissionState(ctx);
          return; // EXIT executeTodos, mission controller pauses
        }
      } catch (err) {
        const retries = ctx.retryCounts.get(todo.id) ?? 0;
        if (retries < cfg.maxRetries) {
          ctx.retryCounts.set(todo.id, retries + 1);
          ctx.state = "retrying";
          this.emit(ctx, `${todo.id} failed (attempt ${retries + 1}), retrying...`, auto);
          await sleep(1000 * Math.pow(2, retries));
          continue; // Retry same task
        } else {
          updateTodoStatus(this.deps.directory, todo.id, "failed", String(err));
          ctx.todos[index] = { ...todo, status: "failed" };
          this.emit(ctx, `${todo.id} failed permanently`, auto);
        }
      }

      index++;
      this.saveMissionState(ctx);
    }

    const allFailed = ctx.todos.every((t) => {
      if (t.status === "failed") return true;
      // Check if all dependencies of this pending task have failed
      if (t.status === "pending") {
        return t.dependsOn.length > 0 && t.dependsOn.every((depId) => {
          const dep = ctx.todos.find((dt) => dt.id === depId);
          return dep?.status === "failed";
        });
      }
      return false;
    });
    if (allFailed) ctx.state = "failed";
  }

  private async runAudit(todo: ParsedTodo, auditorName: string, ctx: MissionCtx): Promise<boolean> {
    const auditResultPath = join(ctx.missionDir, `audit-${todo.id}.json`);
    
    const session = await this.createSession(auditorName, `Audit: ${todo.id}`);
    await this.promptSession(session.id, auditorName, [
      `Audit task: ${todo.id}`,
      todo.description,
      "",
      "Acceptance Criteria:",
      ...todo.acceptanceCriteria.map((c) => `  - ${c}`),
      "",
      "Verify all criteria. Run tests. Check for regressions.",
      "",
      "After your analysis, write a JSON file with your verdict:",
      `File: ${auditResultPath}`,
      'Format: { "passed": true|false, "issues": ["..."], "recommendation": "retry|pass|escalate" }',
      "If passed=true, the task proceeds. If passed=false, the task fails and may be retried.",
    ].join("\n"));

    await this.pollSession(session.id);

    // Check if auditor wrote the result file
    try {
      if (existsSync(auditResultPath)) {
        const raw = readFileSync(auditResultPath, "utf-8");
        const result = JSON.parse(raw);
        if (result.passed === true) {
          return true;
        }
        console.error(`[opencode-orchestrator] Audit ${todo.id} FAILED:`, result.issues?.join("; ") || "No details");
        return false;
      }
    } catch {
      // Auditor didn't write result file — check last message for explicit pass/fail
    }

    // Fallback: attempt to read last message from session
    try {
      const client = this.deps.client;
      if (client?.v2?.session?.messages) {
        const msgs = await client.v2.session.messages({
          path: { id: session.id },
          query: { directory: this.deps.directory, limit: 5 },
        });
        const data = msgs.data as Array<{ info?: { text?: string }; parts?: Array<{ text?: string }> }> | undefined;
        if (data) {
          const lastMsg = data[data.length - 1];
          const text = lastMsg?.info?.text || lastMsg?.parts?.map((p) => p.text).join(" ") || "";
          if (/\bPASS\b/i.test(text) || /\bpassed\b/i.test(text)) return true;
          if (/\bFAIL\b/i.test(text) || /\bfailed\b/i.test(text)) return false;
        }
      }
    } catch {
      // Cannot read messages — be permissive (don't block on audit infra issues)
    }

    // Default permissive: if we can't determine, let it through
    console.error(`[opencode-orchestrator] Audit ${todo.id}: no explicit result found, defaulting to pass.`);
    return true;
  }

  private buildTaskPrompt(
    todo: ParsedTodo,
    cfg: Pick<ReturnType<typeof loadOrchestratorConfig>, "maxRetries" | "requireApproval" | "maxSubagentDepth">,
    names: { specialist: string; auditor: string }
  ): string {
    return [
      `Task: ${todo.id}`,
      `Description: ${todo.description}`,
      `Critical Path: ${todo.criticalPath ? "YES" : "NO"}`,
      "",
      "Acceptance Criteria:",
      ...todo.acceptanceCriteria.map((c) => `  - ${c}`),
      "",
      `Rules: maxRetries=${cfg.maxRetries}, approval=${cfg.requireApproval}, depth=${cfg.maxSubagentDepth}`,
      `Escalate to ${names.specialist} for deep issues. ${names.auditor} audits critical items.`,
      "",
      "After completion, update todos and provide evidence.",
    ].join("\n");
  }

  private async createSession(agent: string, title: string): Promise<{ id: string }> {
    const session = await this.deps.client.v2.session.create({
      directory: this.deps.directory,
      title,
    });
    // Track session for polling lifecycle
    if (session.id) {
      this.deps.sessions.set(session.id, { active: true, step: 1 });
    }
    return session;
  }

  private async promptSession(sessionID: string, agent: string, text: string): Promise<void> {
    await this.deps.client.v2.session.prompt({
      sessionID: sessionID,
      directory: this.deps.directory,
      agent,
      parts: [{ type: "text", text }],
    });
  }

  private async pollSession(sessionId: string): Promise<void> {
    // Try SDK session.status API first (most reliable)
    try {
      const client = this.deps.client;
      if (client?.v2?.session?.status) {
        for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
          await sleep(POLL_INTERVAL_MS);
          const result = await client.v2.session.status({
            query: { directory: this.deps.directory },
          });
          const statuses = result.data as Record<string, { status?: string }> | undefined;
          if (statuses && statuses[sessionId]) {
            const st = statuses[sessionId].status ?? "";
            if (st === "completed" || st === "failed" || st === "error") {
              // Mark as inactive in our map too
              const local = this.deps.sessions.get(sessionId);
              if (local) this.deps.sessions.set(sessionId, { ...local, active: false });
              return;
            }
          }
        }
      }
    } catch {
      // SDK status API unavailable — fall through to local map polling
    }

    // Fallback: poll local session map (works if external code updates it)
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await sleep(POLL_INTERVAL_MS);
      const state = this.deps.sessions.get(sessionId);
      if (!state || !state.active) return;
    }
    console.error(`[opencode-orchestrator] Session ${sessionId} poll timeout.`);
  }

  private async pollForFile(filePath: string): Promise<void> {
    for (let i = 0; i < 150; i++) {
      if (existsSync(filePath)) return;
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`Timeout waiting for file: ${filePath}`);
  }

  private loadMissionTodos(slug: string): ParsedTodo[] {
    const path = join(this.deps.directory, ".opencode", "todo", `${slug}.md`);
    if (!existsSync(path)) return [];
    // Parse from mission-specific todo file
    const content = readFileSync(path, "utf-8");
    // Reuse parseTodos logic but from a specific path
    // For simplicity, copy file to temp and call parseTodos, or inline
    // Here we do a quick inline parse
    const lines = content.split("\n");
    const todos: ParsedTodo[] = [];
    let current: Partial<ParsedTodo> | null = null;
    let currentPhase = "";
    for (const line of lines) {
      const trimmed = line.trim();
      const phaseMatch = trimmed.match(/^## Phase \d+:\s*(.+)/i);
      if (phaseMatch) {
        currentPhase = phaseMatch[1].trim();
        continue;
      }
      const todoMatch = trimmed.match(/^- \[( |x)\] (TASK-\d+): (.+?)\s*\(@(\w+)\s*(.*?)\)/i);
      if (todoMatch) {
        if (current) todos.push(current as ParsedTodo);
        const metaStr = todoMatch[5];
        current = {
          status: todoMatch[1] === "x" ? "completed" : "pending",
          id: todoMatch[2],
          description: todoMatch[3].trim(),
          agent: todoMatch[4],
          criticalPath: /critical-path:\s*yes/i.test(metaStr),
          phaseGate: /phase-gate:\s*yes/i.test(metaStr),
          dependsOn: [],
          acceptanceCriteria: [],
          phase: currentPhase,
        };
        continue;
      }
      const acceptMatch = trimmed.match(/^-?\s*Acceptance:\s*(.+)/i);
      if (acceptMatch && current) {
        current.acceptanceCriteria = (current.acceptanceCriteria || []).concat(acceptMatch[1].trim());
      }
      const dependsMatch = trimmed.match(/^-?\s*Depends:\s*\[(.*?)\]/i);
      if (dependsMatch && current) {
        current.dependsOn = dependsMatch[1].split(/,\s*/).map((s) => s.trim()).filter(Boolean);
      }
    }
    if (current) todos.push(current as ParsedTodo);
    return todos;
  }

  private saveMissionState(ctx: MissionCtx) {
    const path = join(ctx.missionDir, "state.json");
    const tmpPath = `${path}.tmp`;
    const data = JSON.stringify({
      missionId: ctx.missionId,
      slug: ctx.slug,
      description: ctx.description,
      state: ctx.state,
      todos: ctx.todos,
      completedAt: ctx.completedAt,
    }, null, 2);
    // Atomic write: write temp, then rename
    try {
      writeFileSync(tmpPath, data, "utf-8");
      renameSync(tmpPath, path);
    } catch (err) {
      console.error(`[opencode-orchestrator] Failed to save mission state:`, err);
    }
  }

  private emit(ctx: MissionCtx, message: string, auto: boolean) {
    const prefix = auto ? "[AUTO]" : "[MANUAL]";
    const fullMsg = `[opencode-orchestrator] ${prefix}[${ctx.slug}] ${message}`;
    console.error(fullMsg);

    // Toast notification (best-effort, never blocks mission)
    try {
      const client = this.deps.client;
      if (client?.tui?.showToast) {
        // Map message prefix to toast variant
        let variant: "info" | "success" | "warning" | "error" = "info";
        if (message.includes("✅") || message.includes("completed") || message.includes("COMPLETE")) {
          variant = "success";
        } else if (message.includes("failed") || message.includes("FAIL") || message.includes("error")) {
          variant = "error";
        } else if (message.includes("retrying") || message.includes("stuck") || message.includes("timeout")) {
          variant = "warning";
        } else if (message.includes("⛔ PHASE_GATE")) {
          variant = "warning";
        }

        // Fire-and-forget toast
        client.tui.showToast({
          body: {
            title: ctx.slug,
            message: message.slice(0, 200), // truncate to avoid overflow
            variant,
            duration: variant === "error" || variant === "warning" ? 8000 : 5000,
          },
        }).catch(() => {
          // Silently ignore toast errors (TUI may not be running)
        });
      }
    } catch {
      // Toast is cosmetic — never block mission on notification failure
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
