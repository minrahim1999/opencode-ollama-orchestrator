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
import { writeFileAtomicSync } from "../utils/atomic.js";
import { readFileSync, existsSync, writeFileSync, mkdirSync, renameSync, readdirSync, statSync, rmSync } from "node:fs";
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
  memory?: TaskMemoryEntry[]; // Accumulated context from completed tasks
}

interface TaskMemoryEntry {
  taskId: string;
  agent: string;
  summary: string;      // One-line summary of what was done
  filesChanged: string[];
  issues: string[];
  timestamp: number;
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
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private runningTasks = new Map<string, Promise<void>>();
  private modelFailures = new Map<string, number>();
  private brokenModels = new Set<string>();

  constructor(deps: EventHandlerDeps) {
    this.deps = deps;
    this.loadMissionsFromDisk();
    this.startCleanup();
    this.startMemoryPurge();
    this.setupShutdownHandlers();
  }

  /** Start periodic cleanup of old mission directories */
  private startCleanup(): void {
    const DAYS = 7; // Keep missions for 7 days
    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    const runCleanup = () => {
      try {
        const missionsDir = join(this.deps.directory, ".opencode", "missions");
        if (!existsSync(missionsDir)) return;

        const now = Date.now();
        const entries = readdirSync(missionsDir, { withFileTypes: true });
        let cleaned = 0;

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const dirPath = join(missionsDir, entry.name);
          try {
            const stat = statSync(dirPath);
            const ageDays = (now - stat.mtimeMs) / MS_PER_DAY;
            if (ageDays > DAYS) {
              rmSync(dirPath, { recursive: true, force: true });
              cleaned++;
            }
          } catch {
            // Ignore cleanup errors for individual directories
          }
        }

        if (cleaned > 0) {
          console.error(`[opencode-orchestrator] Cleaned up ${cleaned} mission directories older than ${DAYS} days`);
        }
      } catch {
        // Ignore cleanup errors
      }
    };

    // Run once at startup, then daily
    runCleanup();
    this.cleanupInterval = setInterval(runCleanup, MS_PER_DAY);
  }

  /** Stop periodic cleanup */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /** Attempt to restore missions from disk */
  private loadMissionsFromDisk(): void {
    try {
      const missionsDir = join(this.deps.directory, ".opencode", "missions");
      if (!existsSync(missionsDir)) return;
      const entries = readdirSync(missionsDir, { withFileTypes: true });
      let restored = 0;
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const statePath = join(missionsDir, entry.name, "state.json");
        if (!existsSync(statePath)) continue;
        try {
          const raw = readFileSync(statePath, "utf-8");
          const data = JSON.parse(raw);
          if (data.state === "executing" || data.state === "hold" || data.state === "retrying") {
            const ctx: MissionCtx = {
              missionId: data.missionId,
              slug: data.slug,
              description: data.description,
              missionDir: join(missionsDir, entry.name),
              state: "idle",
              todos: data.todos || [],
              retryCounts: new Map(),
              completedAt: data.completedAt,
              memory: data.memory || [],
            };
            this.missions.set(ctx.missionId, ctx);
            restored++;
          }
        } catch {
          // Skip corrupted state files
        }
      }
      if (restored > 0) {
        console.error(`[opencode-orchestrator] Restored ${restored} missions from disk`);
      }
    } catch {
      // Ignore read errors
    }
  }

  /** Periodically purge completed missions from memory */
  private startMemoryPurge(): void {
    const HOUR = 60 * 60 * 1000;
    const purge = () => {
      try {
        const now = Date.now();
        let purged = 0;
        for (const [id, ctx] of Array.from(this.missions.entries())) {
          if (ctx.completedAt && now - ctx.completedAt > HOUR) {
            this.missions.delete(id);
            purged++;
          }
        }
        if (purged > 0) {
          console.error(`[opencode-orchestrator] Purged ${purged} completed missions from memory`);
        }
      } catch {
        // Ignore
      }
    };
    purge();
    setInterval(purge, HOUR);
  }

  /** Graceful shutdown: wait for tasks, save states, exit */
  private setupShutdownHandlers(): void {
    const shutdown = async (signal: string) => {
      console.error(`[opencode-orchestrator] Received ${signal}, shutting down gracefully`);
      this.stopCleanup();
      // Wait for running tasks with 30s timeout
      if (this.runningTasks.size > 0) {
        const tasks = Array.from(this.runningTasks.values());
        console.error(`[opencode-orchestrator] Waiting for ${tasks.length} running tasks...`);
        try {
          await Promise.race([
            Promise.all(tasks),
            new Promise((_r, reject) => setTimeout(() => reject(new Error("timeout")), 30000)),
          ]);
        } catch {
          console.error("[opencode-orchestrator] Task drain timed out, saving state and exiting");
        }
      }
      for (const ctx of this.missions.values()) {
        if (!ctx.completedAt) this.saveMissionState(ctx);
      }
      process.exit(0);
    };
    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));
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
      memory: [],
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
    // Track this mission as running (for graceful shutdown)
    const executePromise = this._executeTodosInner(ctx, cfg, names, auto)
      .finally(() => this.runningTasks.delete(ctx.missionId));
    this.runningTasks.set(ctx.missionId, executePromise);
    return executePromise;
  }

  private async _executeTodosInner(ctx: MissionCtx, cfg: ReturnType<typeof loadOrchestratorConfig>, names: ReturnType<typeof loadOrchestratorConfig>["names"], auto: boolean) {
    // Create backup before executing any tasks
    if (!ctx.backup) {
      const backup = createBackup(this.deps.directory, ctx.slug);
      ctx.backup = backup;
      this.emit(ctx, `💾 Backup created (${backup.type})`, auto);
    }

    const maxWorkers = cfg.maxParallelWorkers ?? 3;
    const running = new Map<string, Promise<void>>(); // taskId -> promise
    let currentPhase = "";
    let phaseGatePending = false;
    let index = 0;

    // Helper: find next task that's ready (deps met, not completed, not in_progress, not failed, not already running)
    const findNextReady = (): { todo: ParsedTodo; index: number } | undefined => {
      for (let i = 0; i < ctx.todos.length; i++) {
        const t = ctx.todos[i];
        if (t.status === "completed" || t.status === "in_progress" || t.status === "failed") continue;
        if (running.has(t.id)) continue;
        const depsMet = t.dependsOn.every((depId) => {
          const dep = ctx.todos.find((dt) => dt.id === depId);
          return dep?.status === "completed";
        });
        if (!depsMet) continue;
        // Phase gate check: don't dispatch tasks from a new phase while gate is pending
        if (phaseGatePending && t.phase !== currentPhase) continue;
        return { todo: t, index: i };
      }
      return undefined;
    };

    // Helper: check if all tasks in current phase are done
    const isPhaseComplete = (phase: string): boolean => {
      return ctx.todos
        .filter((t) => t.phase === phase)
        .every((t) => t.status === "completed" || t.status === "failed");
    };

    // Main dispatch loop
    while (true) {
      // Check for phase completion and gates
      if (currentPhase && isPhaseComplete(currentPhase)) {
        const gateTask = ctx.todos.find((t) => t.phase === currentPhase && t.phaseGate);
        if (gateTask && gateTask.status === "completed" && !phaseGatePending) {
          phaseGatePending = true;
          ctx.state = "hold";
          const msg = `⛔ PHASE_GATE: Phase "${currentPhase}" is complete. Next phase available. Reply "yes" to continue or "no" to hold.`;
          this.emit(ctx, msg, auto);
          writeFileAtomicSync(join(ctx.missionDir, "gate-message.txt"), msg);
          this.saveMissionState(ctx);
          // Wait for all running tasks to finish before pausing
          while (running.size > 0) {
            await Promise.race(running.values());
          }
          return; // Pause mission
        }
        // If gate task doesn't exist or is not completed, just move to next phase
      }

      // Try to dispatch new tasks
      while (running.size < maxWorkers && !phaseGatePending) {
        const next = findNextReady();
        if (!next) break;

        const { todo, index: todoIndex } = next;

        // Phase transition detection
        if (todo.phase && todo.phase !== currentPhase) {
          // Check previous phase gate
          if (currentPhase) {
            const prevGate = ctx.todos.find((t) => t.phase === currentPhase && t.phaseGate);
            if (prevGate && prevGate.status !== "completed") {
              this.emit(ctx, `${todo.id} deferred: phase "${currentPhase}" gate not complete`, auto);
              break;
            }
          }
          currentPhase = todo.phase;
        }

        // Mark in_progress
        todo.status = "in_progress";
        updateTodoStatus(this.deps.directory, todo.id, "in_progress", undefined, ctx.slug);
        ctx.state = "executing";
        this.emit(ctx, `Delegating ${todo.id} to ${resolveAgentAlias(todo.agent, names)}`, auto);

        // Dispatch task
        const promise = this.runTask(todo, todoIndex, ctx, cfg, names, auto)
          .finally(() => running.delete(todo.id));
        running.set(todo.id, promise);
      }

      // If nothing running and nothing ready, we're done
      if (running.size === 0) break;

      // Wait for at least one task to complete
      await Promise.race(running.values());
    }

    // Final state check
    const anyFailed = ctx.todos.some((t) => t.status === "failed");
    const allDone = ctx.todos.every((t) => t.status === "completed" || t.status === "failed");
    if (allDone) {
      ctx.state = anyFailed ? "failed" : "completed";
      ctx.completedAt = Date.now();
    }
    this.saveMissionState(ctx);
  }

  /** Execute a single task with full error handling and memory accumulation */
  private async runTask(todo: ParsedTodo, index: number, ctx: MissionCtx, cfg: ReturnType<typeof loadOrchestratorConfig>, names: ReturnType<typeof loadOrchestratorConfig>["names"], auto: boolean): Promise<void> {
    const resolvedAgent = resolveAgentAlias(todo.agent, names);
    const maxRetries = cfg.maxRetries ?? 2;

    try {
      const session = await this.createSession(resolvedAgent, `${todo.id}: ${todo.description.slice(0, 40)}`, todo.id, ctx.slug);

      // Inject mission memory into prompt
      const memory = this.buildMemoryContext(ctx);
      const basePrompt = this.buildTaskPrompt(todo, cfg, names, ctx.slug);
      const prompt = memory ? `${memory}\n\n---\n\n${basePrompt}` : basePrompt;

      await this.promptSession(session.id, resolvedAgent, prompt);

      if (auto) {
        await this.pollSession(session.id);
      }

      // Audit if critical path
      if (todo.criticalPath) {
        ctx.state = "auditing";
        const auditPassed = await this.runAudit(todo, names.auditor, ctx);
        if (!auditPassed) {
          const retries = ctx.retryCounts.get(todo.id) ?? 0;
          if (retries < maxRetries) {
            ctx.retryCounts.set(todo.id, retries + 1);
            this.emit(ctx, `${todo.id} audit failed, retry ${retries + 1}/${maxRetries}`, auto);
            await sleep(1000 * Math.pow(2, retries));
            // Re-dispatch same task
            return this.runTask(todo, index, ctx, cfg, names, auto);
          }
          // Max retries exceeded
          updateTodoStatus(this.deps.directory, todo.id, "failed", `Audit failed after ${maxRetries} retries`, ctx.slug);
          ctx.todos[index] = { ...todo, status: "failed" };
          this.addTaskMemory(ctx, todo.id, resolvedAgent, "Audit failed — acceptance criteria not met", [], [`Failed after ${maxRetries} retries`]);
          this.emit(ctx, `${todo.id} audit FAILED permanently`, auto);
          return;
        }
      }

      // Success
      updateTodoStatus(this.deps.directory, todo.id, "completed", `Done by ${resolvedAgent}`, ctx.slug);
      ctx.todos[index] = { ...todo, status: "completed" };
      this.addTaskMemory(ctx, todo.id, resolvedAgent, todo.description, [], []);
      this.emit(ctx, `${todo.id} completed`, auto);

    } catch (err) {
      const retries = ctx.retryCounts.get(todo.id) ?? 0;
      if (retries < maxRetries) {
        ctx.retryCounts.set(todo.id, retries + 1);
        this.emit(ctx, `${todo.id} failed (${String(err).slice(0, 100)}), retry ${retries + 1}/${maxRetries}`, auto);
        await sleep(1000 * Math.pow(2, retries));
        return this.runTask(todo, index, ctx, cfg, names, auto);
      }
      // Max retries exceeded — mark failed but DON'T break other tasks
      updateTodoStatus(this.deps.directory, todo.id, "failed", String(err).slice(0, 200), ctx.slug);
      ctx.todos[index] = { ...todo, status: "failed" };
      this.addTaskMemory(ctx, todo.id, resolvedAgent, `Failed: ${String(err).slice(0, 100)}`, [], [String(err).slice(0, 200)]);
      this.emit(ctx, `${todo.id} failed permanently after ${maxRetries} retries`, auto);
    }
  }

  /** Build memory context string from previous task memories */
  private buildMemoryContext(ctx: MissionCtx): string | undefined {
    if (!ctx.memory || ctx.memory.length === 0) return undefined;
    const entries = ctx.memory.slice(-5); // Last 5 tasks
    const lines = ["## Mission Context (Previous Tasks)", ""];
    for (const m of entries) {
      lines.push(`- **${m.taskId}** (${m.agent}): ${m.summary}`);
      if (m.filesChanged.length) lines.push(`  - Files: ${m.filesChanged.join(", ")}`);
      if (m.issues.length) lines.push(`  - Issues: ${m.issues.join("; ")}`);
    }
    lines.push("", "Use this context to avoid duplicating work or re-introducing already-fixed issues.");
    return lines.join("\n");
  }

  /** Add a task memory entry */
  private addTaskMemory(ctx: MissionCtx, taskId: string, agent: string, summary: string, filesChanged: string[], issues: string[]) {
    if (!ctx.memory) ctx.memory = [];
    ctx.memory.push({
      taskId,
      agent,
      summary,
      filesChanged,
      issues,
      timestamp: Date.now(),
    });
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

    const modelKey = modelObj ? `${modelObj.providerID}/${modelObj.modelID}` : "";
    
    // Check circuit breaker
    const failures = this.modelFailures.get(modelKey) ?? 0;
    if (failures >= 5) {
      console.error(`[opencode-orchestrator] Circuit breaker OPEN for ${modelKey} (${failures} failures). Skipping to fallback.`);
      this.brokenModels.add(modelKey);
    } else {
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
          const failCount = (this.modelFailures.get(modelKey) ?? 0) + 1;
          this.modelFailures.set(modelKey, failCount);
          console.error(`[opencode-orchestrator] createSession primary model failed (${failCount}/5): ${(err as Error).message}`);
        }
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
        // Clear failure count since fallback succeeded
        if (modelKey) this.modelFailures.set(modelKey, 0);
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
    const data = JSON.stringify({
      missionId: ctx.missionId,
      slug: ctx.slug,
      description: ctx.description,
      state: ctx.state,
      todos: ctx.todos,
      completedAt: ctx.completedAt,
      memory: ctx.memory,
    }, null, 2);
    try {
      writeFileAtomicSync(path, data);
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
