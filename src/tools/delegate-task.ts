import { tool } from "@opencode-ai/plugin";
import type { SessionInfo } from "../core/types.js";
import { loadOrchestratorConfig, resolveAgentAlias } from "../utils/constants.js";
import { loadUserConfig, parseModel } from "../utils/config-loader.js";

interface DelegateTaskDeps {
	client: any;
	directory: string;
	sessions: Map<string, SessionInfo>;
}

export function createDelegateTaskTool(deps: DelegateTaskDeps) {
	return tool({
		description:
			"Delegate a subtask to a dedicated agent session (architect, engineer, auditor, specialist, or strategist).",
		args: {
			agent: tool.schema
				.string()
				.describe(
					"Target agent alias: planner|worker|reviewer|expert|commander or custom configured name",
				),
			task: tool.schema.string().describe("Full task description with context"),
			parentSessionID: tool.schema
				.string()
				.optional()
				.describe("Parent mission session ID"),
		},
		async execute(args) {
			const cfg = loadOrchestratorConfig(deps.directory);
			const resolved = resolveAgentAlias(args.agent, cfg.names);

			const supportedRoles = Object.values(cfg.names);
			if (!supportedRoles.includes(resolved)) {
				throw new Error(
					`[opencode-orchestrator] Unsupported agent "${args.agent}" (resolved: "${resolved}"). ` +
						`Supported: ${supportedRoles.join(", ")}`,
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
				console.error(
					`[opencode-orchestrator] Delegating to ${resolved} with model ${modelObj.providerID}/${modelObj.modelID}`,
				);
			}

			const session = await deps.client.v2.session.create(sessionCreateOpts);

			deps.sessions.set(session.id, {
				active: true,
				step: 1,
				agent: resolved,
				model: modelObj
					? `${modelObj.providerID}/${modelObj.modelID}`
					: "default",
				createdAt: Date.now(),
				promptsSent: 1,
				lastPromptAt: Date.now(),
			});

			await deps.client.v2.session.prompt({
				sessionID: session.id,
				directory: deps.directory,
				parts: [{ type: "text", text: args.task }],
			});

			return `Delegated to ${resolved} (alias: ${args.agent}). Session: ${session.id}`;
		},
	});
}