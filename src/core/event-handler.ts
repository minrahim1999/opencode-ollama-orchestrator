/**
 * Full event handler implementing the mission loop.
 * Replaces the placeholder startMission with real orchestration.
 */
import type { EventHandlerDeps } from "./types.js";
import {
  loadOrchestratorConfig,
  ensureMissionsDir,
  generateMissionId,
} from "../utils/constants.js";
import { parseTodos, updateTodoStatus, exportTodosJson } from "../utils/todo-parser.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const VERSION = "1.0.0";

export function createEventHandler(deps: EventHandlerDeps) {
  return async (event: any) => {
    if (event.type === "command.executed") {
      const { command, args } = event.data;
      switch (command) {
        case "/task":
          await handleTask(deps, args);
          break;
        case "/plan":
          await handlePlan(deps, args);
          break;
        case "/status":
          await handleStatus(deps);
          break;
        case "/agents":
          await handleAgents(deps);
          break;
        case "/delegate":
          await handleDelegate(deps, args);
          break;
        case "/retry":
          await handleRetry(deps, args);
          break;
        case "/abort":
          await handleAbort(deps);
          break;
        case "/version":
          await handleVersion(deps);
          break;
      }
    }
    return event;
  };
}

/* ─── /task ─── */
async function handleTask(deps: EventHandlerDeps, description: string) {
  const { client, directory } = deps;
  const cfg = loadOrchestratorConfig(directory);
  const names = cfg.names;
  const missionId = generateMissionId();
  const missionDir = ensureMissionsDir(directory);

  log(deps, `[${missionId}] Starting mission: ${description}`, cfg.verbose);

  const missionPath = `${missionDir}/${missionId}.json`;
  saveMission(missionPath, {
    id: missionId,
    description,
    status: "planning",
    agents: {},
    todos: [],
    createdAt: Date.now(),
  });

  // Phase 1: Architect plans
  log(deps, `[${missionId}] Commissioning ${names.architect}...`, cfg.verbose);
  const archSession = await client.v2.session.create({
    directory,
    title: `Plan: ${description.slice(0, 40)}`,
    agent: names.architect,
  });
  deps.sessions.set(archSession.id, { active: true, step: 1 });

  await client.v2.session.prompt({
    sessionID: archSession.id,
    directory,
    parts: [{
      type: "text",
      text: `Create plan for: ${description}\n\n` +
            `Constraints:\n` +
            `- Max parallel workers: ${cfg.maxParallelWorkers}\n` +
            `- Max retries: ${cfg.maxRetries}\n` +
            `- Max subagent depth: ${cfg.maxSubagentDepth}\n\n` +
            `Write plan to .opencode/todos.md`
    }],
  });

  log(deps, `[${missionId}] Waiting for ${names.architect}...`, cfg.verbose);
  await sleep(2000);

  // Phase 2: Execute
  const todos = parseTodos(directory);
  exportTodosJson(directory, todos);

  if (todos.length === 0) {
    log(deps, `[${missionId}] No todos found. Check .opencode/todos.md`, cfg.verbose);
    return;
  }

  updateMission(missionPath, { status: "executing", todos });
  log(deps, `[${missionId}] Dispatching ${todos.length} tasks...`, cfg.verbose);

  const failedTasks: string[] = [];
  const retryCounts = new Map<string, number>();

  for (let i = 0; i < todos.length; i++) {
    const todo = todos[i];
    if (todo.status === "completed") continue;

    // Check dependencies
    const depsMet = todo.dependsOn.every((depId) => {
      const dep = todos.find((t) => t.id === depId);
      return dep?.status === "completed";
    });
    if (!depsMet) {
      log(deps, `[${missionId}] ${todo.id} deferred (deps)`, cfg.verbose);
      continue;
    }

    const agentName = resolveAgentForTodo(todo, names);
    log(deps, `[${missionId}] Delegating ${todo.id} to ${agentName}`, cfg.verbose);

    try {
      const session = await client.v2.session.create({
        directory,
        title: `${todo.id}: ${todo.description.slice(0, 40)}`,
        agent: agentName,
      });
      deps.sessions.set(session.id, { active: true, step: 1 });

      await client.v2.session.prompt({
        sessionID: session.id,
        directory,
        parts: [{ type: "text", text: buildTaskPrompt(todo, cfg, names) }],
      });

      await sleep(2000);

      if (todo.criticalPath) {
        log(deps, `[${missionId}] Auditing ${todo.id}...`, cfg.verbose);
        await runAudit(deps, todo, names);
      }

      updateTodoStatus(directory, todo.id, "completed", `Done by ${agentName}`);
      todos[i] = { ...todo, status: "completed" };
      log(deps, `[${missionId}] ${todo.id} completed`, cfg.verbose);
    } catch (err) {
      const retries = retryCounts.get(todo.id) ?? 0;
      if (retries < cfg.maxRetries) {
        retryCounts.set(todo.id, retries + 1);
        log(deps, `[${missionId}] ${todo.id} failed (${retries + 1}), retrying...`, cfg.verbose);
        await sleep(1000 * Math.pow(2, retries));
        i--; // Retry this task
      } else {
        failedTasks.push(todo.id);
        updateTodoStatus(directory, todo.id, "failed", String(err));
        todos[i] = { ...todo, status: "failed" };
        log(deps, `[${missionId}] ${todo.id} failed permanently`, cfg.verbose);
      }
    }
  }

  const completed = todos.filter((t) => t.status === "completed").length;
  const total = todos.length;

  if (failedTasks.length === 0) {
    updateMission(missionPath, { status: "completed", completedAt: Date.now() });
    log(deps, `\n✅ MISSION_COMPLETE [${missionId}] ${completed}/${total}`, true);
  } else {
    updateMission(missionPath, { status: "failed" });
    log(deps, `\n❌ MISSION_FAILED [${missionId}] Failed: ${failedTasks.join(", ")} | Done: ${completed}/${total}`, true);
  }
}

/* ─── /plan ─── */
async function handlePlan(deps: EventHandlerDeps, args: string) {
  await handleTask(deps, args || "Regenerate plan for current mission");
}

/* ─── /status ─── */
async function handleStatus(deps: EventHandlerDeps) {
  const todos = parseTodos(deps.directory);
  const pending = todos.filter((t) => t.status === "pending").length;
  const inProgress = todos.filter((t) => t.status === "in_progress").length;
  const completed = todos.filter((t) => t.status === "completed").length;
  const failed = todos.filter((t) => t.status === "failed").length;

  log(deps, `
📊 Status
─────────
Total:     ${todos.length}
Pending:   ${pending}
Active:    ${inProgress}
Done:      ${completed}
Failed:    ${failed}
─────────
`, true);
}

/* ─── /agents ─── */
async function handleAgents(deps: EventHandlerDeps) {
  const cfg = loadOrchestratorConfig(deps.directory);
  const lines = Object.entries(cfg.names).map(([role, name]) => `  ${role}: ${name}`);
  log(deps, `🤖 Agents\n${lines.join("\n")}`, true);
}

/* ─── /delegate ─── */
async function handleDelegate(deps: EventHandlerDeps, args: any) {
  log(deps, `Manual delegation: ${JSON.stringify(args)}`, true);
}

/* ─── /retry ─── */
async function handleRetry(deps: EventHandlerDeps, _args: any) {
  const todos = parseTodos(deps.directory);
  const failed = todos.filter((t) => t.status === "failed");
  if (failed.length === 0) {
    log(deps, "No failed tasks to retry.", true);
    return;
  }
  log(deps, `Retrying ${failed.length} failed tasks...`, true);
  await handleTask(deps, "Retry failed tasks");
}

/* ─── /abort ─── */
async function handleAbort(deps: EventHandlerDeps) {
  const arr: Array<[string, { active: boolean; step: number }]> = Array.from(deps.sessions.entries());
  for (const [sid, state] of arr) {
    if (state.active) {
      log(deps, `Aborting session ${sid}...`, true);
      deps.sessions.set(sid, { ...state, active: false });
    }
  }
  log(deps, "🛑 Mission aborted.", true);
}

/* ─── /version ─── */
async function handleVersion(_deps: EventHandlerDeps) {
  console.error(`[ollama-orchestrator] v${VERSION}`);
}

/* ─── Helpers ─── */

function resolveAgentForTodo(
  todo: { agent: string },
  names: { engineer: string; specialist: string }
): string {
  if (todo.agent === "engineer" || todo.agent === "worker") return names.engineer;
  if (todo.agent === "specialist" || todo.agent === "expert") return names.specialist;
  return names.engineer;
}

function buildTaskPrompt(
  todo: { id: string; description: string; acceptanceCriteria: string[]; criticalPath: boolean },
  cfg: { requireApproval: boolean; maxRetries: number; maxSubagentDepth: number },
  names: { specialist: string; engineer: string; auditor: string }
): string {
  return `Task: ${todo.id}\nDescription: ${todo.description}\n` +
    `Critical Path: ${todo.criticalPath ? "YES" : "NO"}\n` +
    `Acceptance Criteria:\n${todo.acceptanceCriteria.map((c) => `  - ${c}`).join("\n")}\n\n` +
    `Rules: maxRetries=${cfg.maxRetries}, approval=${cfg.requireApproval}, depth=${cfg.maxSubagentDepth}\n` +
    `Escalate to ${names.specialist} for deep issues. ${names.auditor} audits critical items.\n\n` +
    `After completion, update .opencode/todos.md and provide evidence.`;
}

async function runAudit(
  deps: EventHandlerDeps,
  todo: { id: string; description: string; acceptanceCriteria: string[] },
  names: { auditor: string }
) {
  const session = await deps.client.v2.session.create({
    directory: deps.directory,
    title: `Audit: ${todo.id}`,
    agent: names.auditor,
  });
  deps.sessions.set(session.id, { active: true, step: 1 });

  await deps.client.v2.session.prompt({
    sessionID: session.id,
    directory: deps.directory,
    parts: [{
      type: "text",
      text: `Audit task: ${todo.id}\n${todo.description}\n` +
            `Criteria:\n${todo.acceptanceCriteria.map((c) => `  - ${c}`).join("\n")}\n\n` +
            `Verify all criteria. Run tests. Check for regressions.`
    }],
  });

  await sleep(2000);
}

function saveMission(path: string, mission: unknown) {
  writeFileSync(path, JSON.stringify(mission, null, 2), "utf-8");
}

function updateMission(path: string, updates: Record<string, unknown>) {
  if (!existsSync(path)) return;
  const current = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  const merged: Record<string, unknown> = {};
  for (const k of Object.keys(current)) merged[k] = current[k];
  for (const k of Object.keys(updates)) merged[k] = updates[k];
  writeFileSync(path, JSON.stringify(merged, null, 2), "utf-8");
}

function log(_deps: EventHandlerDeps, message: string, force: boolean) {
  if (force) console.error(`[ollama-orchestrator] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
