import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { AGENTS } from "./agents/index.js";
import { createConfigHandler } from "./core/config-handler.js";
import { createEventHandler } from "./core/event-handler.js";
import { MissionController } from "./core/mission-controller.js";
import { createDelegateTaskTool } from "./tools/delegate-task.js";

const plugin: Plugin = async (input) => {
  const { client, directory } = input;
  const sessions = new Map<string, import("./core/types.js").SessionInfo>();

  // Single shared MissionController for both events and tools
  const controller = new MissionController({ client, directory, sessions });

  return {
    config: createConfigHandler({ agents: AGENTS }),
    event: createEventHandler(controller),
    tool: {
      delegate_task: createDelegateTaskTool({ client, directory, sessions }),
      abort_mission: tool({
        description: "Abort all active orchestrator missions and mark them failed.",
        args: {},
        execute: async () => {
          controller.abort();
          return "All active missions aborted.";
        },
      }),
      mission_status: tool({
        description: "Show current orchestrator mission and session status summary.",
        args: {},
        execute: async () => {
          const missionLines = controller.status();
          const sessionLines = controller.sessionSummary();
          return [missionLines, "--- Sessions ---", ...sessionLines].join("\n");
        },
      }),
      skip_task: tool({
        description: "Skip a specific task in the current mission by task ID. Marks it as completed so execution continues past it.",
        args: {
          missionSlug: tool.schema.string().describe("Mission slug (e.g. build-login-page)"),
          taskId: tool.schema.string().describe("Task ID to skip (e.g. TASK-003)"),
        },
        execute: async (args: { missionSlug: string; taskId: string }) => {
          const ok = controller.skipTask(args.missionSlug, args.taskId);
          return ok ? `Task ${args.taskId} skipped in mission ${args.missionSlug}` : `Mission or task not found.`;
        },
      }),
      resume_from: tool({
        description: "Resume mission execution from a specific task ID. Marks all prior tasks as completed.",
        args: {
          missionSlug: tool.schema.string().describe("Mission slug (e.g. build-login-page)"),
          taskId: tool.schema.string().describe("Task ID to resume from (e.g. TASK-003)"),
        },
        execute: async (args: { missionSlug: string; taskId: string }) => {
          const ok = controller.resumeFrom(args.missionSlug, args.taskId);
          return ok ? `Resuming mission ${args.missionSlug} from ${args.taskId}` : `Mission or task not found.`;
        },
      }),
      check_watchdog: tool({
        description: "Run the session watchdog — detect and kill any sessions stuck for >15 minutes.",
        args: {},
        execute: async () => {
          controller.checkWatchdog();
          return "Watchdog check complete. Check logs for any stuck sessions.";
        },
      }),
      revert_mission: tool({
        description: "Revert a mission to its pre-mission state using the stored backup. Aborts the mission and restores files.",
        args: {
          missionSlug: tool.schema.string().describe("Mission slug to revert (e.g. build-login-page)"),
        },
        execute: async (args: { missionSlug: string }) => {
          const ok = controller.revertMission(args.missionSlug);
          return ok
            ? `Mission ${args.missionSlug} reverted to pre-mission state.`
            : `Failed to revert mission ${args.missionSlug}. Check logs for details.`;
        },
      }),
    },
    "chat.params": async (_inp, output) => {
      const model = output.options?.model as string | undefined;
      if (model) {
        console.error(`[opencode-orchestrator] Chat model resolved to: ${model}`);
      }
    },
  };
};

export default plugin;
