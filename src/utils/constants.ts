/**
 * Resolve agent names at runtime from orchestrator config.
 * Falls back to defaults if no custom config exists.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ResolvedNames {
	strategist: string;
	architect: string;
	engineer: string;
	auditor: string;
	specialist: string;
	spark: string;
}

export const DEFAULT_NAMES: ResolvedNames = {
	strategist: "strategist",
	architect: "architect",
	engineer: "engineer",
	auditor: "auditor",
	specialist: "specialist",
	spark: "spark",
};

/** Load orchestrator config (injected by config-handler into runtime config) */
export function loadOrchestratorConfig(directory: string): {
	names: ResolvedNames;
	maxParallelWorkers: number;
	maxRetries: number;
	verbose: boolean;
	requireApproval: boolean;
	maxSubagentDepth: number;
	doxAutoInit: boolean;
	doxAutoCloseout: boolean;
	doxEnabled: boolean;
	mode: import("../types.js").OrchestratorMode;
	fastMode: import("../types.js").FastModeConfig | undefined;
	notify?: { ntfyTopic?: string; webhookUrl?: string; minLevel?: string; headers?: Record<string, string> };
	rateLimitCapacity?: number;
	rateLimitRefill?: number;
} {
	const configPath = join(directory, ".opencode", "opencode.json");
	let agentNames = DEFAULT_NAMES;
	let pluginOpts: any = {};
	const opts = {
		maxParallelWorkers: 3,
		maxRetries: 3,
		verbose: false,
		requireApproval: false,
		maxSubagentDepth: 2,
		doxAutoInit: true,
		doxAutoCloseout: true,
		doxEnabled: true,
		mode: "slow" as import("../types.js").OrchestratorMode,
		fastMode: undefined as import("../types.js").FastModeConfig | undefined,
	};

	if (existsSync(configPath)) {
		try {
			const raw = JSON.parse(readFileSync(configPath, "utf-8"));
			const pluginEntry = raw.plugin?.find?.(
				(p: any) =>
					p === "opencode-ollama-orchestrator" ||
					(Array.isArray(p) && p[0] === "opencode-ollama-orchestrator"),
			);
			pluginOpts = Array.isArray(pluginEntry) ? pluginEntry[1] : {};
			if (pluginOpts?.agents) {
				agentNames = {
					strategist: pluginOpts.agents.strategist ?? DEFAULT_NAMES.strategist,
					architect: pluginOpts.agents.architect ?? DEFAULT_NAMES.architect,
					engineer: pluginOpts.agents.engineer ?? DEFAULT_NAMES.engineer,
					auditor: pluginOpts.agents.auditor ?? DEFAULT_NAMES.auditor,
					specialist: pluginOpts.agents.specialist ?? DEFAULT_NAMES.specialist,
					spark: pluginOpts.agents.spark ?? DEFAULT_NAMES.spark,
				};
			}
			if (pluginOpts?.maxParallelWorkers !== undefined) opts.maxParallelWorkers = pluginOpts.maxParallelWorkers;
			if (pluginOpts?.maxRetries !== undefined) opts.maxRetries = pluginOpts.maxRetries;
			if (pluginOpts?.verbose !== undefined) opts.verbose = pluginOpts.verbose;
			if (pluginOpts?.requireApproval !== undefined) opts.requireApproval = pluginOpts.requireApproval;
			if (pluginOpts?.maxSubagentDepth !== undefined) opts.maxSubagentDepth = pluginOpts.maxSubagentDepth;
			if (pluginOpts?.doxAutoInit !== undefined) opts.doxAutoInit = pluginOpts.doxAutoInit;
			if (pluginOpts?.doxAutoCloseout !== undefined) opts.doxAutoCloseout = pluginOpts.doxAutoCloseout;
			if (pluginOpts?.doxEnabled !== undefined) opts.doxEnabled = pluginOpts.doxEnabled;
			if (pluginOpts?.fastMode) {
				opts.mode = pluginOpts.fastMode.mode ?? "slow";
				opts.fastMode = pluginOpts.fastMode;
			}
		} catch {}
	}

	return {
		names: agentNames,
		...opts,
		notify: pluginOpts?.notify,
		rateLimitCapacity: pluginOpts?.rateLimitCapacity,
		rateLimitRefill: pluginOpts?.rateLimitRefill,
	};
}

/** Ensure .opencode/missions/ directory exists */
export function ensureMissionsDir(directory: string): string {
	const dir = join(directory, ".opencode", "missions");
	mkdirSync(dir, { recursive: true });
	return dir;
}

/** Generate mission ID */
export function generateMissionId(): string {
	return `mission-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Resolve generic agent aliases to configured names at runtime */
export function resolveAgentAlias(agent: string, names: ResolvedNames): string {
	const aliases: Record<string, keyof ResolvedNames> = {
		planner: "architect",
		worker: "engineer",
		reviewer: "auditor",
		expert: "specialist",
		commander: "strategist",
	};

	const role =
		aliases[agent.toLowerCase()] ??
		(Object.keys(names).includes(agent) ? (agent as keyof ResolvedNames) : null);
	if (!role) return agent; // Pass through as-is if unrecognized
	return names[role];
}
