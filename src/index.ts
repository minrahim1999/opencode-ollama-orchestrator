import type { Plugin } from "@opencode-ai/plugin";
import { AGENTS } from "./agents/index.js";
import { createConfigHandler } from "./core/config-handler.js";
import { createEventHandler } from "./core/event-handler.js";
import { createDelegateTaskTool } from "./tools/delegate-task.js";

const plugin: Plugin = async (input) => {
  const { client, directory } = input;
  const sessions = new Map<string, { active: boolean; step: number }>();

  return {
    config: createConfigHandler({ agents: AGENTS }),
    event: createEventHandler({ client, directory, sessions }),
    tool: {
      delegate_task: createDelegateTaskTool({ client, directory, sessions }),
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
