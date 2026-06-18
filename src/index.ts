import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { AGENTS } from "./agents/index.js";
import { createConfigHandler } from "./core/config-handler.js";
import { createEventHandler } from "./core/event-handler.js";
import { MissionController } from "./core/mission-controller.js";
import { createDelegateTaskTool } from "./tools/delegate-task.js";
import { Logger } from "./utils/logger.js";
import { resolveModeConfig } from "./core/mode.js";
import { FastModeController } from "./core/fast-mode.js";
import { TokenBudgetManager } from "./core/token-budget.js";
import { validateWrite } from "./core/hallucination-guard.js";
import type { GuardResult } from "./core/hallucination-guard.js";

const plugin: Plugin = async (input) => {
	const { client, directory } = input;
	const sessions = new Map<string, import("./core/types.js").SessionInfo>();

	// Load orchestrator config for notify/rateLimit/mode options
	const { loadOrchestratorConfig } = await import("./utils/constants.js");
	const cfg = loadOrchestratorConfig(directory);

	const modeCfg = resolveModeConfig(cfg.mode, cfg.fastMode as unknown as Partial<import("./core/mode.js").ModeRuntimeConfig>);
	Logger.log("info", "plugin", `Orchestrator starting in ${modeCfg.mode} mode`, { mode: modeCfg.mode });

	// Single shared MissionController for both events and tools
	const controller = new MissionController(
		{ client, directory, sessions },
		cfg.notify
			? {
					notify: cfg.notify as any,
					rateLimitCapacity: cfg.rateLimitCapacity,
					rateLimitRefill: cfg.rateLimitRefill,
				}
			: undefined,
	);

	// Fast Mode controller — active only when in fast mode
	let fastController: FastModeController | undefined;
	if (modeCfg.mode === "fast") {
		fastController = new FastModeController({
			config: modeCfg,
			onMissionExecute: async (_slug: string) => {
				Logger.log("info", "fast-mode", `Executing mission: ${_slug}`);
			},
			guardFn: modeCfg.preWriteAudit
				? (response: string, scope: string[]): GuardResult =>
					validateWrite(directory, response, scope, modeCfg.confidenceThreshold)
				: undefined,
			budgetMgr: new TokenBudgetManager({
				maxTokensPerTask: modeCfg.maxTokensPerTask,
				contextWindowBudget: modeCfg.contextWindowBudget,
				enableAutoSummarize: modeCfg.enableAutoSummarize,
				maxTokensPerResponse: modeCfg.maxTokensPerResponse,
			}),
			notifyConfig: cfg.notify as any,
		});
		fastController.startWatch(5000);
		Logger.log("info", "plugin", "Fast Mode watcher started");
	}

	return {
		config: createConfigHandler({ agents: AGENTS }),
		event: createEventHandler(controller),
		tool: {
			delegate_task: createDelegateTaskTool({ client, directory, sessions }),
			abort_mission: tool({
				description:
					"Abort all active orchestrator missions and mark them failed.",
				args: {},
				execute: async () => {
					controller.abort();
					return "All active missions aborted.";
				},
			}),
			mission_status: tool({
				description:
					"Show current orchestrator mission and session status summary.",
				args: {},
				execute: async () => {
					const missionLines = controller.status();
					const sessionLines = controller.sessionSummary();
					const lines = [missionLines, "--- Sessions ---", ...sessionLines];
					if (fastController) {
						lines.push("--- Fast Mode ---");
						lines.push(...fastController.status());
					}
					return lines.join("\n");
				},
			}),
			skip_task: tool({
				description:
					"Skip a specific task in the current mission by task ID. Marks it as completed so execution continues past it.",
				args: {
					missionSlug: tool.schema
						.string()
						.describe("Mission slug (e.g. build-login-page)"),
					taskId: tool.schema
						.string()
						.describe("Task ID to skip (e.g. TASK-003)"),
				},
				execute: async (args: { missionSlug: string; taskId: string }) => {
					const ok = controller.skipTask(args.missionSlug, args.taskId);
					return ok
						? `Task ${args.taskId} skipped in mission ${args.missionSlug}`
						: `Mission or task not found.`;
				},
			}),
			resume_from: tool({
				description:
					"Resume mission execution from a specific task ID. Marks all prior tasks as completed.",
				args: {
					missionSlug: tool.schema
						.string()
						.describe("Mission slug (e.g. build-login-page)"),
					taskId: tool.schema
						.string()
						.describe("Task ID to resume from (e.g. TASK-003)"),
				},
				execute: async (args: { missionSlug: string; taskId: string }) => {
					const ok = controller.resumeFrom(args.missionSlug, args.taskId);
					return ok
						? `Resuming mission ${args.missionSlug} from ${args.taskId}`
						: `Mission or task not found.`;
				},
			}),
			check_watchdog: tool({
				description:
					"Run the session watchdog — detect and kill any sessions stuck for >15 minutes.",
				args: {},
				execute: async () => {
					controller.checkWatchdog();
					return "Watchdog check complete. Check logs for any stuck sessions.";
				},
			}),
			revert_mission: tool({
				description:
					"Revert a mission to its pre-mission state using the stored backup. Aborts the mission and restores files.",
				args: {
					missionSlug: tool.schema
						.string()
						.describe("Mission slug to revert (e.g. build-login-page)"),
				},
				execute: async (args: { missionSlug: string }) => {
					const ok = controller.revertMission(args.missionSlug);
					return ok
						? `Mission ${args.missionSlug} reverted to pre-mission state.`
						: `Failed to revert mission ${args.missionSlug}. Check logs for details.`;
				},
			}),
			fast_run: tool({
				description:
					"Queue a mission for Fast Mode execution (24/7 autonomous, single-worker, hallucination guard, token budget).",
				args: {
					slug: tool.schema
						.string()
						.describe("Mission slug (e.g. fix-auth-bug)"),
					description: tool.schema
						.string()
						.describe("Short description of the mission"),
				},
				execute: async (args: { slug: string; description: string }) => {
					if (!fastController) {
						return "Fast Mode is not enabled. Set plugin.fastMode.mode = 'fast' in opencode.json.";
					}
					fastController.enqueue(args.slug, args.description);
					return `Mission '${args.slug}' queued for fast execution.`;
				},
			}),
			set_orchestrator_mode: tool({
				description:
					"Switch orchestrator runtime mode between 'slow' (multi-agent, human gates) and 'fast' (24/7 autonomous, single-worker, guards). Restart OpenCode for full effect.",
				args: {
					mode: tool.schema
						.enum(["slow", "fast"])
						.describe("Target mode: slow or fast"),
				},
				execute: async (args: { mode: "slow" | "fast" }) => {
					return `Mode set to '${args.mode}'. Note: This records the request. Restart OpenCode for the mode switch to take full effect.`;
				},
			}),
		},
		"chat.params": async (_inp, output) => {
			const model = output.options?.model as string | undefined;
			if (model) {
				Logger.log("info", "plugin", `Chat model resolved to: ${model}`, {
					model,
				});
			}
		},
	};
};

export default plugin;
