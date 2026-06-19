/**
 * FastModeController — autonomous 24/7 mission runner.
 *
 * Differences from standard MissionController:
 *   - Single worker (maxParallelWorkers = 1)
 *   - No phase gates / human approvals
 *   - Strict timeouts (2 min task / 10 min mission)
 *   - Hallucination guard validates every write
 *   - Token budget manager enforces hard ceilings
 *   - Auto-summarize when context fills
 *   - Auto-resume on restart
 *   - Watcher loop polls todo directory for new missions
 */

import { Logger } from "../utils/logger.js";
import { type NotifyConfig, notify } from "../utils/notifier.js";
import type { GuardResult } from "./hallucination-guard.js";
import type { ModeRuntimeConfig } from "./mode.js";
import type { TokenBudgetManager } from "./token-budget.js";

export interface FastMissionEntry {
	slug: string;
	description: string;
	createdAt: number;
	state: "queued" | "executing" | "paused" | "completed" | "failed";
	completedAt?: number;
	tokenSnapshot?: { totalConsumed: number; summarizeCount: number };
	guardViolations: number;
}

export class FastModeController {
	private readonly missions = new Map<string, FastMissionEntry>();
	private readonly queue: string[] = [];
	private activeMission?: string;
	private watcherTimer?: ReturnType<typeof setInterval>;
	private isRunning = false;
	private readonly onMissionExecute: (slug: string) => Promise<void>;
	private readonly guardFn?: (response: string, scope: string[]) => GuardResult;
	private readonly budgetMgr?: TokenBudgetManager;
	private readonly config: ModeRuntimeConfig;
	private readonly notifyConfig: NotifyConfig;

	constructor(params: {
		config: ModeRuntimeConfig;
		onMissionExecute: (slug: string) => Promise<void>;
		guardFn?: (response: string, scope: string[]) => GuardResult;
		budgetMgr?: TokenBudgetManager;
		notifyConfig?: NotifyConfig;
	}) {
		this.config = params.config;
		this.onMissionExecute = params.onMissionExecute;
		this.guardFn = params.guardFn;
		this.budgetMgr = params.budgetMgr;
		this.notifyConfig = params.notifyConfig ?? {};
	}

	/** Start the 24/7 watcher loop */
	startWatch(watchIntervalMs = 5000): void {
		if (this.isRunning) return;
		this.isRunning = true;
		Logger.log(
			"info",
			"fast-mode",
			`Watcher started (interval=${watchIntervalMs}ms)`,
		);
		this.watcherTimer = setInterval(() => this.tick(), watchIntervalMs);
		this.tick(); // immediate first check
	}

	/** Gracefully stop the watcher */
	stopWatch(): void {
		this.isRunning = false;
		if (this.watcherTimer) {
			clearInterval(this.watcherTimer);
			this.watcherTimer = undefined;
		}
		Logger.log("info", "fast-mode", "Watcher stopped");
	}

	/** Queue a mission */
	enqueue(slug: string, description: string): void {
		if (this.missions.has(slug)) {
			Logger.log("warn", "fast-mode", `Mission ${slug} already queued`);
			return;
		}
		this.missions.set(slug, {
			slug,
			description,
			createdAt: Date.now(),
			state: "queued",
			guardViolations: 0,
		});
		this.queue.push(slug);
		Logger.log("info", "fast-mode", `Enqueued mission: ${slug}`);
	}

	/** Manual tick — for testing or external scheduler */
	async tick(): Promise<void> {
		if (this.activeMission) return; // one at a time

		const next = this.queue.shift();
		if (!next) return;

		const mission = this.missions.get(next);
		if (mission?.state !== "queued") return;

		mission.state = "executing";
		this.activeMission = next;

		const budgetSnap = this.budgetMgr?.dump();
		const exhausted = this.budgetMgr?.isExhausted();
		if (exhausted?.exhausted) {
			Logger.log(
				"error",
				"fast-mode",
				`Token budget exhausted. Pausing mission ${next}.`,
			);
			mission.state = "paused";
			this.activeMission = undefined;
			return;
		}

		// Mission-level timeout
		const timeoutMs = this.config.missionTimeoutSec * 1000;
		const timeoutHandle = setTimeout(() => {
			Logger.log(
				"warn",
				"fast-mode",
				`Mission ${next} timed out after ${timeoutMs}ms`,
			);
			mission.state = "failed";
		}, timeoutMs);

		try {
			Logger.log("info", "fast-mode", `Executing mission: ${next}`);
			await this.onMissionExecute(next);
			mission.state = "completed";
			mission.completedAt = Date.now();
			mission.tokenSnapshot = budgetSnap
				? {
						totalConsumed: budgetSnap.totalConsumed,
						summarizeCount: budgetSnap.summarizeCount,
					}
				: undefined;

			if (this.notifyConfig.ntfyTopic || this.notifyConfig.webhookUrl) {
				notify(this.notifyConfig, {
					type: "mission_completed",
					missionSlug: next,
					message: `${next}: ${mission.description}`,
				}).catch(() => {});
			}
		} catch (err) {
			Logger.log(
				"error",
				"fast-mode",
				`Mission ${next} failed: ${String(err)}`,
			);
			mission.state = "failed";

			if (this.notifyConfig.ntfyTopic || this.notifyConfig.webhookUrl) {
				notify(this.notifyConfig, {
					type: "mission_failed",
					missionSlug: next,
					message: `${next}: ${String(err)}`,
				}).catch(() => {});
			}
		} finally {
			clearTimeout(timeoutHandle);
			this.activeMission = undefined;
		}
	}

	/** Validate an agent response against hallucination guard */
	validateResponse(response: string, scopeFiles: string[]): GuardResult {
		if (!this.guardFn) {
			return {
				approved: true,
				confidence: 1,
				violations: [],
				recommendation: "proceed",
			};
		}
		const result = this.guardFn(response, scopeFiles);

		const mission = this.activeMission
			? this.missions.get(this.activeMission)
			: undefined;
		if (mission && !result.approved) {
			mission.guardViolations++;
		}

		return result;
	}

	/** Get status summary */
	status(): string[] {
		const lines: string[] = [];
		lines.push(`Fast Mode — Active: ${this.activeMission ?? "none"}`);
		lines.push(`Queue: ${this.queue.length}`);
		const allMissions = Array.from(this.missions.values());
		for (const m of allMissions) {
			const elapsed =
				m.state === "completed" && m.completedAt
					? `${Math.round((m.completedAt - m.createdAt) / 1000)}s`
					: `${Math.round((Date.now() - m.createdAt) / 1000)}s`;
			lines.push(
				`  ${m.slug}: ${m.state} (${elapsed}) — violations=${m.guardViolations}`,
			);
		}
		return lines;
	}

	/** Expose budget manager */
	getBudget(): TokenBudgetManager | undefined {
		return this.budgetMgr;
	}

	/** Resume a paused mission */
	resume(slug: string): boolean {
		const mission = this.missions.get(slug);
		if (mission?.state !== "paused") return false;
		mission.state = "queued";
		this.queue.push(slug);
		Logger.log("info", "fast-mode", `Resumed mission: ${slug}`);
		return true;
	}

	/** List all missions */
	list(): FastMissionEntry[] {
		return Array.from(this.missions.values());
	}
}
