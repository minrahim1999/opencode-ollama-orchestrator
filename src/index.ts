import type { Plugin } from "@opencode-ai/plugin";
import { AGENTS } from "./agents/index.js";
import { createConfigHandler } from "./core/config-handler.js";
import { createEventHandler } from "./core/event-handler.js";
import { createDelegateTaskTool } from "./tools/delegate-task.js";
import { lockProviderToOllama } from "./utils/provider-lock.js";

const plugin: Plugin = async (input) => {
  const { client, directory } = input;
  const sessions = new Map<string, { active: boolean; step: number }>();

  // Hard-lock to Ollama-only
  await lockProviderToOllama(client);

  return {
    config: createConfigHandler({ agents: AGENTS }),
    event: createEventHandler({ client, directory, sessions }),
    tool: {
      delegate_task: createDelegateTaskTool({ client, directory, sessions }),
    },
    "chat.params": async (_inp, output) => {
      const model = output.options?.model as string | undefined;
      if (model && !model.startsWith("ollama/")) {
        throw new Error(
          `[ollama-orchestrator] Non-Ollama model blocked: "${model}". Only Ollama providers are supported.`
        );
      }
    },
  };
};

export default plugin;
