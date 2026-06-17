import { tool } from "@opencode-ai/plugin";
import { loadOrchestratorConfig } from "../utils/constants.js";
import type { ResolvedNames } from "../utils/constants.js";

interface DelegateTaskDeps {
  client: any;
  directory: string;
  sessions: Map<string, { active: boolean; step: number }>;
}

/** Resolve generic agent names to configured names at runtime */
function resolveAgentAlias(agent: string, names: ResolvedNames): string {
  const aliases: Record<string, keyof ResolvedNames> = {
    "planner": "architect",
    "worker": "engineer",
    "reviewer": "auditor",
    "expert": "specialist",
    "commander": "strategist",
  };

  const role = aliases[agent.toLowerCase()] ?? (Object.keys(names).includes(agent) ? agent as keyof ResolvedNames : null);
  if (!role) return agent; // Pass through as-is if unrecognized
  return names[role];
}

export function createDelegateTaskTool(deps: DelegateTaskDeps) {
  return tool({
    description: "Delegate a subtask to a dedicated agent session (architect, engineer, auditor, specialist, or strategist).",
    args: {
      agent: tool.schema.string().describe("Target agent alias: planner|worker|reviewer|expert|commander or custom configured name"),
      task: tool.schema.string().describe("Full task description with context"),
      parentSessionID: tool.schema.string().optional().describe("Parent mission session ID"),
    },
    async execute(args) {
      const cfg = loadOrchestratorConfig(deps.directory);
      const resolved = resolveAgentAlias(args.agent, cfg.names);

      const supportedRoles = Object.values(cfg.names);
      if (!supportedRoles.includes(resolved)) {
        throw new Error(
          `[ollama-orchestrator] Unsupported agent "${args.agent}" (resolved: "${resolved}"). ` +
          `Supported: ${supportedRoles.join(", ")}`
        );
      }

      const session = await deps.client.v2.session.create({
        directory: deps.directory,
        title: `${resolved}: ${args.task.slice(0, 50)}`,
        agent: resolved,
        ...(args.parentSessionID ? { parentID: args.parentSessionID } : {}),
      });

      deps.sessions.set(session.id, { active: true, step: 1 });

      await deps.client.v2.session.prompt({
        sessionID: session.id,
        directory: deps.directory,
        parts: [{ type: "text", text: args.task }],
      });

      return `Delegated to ${resolved} (alias: ${args.agent}). Session: ${session.id}`;
    },
  });
}
