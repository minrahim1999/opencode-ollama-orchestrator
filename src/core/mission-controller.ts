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
import { createBackup, revertBackup, deleteBackup } from "../utils/backup.js";
import { readFileSync, existsSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
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
  backup?: { type: "git_stash" | "git_commit" | "directory" | "none"; path?: string; commitHash?: string };
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

/** Load raw opencode.json to find agent model assignments */
function loadUserConfig(): Record<string, any> | null {
  const candidates = [
    join(homedir(), ".config", "opencode", "opencode.json"),
    join(homedir(), ".opencode", "opencode.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = readFileSync(p, "utf-8");
      return JSON.parse(raw);
    } catch {
      continue;
    }
  }
  return null;
}

/** Parse "ollama/kimi-k2.7-code" -> { providerID: "ollama", modelID: "kimi-k2.7-code" } */
function parseModel(modelStr: string): { providerID: string; modelID: string } | null {
  if (!modelStr || typeof modelStr !== "string") return null;
  const parts = modelStr.split("/");
  if (parts.length >= 2) {
    return { providerID: parts[0], modelID: parts.slice(1).join("/") };
  }
  return null;
}

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

    const archSession = await this.createSession(names.architect, `Plan: ${slug}`, undefined, slug);

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
    ctx.todos = parseTodos(this.deps.directory, ctx.slug);
    // Filter to this mission's todos if stored in separate file
    const missionTodos = this.loadMissionTodos(slug);
    if (missionTodos.length > 0) ctx.todos = missionTodos;

    exportTodosJson(this.deps.directory, ctx.todos, ctx.slug);
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
      this.saveMissionState(ctx);
    }
    this.active = false;
    const arr = Array.from(this.deps.sessions.entries());
    for (const [sid, state] of arr) {
      if (state.active) {
        this.deps.sessions.set(sid, { ...state, active: false });
      }
    }
    console.error("[opencode-orchestrator] All missions aborted.");
  }

  /** Abort a specific mission by slug */
  abortMission(slug: string): boolean {
    for (const [, ctx] of Array.from(this.missions.entries())) {
      if (ctx.slug === slug) {
        ctx.state = "failed";
        this.saveMissionState(ctx);
        // Mark all sessions for this mission as inactive
        for (const [sid, sess] of Array.from(this.deps.sessions.entries())) {
          if (sess.missionSlug === slug) {
            this.deps.sessions.set(sid, { ...sess, active: false });
          }
        }
        console.error(`[opencode-orchestrator] Mission '${slug}' aborted.`);
        return true;
      }
    }
    return false;
  }

  /** Skip a specific task by ID */
  skipTask(missionSlug: string, taskId: string): boolean {
    for (const [, ctx] of Array.from(this.missions.entries())) {
      if (ctx.slug === missionSlug) {
        const idx = ctx.todos.findIndex((t) => t.id === taskId);
        if (idx >= 0) {
          ctx.todos[idx] = { ...ctx.todos[idx], status: "completed" };
          updateTodoStatus(this.deps.directory, taskId, "completed", "Skipped by user", ctx.slug);
          this.emit(ctx, `⏭️ ${taskId} skipped by user`, true);
          this.saveMissionState(ctx);
          return true;
        }
      }
    }
    return false;
  }

  /** Resume execution from a specific task ID (for manual intervention) */
  resumeFrom(missionSlug: string, taskId: string): boolean {
    for (const [, ctx] of Array.from(this.missions.entries())) {
      if (ctx.slug === missionSlug) {
        const cfg = loadOrchestratorConfig(this.deps.directory);
        const names = cfg.names;
        // Mark all prior tasks as completed
        let found = false;
        for (const todo of ctx.todos) {
          if (todo.id === taskId) {
            found = true;
            break;
          }
          if (todo.status === "pending") {
            todo.status = "completed";
            updateTodoStatus(this.deps.directory, todo.id, "completed", "Auto-completed by resumeFrom", ctx.slug);
          }
        }
        if (!found) {
          console.error(`[opencode-orchestrator] Task ${taskId} not found in mission ${missionSlug}`);
          return false;
        }
        this.emit(ctx, `▶️ Resuming from ${taskId}`, true);
        this.saveMissionState(ctx);
        // Auto-resume execution
        this.executeTodos(ctx, cfg, names, true).catch((err) => {
          console.error(`[opencode-orchestrator] resumeFrom execute error:`, err);
        });
        return true;
      }
    }
    return false;
  }

  /** Watchdog: detect stuck sessions and kill them */
  checkWatchdog(): void {
    const STUCK_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
    for (const [sid, sess] of Array.from(this.deps.sessions.entries())) {
      if (!sess.active) continue;
      const idle = Date.now() - sess.lastPromptAt;
      if (idle > STUCK_THRESHOLD_MS) {
        console.error(`[opencode-orchestrator] WATCHDOG: Session ${sid.slice(0, 8)}… (${sess.agent}) stuck for ${Math.round(idle / 60000)}min. Marking inactive.`);
        this.deps.sessions.set(sid, { ...sess, active: false });
      }
    }
  }

  /** Revert mission changes using the stored backup */
  revertMission(slug: string): boolean {
    for (const [, ctx] of Array.from(this.missions.entries())) {
      if (ctx.slug === slug) {
        if (!ctx.backup || ctx.backup.type === "none") {
          console.error(`[opencode-orchestrator] Mission ${slug} has no backup. Nothing to revert.`);
          return false;
        }
        ctx.state = "failed";
        this.saveMissionState(ctx);
        // Mark sessions inactive
        for (const [sid, sess] of Array.from(this.deps.sessions.entries())) {
          if (sess.missionSlug === slug) {
            this.deps.sessions.set(sid, { ...sess, active: false });
          }
        }
        const ok = revertBackup(this.deps.directory, ctx.backup);
        if (ok) {
          this.emit(ctx, `↩️ Mission ${slug} reverted to pre-mission state`, true);
          deleteBackup(ctx.backup);
        } else {
          this.emit(ctx, `❌ Mission ${slug} revert FAILED — manual intervention required`, true);
        }
        return ok;
      }
    }
    console.error(`[opencode-orchestrator] Mission ${slug} not found for revert.`);
    return false;
  }

  /** Get current mission status summary */
  status(): string {
    const lines: string[] = [];
    for (const ctx of Array.from(this.missions.values())) {
      const pending = ctx.todos.filter((t) => t.status === "pending").length;
      const inProgress = ctx.todos.filter((t) => t.status === "in_progress").length;
      const done = ctx.todos.filter((t) => t.status === "completed").length;
      const failed = ctx.todos.filter((t) => t.status === "failed").length;
      const elapsed = ctx.completedAt
        ? ctx.completedAt - parseMissionTimestamp(ctx.missionId)
        : Date.now() - parseMissionTimestamp(ctx.missionId);
      lines.push(
        `${ctx.slug}: ${ctx.state} | ${done}/${ctx.todos.length} done | ${failed} failed | ${pending} pending | ${inProgress} active | ${Math.round(elapsed / 1000)}s elapsed`
      );
    }
    return lines.join("\n") || "No active missions.";
  }

  /** Get session-level cost/usage summary */
  sessionSummary(): string[] {
    const lines: string[] = [];
    for (const [sid, sess] of Array.from(this.deps.sessions.entries())) {
      const age = Math.round((Date.now() - sess.createdAt) / 1000);
      lines.push(
        `${sid.slice(0, 8)}… | ${sess.agent} | ${sess.model} | ${sess.promptsSent} prompts | ${age}s old | ${sess.active ? "active" : "idle"}`
      );
    }
    return lines;
  }

  /* ─── Private helpers ─── */

  private async executeTodos(ctx: MissionCtx, cfg: ReturnType<typeof loadOrchestratorConfig>, names: ReturnType<typeof loadOrchestratorConfig>["names"], auto: boolean) {
    // Create backup before executing any tasks
    if (!ctx.backup) {
      const backup = createBackup(this.deps.directory, ctx.slug);
      ctx.backup = backup;
      this.emit(ctx, `💾 Backup created (${backup.type})`, auto);
    }

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
        const session = await this.createSession(resolvedAgent, `${todo.id}: ${todo.description.slice(0, 40)}`, todo.id, ctx.slug);
        await this.promptSession(session.id, resolvedAgent, this.buildTaskPrompt(todo, cfg, names, ctx.slug));

        if (auto) {
          await this.pollSession(session.id);
        }

        if (todo.criticalPath) {
          ctx.state = "auditing";
          const auditPassed = await this.runAudit(todo, names.auditor, ctx);
          if (!auditPassed) {
            // Audit failed — mark task failed and trigger retry logic
            updateTodoStatus(this.deps.directory, todo.id, "failed", "Audit failed — acceptance criteria not met", ctx.slug);
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

        updateTodoStatus(this.deps.directory, todo.id, "completed", `Done by ${resolvedAgent}`, ctx.slug);
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
          updateTodoStatus(this.deps.directory, todo.id, "failed", String(err), ctx.slug);
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
    
    const session = await this.createSession(auditorName, `Audit: ${todo.id}`, todo.id, ctx.slug);
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
          this.emit(ctx, `✅ AUDIT ${todo.id}: PASSED`, true);
          return true;
        }
        this.emit(ctx, `❌ AUDIT ${todo.id}: FAILED — ${result.issues?.join("; ") || "No details"}`, true);
        return false;
      }
    } catch (parseErr) {
      this.emit(ctx, `⚠️ AUDIT ${todo.id}: Invalid audit result JSON`, true);
    }

    // Fallback: attempt to read last message from session
    try {
      const client = this.deps.client;
      if (client?.v2?.session?.messages) {
        const msgs = await client.v2.session.messages({
          path: { id: session.id },
          query: { directory: this.deps.directory, limit: 5 },
        });
        const data = msgs.data as Array<Record<string, any>> | undefined;
        if (data) {
          const lastMsg = data[data.length - 1];
          const textParts = lastMsg?.parts as Array<{ text?: string }> | undefined;
          const text = lastMsg?.info?.text as string | undefined || textParts?.map((p: { text?: string }) => p.text).join(" ") || "";
          if (/\bPASS\b/i.test(text) || /\bpassed\b/i.test(text)) {
            this.emit(ctx, `✅ AUDIT ${todo.id}: PASSED (from message)`, true);
            return true;
          }
          if (/\bFAIL\b/i.test(text) || /\bfailed\b/i.test(text)) {
            this.emit(ctx, `❌ AUDIT ${todo.id}: FAILED (from message)`, true);
            return false;
          }
        }
      }
    } catch {
      // Cannot read messages — be permissive
    }

    // Default permissive: if we can't determine, let it through
    this.emit(ctx, `⚠️ AUDIT ${todo.id}: No explicit result found, defaulting to PASS`, true);
    return true;
  }

  private buildTaskPrompt(
    todo: ParsedTodo,
    cfg: Pick<ReturnType<typeof loadOrchestratorConfig>, "maxRetries" | "requireApproval" | "maxSubagentDepth">,
    names: { specialist: string; auditor: string },
    slug: string
  ): string {
    const todoPath = join(this.deps.directory, ".opencode", "todo", `${slug}.md`);
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
      `After completion, update the todo checkbox in ${todoPath} for task ${todo.id}.`,
      "You can also append an Evidence line below the task.",
    ].join("\n");
  }

  private async createSession(agent: string, title: string, taskId?: string, slug?: string): Promise<{ id: string }> {
    const userConfig = loadUserConfig();
    const agentConfig = userConfig?.agent?.[agent];
    let modelObj: { providerID: string; modelID: string } | null = null;
    let fallbackModelObj: { providerID: string; modelID: string } | null = null;

    // Resolve primary model
    if (agentConfig?.model) {
      modelObj = parseModel(agentConfig.model);
    }
    if (!modelObj && userConfig?.model) {
      modelObj = parseModel(userConfig.model);
    }
    // Resolve fallback model
    if (agentConfig?.fallbackModel) {
      fallbackModelObj = parseModel(agentConfig.fallbackModel);
    }
    if (!fallbackModelObj && userConfig?.fallbackModel) {
      fallbackModelObj = parseModel(userConfig.fallbackModel);
    }
    // If no explicit fallback but primary model exists, try global default as fallback
    if (!fallbackModelObj && agentConfig?.model && userConfig?.model) {
      const parsed = parseModel(userConfig.model);
      if (parsed && parsed.modelID !== modelObj?.modelID) {
        fallbackModelObj = parsed;
      }
    }

    let session: { id: string } | null = null;
    let lastError: Error | null = null;

    // Try primary model
    if (modelObj) {
      try {
        const opts: any = {
          directory: this.deps.directory,
          title,
          agent,
          model: modelObj,
        };
        console.error(`[opencode-orchestrator] createSession for ${agent} with model ${modelObj.providerID}/${modelObj.modelID}`);
        session = await this.deps.client.v2.session.create(opts);
      } catch (err) {
        lastError = err as Error;
        console.error(`[opencode-orchestrator] createSession primary model failed: ${(err as Error).message}`);
      }
    }

    // Try fallback if primary failed
    if (!session && fallbackModelObj) {
      try {
        const opts: any = {
          directory: this.deps.directory,
          title,
          agent,
          model: fallbackModelObj,
        };
        console.error(`[opencode-orchestrator] createSession for ${agent} with FALLBACK model ${fallbackModelObj.providerID}/${fallbackModelObj.modelID}`);
        session = await this.deps.client.v2.session.create(opts);
      } catch (err) {
        lastError = err as Error;
        console.error(`[opencode-orchestrator] createSession fallback model also failed: ${(err as Error).message}`);
      }
    }

    if (!session) {
      throw new Error(
        `[opencode-orchestrator] Failed to create session for ${agent}: ${lastError?.message ?? "unknown error"}. ` +
        `Primary: ${modelObj ? `${modelObj.providerID}/${modelObj.modelID}` : "none"}. ` +
        `Fallback: ${fallbackModelObj ? `${fallbackModelObj.providerID}/${fallbackModelObj.modelID}` : "none"}. ` +
        `Check model availability and provider connectivity.`
      );
    }

    // Track session with full info
    this.deps.sessions.set(session.id, {
      active: true,
      step: 1,
      agent,
      model: modelObj ? `${modelObj.providerID}/${modelObj.modelID}` : "default",
      createdAt: Date.now(),
      promptsSent: 0,
      lastPromptAt: Date.now(),
      taskId,
      missionSlug: slug,
    });
    return session;
  }

  private async promptSession(sessionID: string, agent: string, text: string): Promise<void> {
    const userConfig = loadUserConfig();
    const agentConfig = userConfig?.agent?.[agent];
    let modelObj: { providerID: string; modelID: string } | null = null;
    if (agentConfig?.model) {
      modelObj = parseModel(agentConfig.model);
    }
    if (!modelObj && userConfig?.model) {
      modelObj = parseModel(userConfig.model);
    }
    const promptOpts: any = {
      sessionID: sessionID,
      directory: this.deps.directory,
      agent,
      parts: [{ type: "text", text }],
    };
    if (modelObj) {
      promptOpts.model = modelObj;
      console.error(`[opencode-orchestrator] promptSession for ${agent} with model ${modelObj.providerID}/${modelObj.modelID}`);
    }
    await this.deps.client.v2.session.prompt(promptOpts);

    // Update session tracking
    const sess = this.deps.sessions.get(sessionID);
    if (sess) {
      sess.promptsSent++;
      sess.lastPromptAt = Date.now();
      this.deps.sessions.set(sessionID, sess);
    }
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
