/**
 * Updated event handler using MissionController for automatic mode.
 */
import type { EventHandlerDeps } from "./types.js";
import { MissionController } from "./mission-controller.js";
import { loadOrchestratorConfig } from "../utils/constants.js";
import { parseTodos, updateTodoStatus, exportTodosJson } from "../utils/todo-parser.js";
import { ensureProjectDirs } from "../utils/paths.js";

const VERSION = "1.1.0";

export function createEventHandler(deps: EventHandlerDeps) {
  const controller = new MissionController(deps);

  return async (event: any) => {
    if (event.type === "command.executed") {
      const { command, args } = event.data;
      switch (command) {
        case "/task":
          await handleTask(controller, deps, args, false); // Manual mode
          break;
        case "/auto":
          await handleAuto(controller, deps, args); // Fully automatic
          break;
        case "/plan":
          await handlePlan(controller, deps, args);
          break;
        case "/status":
          await handleStatus(controller);
          break;
        case "/agents":
          await handleAgents(deps);
          break;
        case "/delegate":
          await handleDelegate(deps, args);
          break;
        case "/retry":
          await handleRetry(controller, deps, args);
          break;
        case "/abort":
          await handleAbort(controller);
          break;
        case "/version":
          await handleVersion();
          break;
      }
    }
    return event;
  };
}

/* ─── /task ─── */
async function handleTask(controller: MissionController, deps: EventHandlerDeps, description: string, auto: boolean) {
  ensureProjectDirs(deps.directory);
  await controller.start(description || "Untitled mission", auto);
}

/* ─── /auto ─── */
async function handleAuto(controller: MissionController, deps: EventHandlerDeps, args: string) {
  ensureProjectDirs(deps.directory);
  log(deps, "🚀 AUTO MODE — running full pipeline automatically...", true);
  await controller.start(args || "Auto mission", true);
}

/* ─── /plan ─── */
async function handlePlan(controller: MissionController, deps: EventHandlerDeps, args: string) {
  if (args) {
    await controller.start(`Re-plan: ${args}`, false);
  } else {
    await controller.resume();
  }
}

/* ─── /status ─── */
async function handleStatus(controller: MissionController) {
  const status = controller.status();
  console.error(`[ollama-orchestrator] ${status || "No active missions"}`);
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
async function handleRetry(controller: MissionController, deps: EventHandlerDeps, _args: any) {
  log(deps, "Retrying failed tasks...", true);
  await controller.resume();
}

/* ─── /abort ─── */
async function handleAbort(controller: MissionController) {
  controller.abort();
  console.error("[ollama-orchestrator] 🛑 All missions aborted.");
}

/* ─── /version ─── */
async function handleVersion() {
  console.error(`[ollama-orchestrator] v${VERSION}`);
}

/* ─── Helpers ─── */
function log(_deps: EventHandlerDeps, message: string, force: boolean) {
  if (force) console.error(`[ollama-orchestrator] ${message}`);
}
