import type { AgentPrompts } from "../agents/index.js";
import { DEFAULT_AGENT_NAMES } from "../agents/index.js";
import type { AgentConfig, AgentNameConfig, PluginConfig } from "../types.js";

interface ConfigHandlerDeps {
	agents: AgentPrompts;
	pluginOptions?: PluginConfig;
}

/** Resolve final agent names from user config + defaults */
function resolveAgentNames(custom?: AgentNameConfig) {
	return {
		strategist: custom?.strategist ?? DEFAULT_AGENT_NAMES.STRATEGIST,
		architect: custom?.architect ?? DEFAULT_AGENT_NAMES.ARCHITECT,
		engineer: custom?.engineer ?? DEFAULT_AGENT_NAMES.ENGINEER,
		auditor: custom?.auditor ?? DEFAULT_AGENT_NAMES.AUDITOR,
		specialist: custom?.specialist ?? DEFAULT_AGENT_NAMES.SPECIALIST,
		spark: custom?.spark ?? DEFAULT_AGENT_NAMES.SPARK,
	};
}

/** Default tool bundles per role — overridable by user */
function defaultTools(role: string): AgentConfig["tools"] {
	const all: AgentConfig["tools"] = {
		bash: true,
		edit: true,
		write: true,
		read: true,
		glob: true,
		grep: true,
		webfetch: true,
		websearch: true,
		list: true,
		task: true,
		question: true,
		external_directory: true,
		doom_loop: true,
	};

	const readOnly: AgentConfig["tools"] = {
		read: true,
		glob: true,
		grep: true,
		list: true,
		webfetch: true,
		websearch: true,
		task: true,
		question: true,
		start_mission: true,
	};

	const planOnly: AgentConfig["tools"] = {
		...readOnly,
		write: true,
		bash: true,
	};

	const auditOnly: AgentConfig["tools"] = {
		...readOnly,
		bash: true,
	};

	const sparkTools: AgentConfig["tools"] = {
		read: true,
		glob: true,
		grep: true,
		list: true,
		webfetch: true,
		websearch: true,
	};

	switch (role) {
		case "strategist":
			return readOnly;
		case "architect":
			return planOnly;
		case "engineer":
			return all;
		case "auditor":
			return auditOnly;
		case "specialist":
			return readOnly;
		case "spark":
			return sparkTools;
		default:
			return readOnly;
	}
}

/** Default permission bundles per role — overridable by user */
function defaultPermission(role: string): AgentConfig["permission"] {
	const allAllow: AgentConfig["permission"] = {
		edit: "allow",
		write: "allow",
		bash: "allow",
		read: "allow",
		glob: "allow",
		grep: "allow",
		webfetch: "allow",
		websearch: "allow",
		list: "allow",
		task: "allow",
		question: "allow",
		external_directory: "allow",
		doom_loop: "allow",
		skill: { "*": "allow" },
	};

	const readOnly: AgentConfig["permission"] = {
		read: "allow",
		glob: "allow",
		grep: "allow",
		list: "allow",
		webfetch: "allow",
		websearch: "allow",
		task: "allow",
		question: "allow",
		start_mission: "allow",
		skill: { "*": "allow" },
	};

	const planPerm: AgentConfig["permission"] = {
		edit: "deny",
		bash: "deny",
		write: {
			".opencode/plans/*": "allow",
			".opencode/plans/**": "allow",
			".opencode/todo/*": "allow",
			".opencode/todo/**": "allow",
			"AGENTS.md": "allow",
			"*/AGENTS.md": "allow",
			"**/AGENTS.md": "allow",
			".opencode/DOX/*": "allow",
			".opencode/DOX/**": "allow",
			"*": "deny",
		},
		read: "allow",
		glob: "allow",
		grep: "allow",
		webfetch: "allow",
		websearch: "allow",
		list: "allow",
		task: "allow",
		question: "allow",
		skill: { "*": "allow" },
	};

	const auditPerm: AgentConfig["permission"] = {
		edit: "deny",
		bash: "allow",
		write: {
			".opencode/reviews/*": "allow",
			".opencode/reviews/**": "allow",
			"AGENTS.md": "allow",
			"*": "deny",
		},
		read: "allow",
		glob: "allow",
		grep: "allow",
		list: "allow",
		task: "allow",
		question: "allow",
		skill: { "*": "allow" },
	};

	const sparkPerm: AgentConfig["permission"] = {
		read: "allow",
		glob: "allow",
		grep: "allow",
		list: "allow",
		webfetch: "allow",
		websearch: "allow",
		skill: { "*": "allow" },
		edit: "deny",
		bash: "deny",
		write: "deny",
		question: "deny",
		task: "deny",
		external_directory: "deny",
		doom_loop: "deny",
	};

	switch (role) {
		case "strategist":
			return readOnly;
		case "architect":
			return planPerm;
		case "engineer":
			return allAllow;
		case "auditor":
			return auditPerm;
		case "specialist":
			return readOnly;
		case "spark":
			return sparkPerm;
		default:
			return readOnly;
	}
}

/**
 * Build complete agent config.
 * Priority: orchestrator defaults → user overrides → hard orchestrator rules (mode, prompt merge).
 *
 * FORWARD LIST — every field from AgentConfig is propagated:
 *   model, fallbackModel, smallModel, temperature, topP, topK,
 *   maxTokens, description, prompt, systemPrompt, mode,
 *   color, tools, permission, skills, thinking,
 *   allowLoop, loopCount
 */
function buildAgentConfig(
	name: string,
	role: string,
	prompt: string,
	mode: "primary" | "subagent",
	userCfg?: AgentConfig,
	pluginOpts?: PluginConfig,
) {
	// 1. Orchestrator default base
	const defaults: AgentConfig = {
		description: `${name} agent — Multi-Agent Orchestrator ${role}`,
		mode,
		prompt,
		maxTokens: role === "spark" ? 2048 : 8192,
		temperature:
			role === "strategist"
				? 0.3
				: role === "architect"
					? 0.8
					: role === "spark"
						? 0.3
						: 0.2,
		tools: defaultTools(role),
		permission: defaultPermission(role),
		allowLoop: false,
		loopCount: 0,
	};

	// 2. Plugin-level small_model fallback — spark always uses small model
	if (pluginOpts?.smallModel) {
		defaults.smallModel = pluginOpts.smallModel;
	}
	if (role === "spark" && pluginOpts?.smallModel) {
		defaults.model = pluginOpts.smallModel;
	}
	if (pluginOpts?.defaultAllowLoop !== undefined) {
		defaults.allowLoop = pluginOpts.defaultAllowLoop;
	}
	if (pluginOpts?.defaultLoopCount !== undefined) {
		defaults.loopCount = pluginOpts.defaultLoopCount;
	}

	// 3. Deep merge user config on top of defaults
	// Build key list from AgentConfig so we forward everything
	const merged: AgentConfig = { ...defaults };

	if (userCfg) {
		for (const k of Object.keys(userCfg) as (keyof AgentConfig)[]) {
			// Special handling for prompt merge
			if (k === "prompt" && userCfg.prompt) {
				merged.prompt = userCfg.prompt; // full override
				continue;
			}
			// Special handling for systemPrompt → prepend if exists
			if (k === "systemPrompt" && userCfg.systemPrompt) {
				merged.systemPrompt = userCfg.systemPrompt;
				merged.prompt = `${userCfg.systemPrompt}\n\n${merged.prompt ?? ""}`;
				continue;
			}
			// Everything else: shallow clone for objects, direct assign for primitives
			const val = userCfg[k];
			if (val !== undefined && val !== null) {
				if (typeof val === "object" && !Array.isArray(val)) {
					// Merge objects (tools, permission, thinking, skill scopes)
					(merged as any)[k] = { ...(defaults as any)[k], ...val };
				} else {
					(merged as any)[k] = val;
				}
			}
		}
	}

	// 4. HARD rules — orchestrator always wins on mode and role assignment
	merged.mode = mode;

	return merged;
}

export function createConfigHandler(deps: ConfigHandlerDeps) {
	return async (config: any) => {
		if (!config.agent) config.agent = {};
		if (!config.commands) config.commands = [];

		// CRITICAL: Preserve built-in agents
		const BUILTIN_AGENT_KEYS = new Set([
			"compaction",
			"explorer",
			"worker",
			"executor",
			"debugger",
		]);

		// Resolve plugin options from opencode.json
		// Validate plugin block is an array to prevent .find() crash
		if (!config.plugin || !Array.isArray(config.plugin)) {
			console.warn(
				"[opencode-orchestrator] Plugin config missing or not an array. Using defaults.",
			);
			config.plugin = [];
		}

		const rawPluginBlock: any = (config.plugin as any[]).find(
			(p: any) =>
				p === "opencode-ollama-orchestrator" ||
				(Array.isArray(p) && p[0] === "opencode-ollama-orchestrator"),
		);

		// Sanitize plugin options — crash protection
		let pluginOpts: PluginConfig = rawPluginBlock?.[1] ?? {};
		if (pluginOpts === null || typeof pluginOpts !== "object") {
			console.warn(
				"[opencode-orchestrator] Plugin options invalid. Using defaults.",
			);
			pluginOpts = {};
		}
		if (
			pluginOpts.agents !== undefined &&
			(typeof pluginOpts.agents !== "object" ||
				Array.isArray(pluginOpts.agents))
		) {
			console.warn(
				`[opencode-orchestrator] agents must be an object, got ${typeof pluginOpts.agents}. Ignoring.`,
			);
			pluginOpts.agents = undefined;
		}
		if (
			pluginOpts.maxRetries !== undefined &&
			typeof pluginOpts.maxRetries !== "number"
		) {
			console.warn(
				`[opencode-orchestrator] maxRetries must be a number, got ${typeof pluginOpts.maxRetries}. Using default.`,
			);
			pluginOpts.maxRetries = undefined;
		}
		if (
			pluginOpts.maxParallelWorkers !== undefined &&
			typeof pluginOpts.maxParallelWorkers !== "number"
		) {
			console.warn(
				`[opencode-orchestrator] maxParallelWorkers must be a number, got ${typeof pluginOpts.maxParallelWorkers}. Using default.`,
			);
			pluginOpts.maxParallelWorkers = undefined;
		}
		if (
			pluginOpts.maxSubagentDepth !== undefined &&
			typeof pluginOpts.maxSubagentDepth !== "number"
		) {
			console.warn(
				`[opencode-orchestrator] maxSubagentDepth must be a number, got ${typeof pluginOpts.maxSubagentDepth}. Using default.`,
			);
			pluginOpts.maxSubagentDepth = undefined;
		}

		const names = resolveAgentNames(pluginOpts?.agents);

		// Collision guard
		const renamed: Record<string, string> = {};
		for (const [role, name] of Object.entries(names)) {
			if (BUILTIN_AGENT_KEYS.has(name)) {
				const safeName = `orchestrator-${name}`;
				(names as any)[role] = safeName;
				renamed[role] = safeName;
			}
		}
		if (Object.keys(renamed).length > 0) {
			console.warn(
				`[opencode-orchestrator] Built-in agent name collision detected. Auto-renamed:\n` +
					Object.entries(renamed)
						.map(([role, newName]) => `  ${role}: ${newName}`)
						.join("\n") +
					`\nTip: Set "plugin.agent.${Object.keys(renamed)[0]}" in opencode.json to a custom name.`,
			);
		}

		// Register all 6 agents
		const agentEntries: Array<[string, string, "primary" | "subagent"]> = [
			[names.strategist, "strategist", "primary"],
			[names.architect, "architect", "subagent"],
			[names.engineer, "engineer", "subagent"],
			[names.auditor, "auditor", "subagent"],
			[names.specialist, "specialist", "subagent"],
			[names.spark, "spark", "subagent"],
		];

		for (const [name, role, mode] of agentEntries) {
			const userCfg: AgentConfig | undefined = config.agent[name];
			const promptText = deps.agents[
				`${role.toUpperCase()}_PROMPT` as keyof AgentPrompts
			] as string;
			config.agent[name] = buildAgentConfig(
				name,
				role,
				promptText,
				mode,
				userCfg,
				pluginOpts,
			);
		}

		// HARD enforce maxParallelWorkers = 3 (Ollama Pro limit)
		const userMaxParallel = pluginOpts.maxParallelWorkers;
		const enforcedMaxParallel =
			userMaxParallel === undefined
				? 3
				: Math.min(Math.max(1, userMaxParallel), 3);

		config.orchestrator = {
			maxParallelWorkers: enforcedMaxParallel,
			maxRetries: Math.min(pluginOpts.maxRetries ?? 3, 5),
			verbose: pluginOpts.verbose ?? false,
			requireApproval: pluginOpts.requireApproval ?? false,
			maxSubagentDepth: Math.min(pluginOpts.maxSubagentDepth ?? 2, 3),
			agentNames: names,
			// DOX settings
			doxEnabled: pluginOpts.doxEnabled ?? true,
			doxAutoInit: pluginOpts.doxAutoInit ?? true,
			doxAutoCloseout: pluginOpts.doxAutoCloseout ?? true,
			// Ponytail settings
			ponytailLevel: pluginOpts.ponytailLevel ?? "full",
		};

		// NO commands registered
	};
}
