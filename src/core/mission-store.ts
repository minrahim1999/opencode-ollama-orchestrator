/**
 * MissionStore — owns all persistence/state-management logic for missions.
 *
 * Extracted from MissionController to reduce the god-class size.
 * Responsibilities:
 *   - saveMissionState(ctx): atomic write of state.json to mission directory
 *   - loadMissionsFromDisk(): scan .opencode/missions/ and restore executing/hold/retrying missions
 *   - startCleanup(): periodic cleanup of mission dirs older than 7 days
 *   - stopCleanup(): clear the cleanup interval
 *   - startMemoryPurge(): periodic purge of completed missions from memory map
 *
 * The missions Map<string, MissionCtx> is shared (lives in MissionController and is
 * used throughout start/resume/abort/status). MissionStore receives it in its
 * constructor and mutates it in place — it is NOT owned by MissionStore.
 */

import {
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { join } from "node:path";
import { writeFileAtomicSync } from "../utils/atomic.js";
import { Logger } from "../utils/logger.js";
import type { MissionCtx } from "./types.js";

export interface MissionStoreDeps {
	directory: string;
	missions: Map<string, MissionCtx>;
}

export class MissionStore {
	private directory: string;
	private missions: Map<string, MissionCtx>;
	cleanupInterval: ReturnType<typeof setInterval> | null = null;

	constructor(deps: MissionStoreDeps) {
		this.directory = deps.directory;
		this.missions = deps.missions;
	}

	/** Atomic write of state.json to the mission directory */
	saveMissionState(ctx: MissionCtx): void {
		const path = join(ctx.missionDir, "state.json");
		const data = JSON.stringify(
			{
				missionId: ctx.missionId,
				slug: ctx.slug,
				description: ctx.description,
				state: ctx.state,
				todos: ctx.todos,
				completedAt: ctx.completedAt,
				memory: ctx.memory,
			},
			null,
			2,
		);
		try {
			writeFileAtomicSync(path, data);
		} catch (err) {
			Logger.log(
				"error",
				"mission-controller",
				"Failed to save mission state",
				{ error: String(err) },
			);
		}
	}

	/** Scan .opencode/missions/ and restore executing/hold/retrying missions as idle */
	loadMissionsFromDisk(): void {
		try {
			const missionsDir = join(this.directory, ".opencode", "missions");
			if (!existsSync(missionsDir)) return;
			const entries = readdirSync(missionsDir, { withFileTypes: true });
			let restored = 0;
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				const statePath = join(missionsDir, entry.name, "state.json");
				if (!existsSync(statePath)) continue;
				try {
					const raw = readFileSync(statePath, "utf-8");
					const data = JSON.parse(raw);
					if (
						data.state === "executing" ||
						data.state === "hold" ||
						data.state === "retrying"
					) {
						const ctx: MissionCtx = {
							missionId: data.missionId,
							slug: data.slug,
							description: data.description,
							missionDir: join(missionsDir, entry.name),
							state: "idle",
							todos: data.todos || [],
							retryCounts: new Map(),
							completedAt: data.completedAt,
							memory: data.memory || [],
						};
						this.missions.set(ctx.missionId, ctx);
						restored++;
					}
				} catch {
					// Skip corrupted state files
				}
			}
			if (restored > 0) {
				Logger.log(
					"info",
					"mission-controller",
					`Restored ${restored} missions from disk`,
				);
			}
		} catch {
			// Ignore read errors
		}
	}

	/** Start periodic cleanup of old mission directories (runs on startup + daily) */
	startCleanup(): void {
		const DAYS = 7; // Keep missions for 7 days
		const MS_PER_DAY = 24 * 60 * 60 * 1000;

		const runCleanup = () => {
			try {
				const missionsDir = join(this.directory, ".opencode", "missions");
				if (!existsSync(missionsDir)) return;

				const now = Date.now();
				const entries = readdirSync(missionsDir, { withFileTypes: true });
				let cleaned = 0;

				for (const entry of entries) {
					if (!entry.isDirectory()) continue;
					const dirPath = join(missionsDir, entry.name);
					try {
						const stat = statSync(dirPath);
						const ageDays = (now - stat.mtimeMs) / MS_PER_DAY;
						if (ageDays > DAYS) {
							rmSync(dirPath, { recursive: true, force: true });
							cleaned++;
						}
					} catch {
						// Ignore cleanup errors for individual directories
					}
				}

				if (cleaned > 0) {
					Logger.log(
						"info",
						"mission-controller",
						`Cleaned up ${cleaned} mission directories older than ${DAYS} days`,
					);
				}
			} catch {
				// Ignore cleanup errors
			}
		};

		// Run once at startup, then daily
		runCleanup();
		this.cleanupInterval = setInterval(runCleanup, MS_PER_DAY);
	}

	/** Stop periodic cleanup */
	stopCleanup(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
	}

	/** Periodically purge completed missions from memory (runs on startup + hourly) */
	startMemoryPurge(): void {
		const HOUR = 60 * 60 * 1000;
		const purge = () => {
			try {
				const now = Date.now();
				let purged = 0;
				for (const [id, ctx] of Array.from(this.missions.entries())) {
					if (ctx.completedAt && now - ctx.completedAt > HOUR) {
						this.missions.delete(id);
						purged++;
					}
				}
				if (purged > 0) {
					Logger.log(
						"info",
						"mission-controller",
						`Purged ${purged} completed missions from memory`,
					);
				}
			} catch {
				// Ignore
			}
		};
		purge();
		setInterval(purge, HOUR);
	}
}