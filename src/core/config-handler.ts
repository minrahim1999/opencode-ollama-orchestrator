import { AGENTS } from "../agents/index.js";
import { COMMANDS } from "../commands/index.js";

interface ConfigHandlerDeps {
  agents: typeof AGENTS;
  commands: typeof COMMANDS;
}

export function createConfigHandler(deps: ConfigHandlerDeps) {
  return async (config: any) => {
    if (!config.agent) config.agent = {};
    if (!config.commands) config.commands = [];

    // Register orchestrator agents - merge with user's existing config to preserve model/settings
    const agentEntries = [
      ["commander", deps.agents.COMMANDER_PROMPT, "primary"],
      ["planner", deps.agents.PLANNER_PROMPT, "subagent"],
      ["worker", deps.agents.WORKER_PROMPT, "subagent"],
      ["reviewer", deps.agents.REVIEWER_PROMPT, "subagent"],
    ] as const;

    for (const [name, prompt, mode] of agentEntries) {
      const existing = config.agent[name] ?? {};
      config.agent[name] = {
        ...existing,
        description: existing.description ?? `${name.charAt(0).toUpperCase() + name.slice(1)} agent for ollama orchestrator`,
        mode: existing.mode ?? mode,
        prompt: prompt,
        maxTokens: existing.maxTokens ?? 8192,
      };
    }

    // Register slash commands
    const cmds = [
      { name: "/task", description: "Start a new mission", agent: "commander" },
      { name: "/plan", description: "Generate plan", agent: "planner" },
      { name: "/agents", description: "List active agents", agent: "reviewer" },
      { name: "/status", description: "Show mission progress", agent: "commander" },
    ];

    for (const cmd of cmds) {
      const idx = config.commands.findIndex((c: any) => c.name === cmd.name);
      if (idx >= 0) {
        config.commands[idx] = { ...config.commands[idx], ...cmd };
      } else {
        config.commands.push(cmd);
      }
    }
  };
}
