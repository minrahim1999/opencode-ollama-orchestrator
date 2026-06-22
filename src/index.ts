import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { AGENTS } from "./agents/index.js";
import { createConfigHandler } from "./core/config-handler.js";
import { createChatMessageHandler } from "./core/event-handler.js";
import { AutomationController } from "./core/fast-mode.js";
import type { GuardResult } from "./core/hallucination-guard.js";
import { validateWrite } from "./core/hallucination-guard.js";
import { MissionController } from "./core/mission-controller.js";
import { resolveModeConfig } from "./core/mode.js";
import {
	DEFAULT_PONYTAIL_LEVEL,
	getPonytailInstructions,
	normalizePonytailLevel,
} from "./core/ponytail.js";
import { TokenBudgetManager } from "./core/token-budget.js";
import { createDelegateTaskTool } from "./tools/delegate-task.js";
import { Logger } from "./utils/logger.js";

const plugin: Plugin = async (input) => {
	const { client, directory } = input;
	const sessions = new Map<string, import("./core/types.js").SessionInfo>();

	// Load orchestrator config
	const { loadOrchestratorConfig } = await import("./utils/constants.js");
	const cfg = loadOrchestratorConfig(directory);

	const modeCfg = resolveModeConfig(
		cfg.automation,
		cfg.automationMode as unknown as Partial<
			import("./core/mode.js").ModeRuntimeConfig
		>,
	);
	Logger.log(
		"info",
		"plugin",
		`Orchestrator starting — automation: ${cfg.automation ? "ON" : "OFF"}`,
		{ automation: cfg.automation },
	);

	// Resolve ponytail level from plugin config
	const ponytailLevel = normalizePonytailLevel(cfg.ponytailLevel);
	if (ponytailLevel !== "off") {
		Logger.log("info", "plugin", `Ponytail active at ${ponytailLevel} level`, {
			ponytailLevel,
		});
	}

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

	// Automation controller — active only when automation is ON
	let autoController: AutomationController | undefined;
	if (cfg.automation) {
		autoController = new AutomationController({
			config: modeCfg,
			onMissionExecute: async (_slug: string) => {
				Logger.log("info", "automation", `Executing mission: ${_slug}`);
			},
			guardFn: modeCfg.preWriteAudit
				? (response: string, scope: string[]): GuardResult =>
						validateWrite(
							directory,
							response,
							scope,
							modeCfg.confidenceThreshold,
						)
				: undefined,
			budgetMgr: new TokenBudgetManager({
				maxTokensPerTask: modeCfg.maxTokensPerTask,
				contextWindowBudget: modeCfg.contextWindowBudget,
				enableAutoSummarize: modeCfg.enableAutoSummarize,
				maxTokensPerResponse: modeCfg.maxTokensPerResponse,
			}),
			notifyConfig: cfg.notify as any,
		});
		autoController.startWatch(5000);
		Logger.log("info", "plugin", "Automation watcher started");
	}

	return {
		config: createConfigHandler({ agents: AGENTS }),
		"chat.message": createChatMessageHandler(controller),
		tool: {
			delegate_task: createDelegateTaskTool({ client, directory, sessions }),
			start_mission: tool({
				description:
					"Start a multi-agent mission pipeline. The architect will create a plan, engineers will execute tasks in parallel, and the auditor will verify critical-path work. Call this AFTER the user confirms via the question tool. Returns immediately — the mission runs in the background.",
				args: {
					description: tool.schema
						.string()
						.describe(
							"Full task description — what the mission should accomplish",
						),
				},
				execute: async (args: { description: string }) => {
					controller.start(args.description, true).catch((err) => {
						Logger.log(
							"error",
							"start_mission",
							`Mission failed: ${String(err).slice(0, 200)}`,
							{
								description: args.description.slice(0, 80),
							},
						);
					});
					return `Mission started in background: ${args.description.slice(0, 80)}. You will be notified when it completes.`;
				},
			}),
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
					if (autoController) {
						lines.push("--- Automation ---");
						lines.push(...autoController.status());
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
			auto_run: tool({
				description:
					"Queue a mission for autonomous execution (24/7, single-worker, hallucination guard, token budget). Requires automation: true.",
				args: {
					slug: tool.schema
						.string()
						.describe("Mission slug (e.g. fix-auth-bug)"),
					description: tool.schema
						.string()
						.describe("Short description of the mission"),
				},
				execute: async (args: { slug: string; description: string }) => {
					if (!autoController) {
						return "Automation is not enabled. Set \"automation\": true in opencode.json plugin config.";
					}
					autoController.enqueue(args.slug, args.description);
					return `Mission '${args.slug}' queued for autonomous execution.`;
				},
			}),
			toggle_automation: tool({
				description:
					"Toggle automation on/off. When off (default), the orchestrator requires human interaction and phase gate approvals. When on, missions run fully autonomously with no human gates. Restart OpenCode for full effect.",
				args: {
					automation: tool.schema
						.boolean()
						.describe("true = fully autonomous (no human gates), false = human interaction (default)"),
				},
				execute: async (args: { automation: boolean }) => {
					return `Automation set to ${args.automation ? "ON (fully autonomous)" : "OFF (human interaction)"}. Restart OpenCode for the change to take full effect.`;
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
		"experimental.chat.system.transform": async (_input, output) => {
			if (ponytailLevel === "off") return;
			const instructions = getPonytailInstructions(ponytailLevel);
			if (instructions) {
				output.system.push(instructions);
			}
		},
	};
};

export default plugin;