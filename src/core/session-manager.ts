/**
 * SessionManager — owns all session lifecycle logic for the orchestrator.
 *
 * Extracted from MissionController to reduce the god-class size.
 * Responsibilities:
 *   - createSession() + _createSessionInner(): model resolution, fallback, circuit breaker
 *   - promptSession(): sending prompts to sessions
 *   - pollSession(): polling for session completion
 *   - pollForFile(): polling for file creation
 *   - modelFailures / brokenModels / rateLimiter state
 *
 * The sessions Map<string, SessionInfo> is shared (lives in deps and is also
 * referenced by the event-handler and delegate-task tool). SessionManager
 * receives it in its constructor and mutates it in place — it is NOT owned
 * by SessionManager.
 */

import { existsSync } from "node:fs";
import { loadUserConfig, parseModel } from "../utils/config-loader.js";
import { Logger } from "../utils/logger.js";
import {
	createOllamaRateLimiter,
	TokenBucket,
} from "../utils/ratelimiter.js";
import type { SessionInfo } from "./types.js";

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 300; // 10 minutes

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SessionManagerDeps {
	client: any;
	directory: string;
	sessions: Map<string, SessionInfo>;
}

export class SessionManager {
	private client: any;
	private directory: string;
	private sessions: Map<string, SessionInfo>;
	private modelFailures = new Map<string, number>();
	private brokenModels = new Set<string>();
	private rateLimiter: TokenBucket;

	constructor(
		deps: SessionManagerDeps,
		opts?: {
			rateLimitCapacity?: number;
			rateLimitRefill?: number;
			maxParallelWorkers?: number;
		},
	) {
		this.client = deps.client;
		this.directory = deps.directory;
		this.sessions = deps.sessions;

		// Default rate limiter based on maxParallelWorkers (fallback: 3)
		const maxWorkers = opts?.maxParallelWorkers ?? 3;
		this.rateLimiter = createOllamaRateLimiter(maxWorkers);
		if (opts?.rateLimitCapacity && opts?.rateLimitRefill) {
			this.rateLimiter = new TokenBucket({
				capacity: opts.rateLimitCapacity,
				refillRate: opts.rateLimitRefill,
			});
		}
	}

	/* ─── Public session API ─── */

	async createSession(
		agent: string,
		title: string,
		taskId?: string,
		slug?: string,
	): Promise<{ id: string }> {
		// Rate limit: wait for capacity
		const acquired = await this.rateLimiter.waitForTokens(1, 50, 60000);
		if (!acquired) {
			Logger.log(
				"error",
				"rate-limit",
				`Rate limit exceeded creating session for ${agent}`,
				{ agent, title },
			);
			throw new Error(
				`Rate limit exceeded: could not acquire token for session creation`,
			);
		}
		return this._createSessionInner(agent, title, taskId, slug);
	}

	async promptSession(
		sessionID: string,
		agent: string,
		text: string,
	): Promise<void> {
		const userConfig = loadUserConfig();
		const agentConfig = userConfig?.agent?.[agent];
		let modelObj: { providerID: string; modelID: string } | null = null;
		if (agentConfig?.model) {
			modelObj = parseModel(agentConfig.model);
		}
		if (!modelObj && userConfig?.model) {
			modelObj = parseModel(userConfig.model);
		}
		const promptOpts: any = {
			sessionID: sessionID,
			directory: this.directory,
			agent,
			parts: [{ type: "text", text }],
		};
		if (modelObj) {
			promptOpts.model = modelObj;
			Logger.log("debug", "session", `promptSession for ${agent}`, {
				model: `${modelObj.providerID}/${modelObj.modelID}`,
			});
		}
		await this.client.v2.session.prompt(promptOpts);

		// Update session tracking
		const sess = this.sessions.get(sessionID);
		if (sess) {
			sess.promptsSent++;
			sess.lastPromptAt = Date.now();
			this.sessions.set(sessionID, sess);
		}
	}

	async pollSession(sessionId: string): Promise<void> {
		// Try SDK session.status API first (most reliable)
		try {
			const client = this.client;
			if (client?.v2?.session?.status) {
				for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
					await sleep(POLL_INTERVAL_MS);
					const result = await client.v2.session.status({
						query: { directory: this.directory },
					});
					const statuses = result.data as
						| Record<string, { status?: string }>
						| undefined;
					if (statuses?.[sessionId]) {
						const st = statuses[sessionId].status ?? "";
						if (st === "completed" || st === "failed" || st === "error") {
							// Mark as inactive in our map too
							const local = this.sessions.get(sessionId);
							if (local)
								this.sessions.set(sessionId, { ...local, active: false });
							return;
						}
					}
				}
				// SDK loop completed without finding terminal state — return to avoid double timeout
				Logger.log("warn", "session", `Session ${sessionId} SDK poll exhausted (${MAX_POLL_ATTEMPTS} attempts)`);
				return;
			}
		} catch {
			// SDK status API unavailable — fall through to local map polling
		}

		// Fallback: poll local session map (works if external code updates it)
		for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
			await sleep(POLL_INTERVAL_MS);
			const state = this.sessions.get(sessionId);
			if (!state?.active) return;
		}
		Logger.log("warn", "session", `Session ${sessionId} poll timeout`);
	}

	async pollForFile(filePath: string): Promise<void> {
		for (let i = 0; i < 150; i++) {
			if (existsSync(filePath)) return;
			await sleep(POLL_INTERVAL_MS);
		}
		throw new Error(`Timeout waiting for file: ${filePath}`);
	}

	/* ─── Circuit-breaker introspection (for tests / debugging) ─── */

	getModelFailures(): Map<string, number> {
		return this.modelFailures;
	}

	getBrokenModels(): Set<string> {
		return this.brokenModels;
	}

	getRateLimiter(): TokenBucket {
		return this.rateLimiter;
	}

	/* ─── Private helpers ─── */

	private async _createSessionInner(
		agent: string,
		title: string,
		taskId?: string,
		slug?: string,
	): Promise<{ id: string }> {
		const userConfig = loadUserConfig();
		const agentConfig = userConfig?.agent?.[agent];
		let modelObj: { providerID: string; modelID: string } | null = null;
		let fallbackModelObj: { providerID: string; modelID: string } | null = null;

		// Resolve primary model
		if (agentConfig?.model) {
			modelObj = parseModel(agentConfig.model);
		}
		if (!modelObj && userConfig?.model) {
			modelObj = parseModel(userConfig.model);
		}
		// Resolve fallback model
		if (agentConfig?.fallbackModel) {
			fallbackModelObj = parseModel(agentConfig.fallbackModel);
		}
		if (!fallbackModelObj && userConfig?.fallbackModel) {
			fallbackModelObj = parseModel(userConfig.fallbackModel);
		}
		// If no explicit fallback but primary model exists, try global default as fallback
		if (!fallbackModelObj && agentConfig?.model && userConfig?.model) {
			const parsed = parseModel(userConfig.model);
			if (parsed && parsed.modelID !== modelObj?.modelID) {
				fallbackModelObj = parsed;
			}
		}

		let session: { id: string } | null = null;
		let lastError: Error | null = null;

		const modelKey = modelObj
			? `${modelObj.providerID}/${modelObj.modelID}`
			: "";

		// Check circuit breaker
		const failures = this.modelFailures.get(modelKey) ?? 0;
		if (failures >= 5) {
			Logger.log(
				"warn",
				"circuit-breaker",
				`Circuit breaker OPEN for ${modelKey}`,
				{ failures, action: "skip_to_fallback" },
			);
			this.brokenModels.add(modelKey);
		} else {
			// Try primary model (or no model — let SDK use default)
			try {
				const opts: any = {
					directory: this.directory,
					title,
					agent,
				};
				if (modelObj) opts.model = modelObj;
				Logger.log("info", "session", `createSession for ${agent}`, {
					model: modelObj ? `${modelObj.providerID}/${modelObj.modelID}` : "default",
					primary: true,
				});
				session = await this.client.v2.session.create(opts);
			} catch (err) {
				lastError = err as Error;
				if (modelKey) {
					const failCount = (this.modelFailures.get(modelKey) ?? 0) + 1;
					this.modelFailures.set(modelKey, failCount);
					Logger.log(
						"warn",
						"session",
						`Primary model failed (${failCount}/5)`,
						{ model: modelKey, error: (err as Error).message },
					);
				}
			}
		}

		// Try fallback if primary failed
		if (!session && fallbackModelObj) {
			try {
				const opts: any = {
					directory: this.directory,
					title,
					agent,
					model: fallbackModelObj,
				};
				Logger.log("warn", "session", `createSession fallback for ${agent}`, {
					model: `${fallbackModelObj.providerID}/${fallbackModelObj.modelID}`,
					fallback: true,
				});
				session = await this.client.v2.session.create(opts);
				// Clear failure count since fallback succeeded
				if (modelKey) this.modelFailures.set(modelKey, 0);
			} catch (err) {
				lastError = err as Error;
				Logger.log("error", "session", `Fallback model also failed`, {
					model: `${fallbackModelObj.providerID}/${fallbackModelObj.modelID}`,
					error: (err as Error).message,
				});
			}
		}

		if (!session) {
			throw new Error(
				`[opencode-orchestrator] Failed to create session for ${agent}: ${lastError?.message ?? "unknown error"}. ` +
					`Primary: ${modelObj ? `${modelObj.providerID}/${modelObj.modelID}` : "none"}. ` +
					`Fallback: ${fallbackModelObj ? `${fallbackModelObj.providerID}/${fallbackModelObj.modelID}` : "none"}. ` +
					`Check model availability and provider connectivity.`,
			);
		}

		// Track session with full info
		this.sessions.set(session.id, {
			active: true,
			step: 1,
			agent,
			model: modelObj
				? `${modelObj.providerID}/${modelObj.modelID}`
				: "default",
			createdAt: Date.now(),
			promptsSent: 0,
			lastPromptAt: Date.now(),
			taskId,
			missionSlug: slug,
		});
		return session;
	}
}