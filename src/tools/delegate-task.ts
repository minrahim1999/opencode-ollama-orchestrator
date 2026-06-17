import { tool } from "@opencode-ai/plugin";
import { loadOrchestratorConfig } from "../utils/constants.js";
import type { ResolvedNames } from "../utils/constants.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
          `[opencode-orchestrator] Unsupported agent "${args.agent}" (resolved: "${resolved}"). ` +
          `Supported: ${supportedRoles.join(", ")}`
        );
      }

      // Resolve per-agent model from user's opencode.json
      const userConfig = loadUserConfig();
      const agentConfig = userConfig?.agent?.[resolved];
      let modelObj: { providerID: string; modelID: string } | null = null;
      if (agentConfig?.model) {
        modelObj = parseModel(agentConfig.model);
      }
      // Fallback to global default model
      if (!modelObj && userConfig?.model) {
        modelObj = parseModel(userConfig.model);
      }

      const sessionCreateOpts: any = {
        directory: deps.directory,
        title: `${resolved}: ${args.task.slice(0, 50)}`,
        agent: resolved,
        ...(args.parentSessionID ? { parentID: args.parentSessionID } : {}),
        ...(modelObj ? { model: modelObj } : {}),
      };

      if (modelObj) {
        console.error(`[opencode-orchestrator] Delegating to ${resolved} with model ${modelObj.providerID}/${modelObj.modelID}`);
      }

      const session = await deps.client.v2.session.create(sessionCreateOpts);

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
