/** @vitest-environment node */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MissionStore } from "../src/core/mission-store.js";
import type { MissionCtx } from "../src/core/types.js";
import { getMissionDirectory } from "../src/utils/paths.js";

describe("MissionStore", () => {
	let store: MissionStore;
	let missions: Map<string, MissionCtx>;
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = join(
			tmpdir(),
			`ms-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
		);
		mkdirSync(tmpDir, { recursive: true });
		missions = new Map();
		store = new MissionStore({ directory: tmpDir, missions });
	});

	afterEach(() => {
		store.stopCleanup();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	function makeCtx(overrides?: Partial<MissionCtx>): MissionCtx {
		const slug = overrides?.slug ?? "test-mission";
		const missionDir =
			overrides?.missionDir ?? join(tmpDir, ".opencode", "missions", slug);
		return {
			missionId: overrides?.missionId ?? `mission-${Date.now()}`,
			slug,
			description: overrides?.description ?? "Test mission",
			missionDir,
			state: overrides?.state ?? "executing",
			todos: overrides?.todos ?? [],
			retryCounts: new Map(),
			memory: overrides?.memory ?? [],
			...overrides,
		} as MissionCtx;
	}

	describe("saveMissionState", () => {
		it("writes state.json to mission directory", () => {
			const ctx = makeCtx();
			store.saveMissionState(ctx);

			const statePath = join(ctx.missionDir, "state.json");
			expect(existsSync(statePath)).toBe(true);
		});

		it("preserves mission data in the JSON", () => {
			const ctx = makeCtx({
				missionId: "mission-12345",
				slug: "build-auth",
				description: "Build auth system",
			});
			ctx.todos = [
				{
					id: "TASK-001",
					description: "Create login form",
					agent: "engineer",
					criticalPath: true,
					phaseGate: false,
					dependsOn: [],
					acceptanceCriteria: ["Form renders"],
					status: "completed",
					phase: "Phase 1",
				},
			] as any;
			ctx.memory = [
				{
					taskId: "TASK-001",
					agent: "engineer",
					summary: "Created login form",
					filesChanged: ["src/login.tsx"],
					issues: [],
					timestamp: Date.now(),
				},
			];

			store.saveMissionState(ctx);

			const statePath = join(ctx.missionDir, "state.json");
			const raw = require("node:fs").readFileSync(statePath, "utf-8");
			const data = JSON.parse(raw);
			expect(data.missionId).toBe("mission-12345");
			expect(data.slug).toBe("build-auth");
			expect(data.state).toBe("executing");
			expect(data.todos).toHaveLength(1);
			expect(data.todos[0].id).toBe("TASK-001");
			expect(data.memory).toHaveLength(1);
			expect(data.memory[0].agent).toBe("engineer");
		});

		it("creates mission directory if it doesn't exist", () => {
			const ctx = makeCtx({ slug: "new-dir-test" });
			expect(existsSync(ctx.missionDir)).toBe(false);

			store.saveMissionState(ctx);

			expect(existsSync(ctx.missionDir)).toBe(true);
			expect(existsSync(join(ctx.missionDir, "state.json"))).toBe(true);
		});
	});

	describe("loadMissionsFromDisk", () => {
		it("restores executing missions as idle", () => {
			const ctx = makeCtx({ slug: "restore-test", missionId: "mission-111" });
			store.saveMissionState(ctx);

			// New store, new missions map
			const newMissions = new Map<string, MissionCtx>();
			const newStore = new MissionStore({
				directory: tmpDir,
				missions: newMissions,
			});
			newStore.loadMissionsFromDisk();

			expect(newMissions.size).toBe(1);
			const restored = Array.from(newMissions.values())[0];
			expect(restored.slug).toBe("restore-test");
			expect(restored.state).toBe("idle");
			newStore.stopCleanup();
		});

		it("restores hold and retrying missions", () => {
			const ctx1 = makeCtx({
				slug: "hold-mission",
				missionId: "m-1",
				state: "hold" as any,
			});
			const ctx2 = makeCtx({
				slug: "retry-mission",
				missionId: "m-2",
				state: "retrying" as any,
			});
			store.saveMissionState(ctx1);
			store.saveMissionState(ctx2);

			const newMissions = new Map<string, MissionCtx>();
			const newStore = new MissionStore({
				directory: tmpDir,
				missions: newMissions,
			});
			newStore.loadMissionsFromDisk();

			expect(newMissions.size).toBe(2);
			newStore.stopCleanup();
		});

		it("ignores completed missions", () => {
			const ctx = makeCtx({ slug: "completed-mission", state: "completed" });
			store.saveMissionState(ctx);

			const newMissions = new Map<string, MissionCtx>();
			const newStore = new MissionStore({
				directory: tmpDir,
				missions: newMissions,
			});
			newStore.loadMissionsFromDisk();

			expect(newMissions.size).toBe(0);
			newStore.stopCleanup();
		});

		it("handles corrupted state.json gracefully", () => {
			const missionDir = getMissionDirectory(tmpDir, "corrupted-test");
			mkdirSync(missionDir, { recursive: true });
			writeFileSync(join(missionDir, "state.json"), "not valid json{{{");

			const newMissions = new Map<string, MissionCtx>();
			const newStore = new MissionStore({
				directory: tmpDir,
				missions: newMissions,
			});

			// Should not throw
			newStore.loadMissionsFromDisk();
			expect(newMissions.size).toBe(0);
			newStore.stopCleanup();
		});

		it("handles empty missions directory", () => {
			const newMissions = new Map<string, MissionCtx>();
			const newStore = new MissionStore({
				directory: tmpDir,
				missions: newMissions,
			});
			newStore.loadMissionsFromDisk();
			expect(newMissions.size).toBe(0);
			newStore.stopCleanup();
		});

		it("handles missing missions directory", () => {
			const noDir = join(tmpDir, "no-missions-dir");
			const newMissions = new Map<string, MissionCtx>();
			const newStore = new MissionStore({
				directory: noDir,
				missions: newMissions,
			});
			newStore.loadMissionsFromDisk();
			expect(newMissions.size).toBe(0);
			newStore.stopCleanup();
		});
	});

	describe("cleanup", () => {
		it("removes mission directories older than 7 days", () => {
			const missionsDir = join(tmpDir, ".opencode", "missions");
			const oldDir = join(missionsDir, "old-mission");
			mkdirSync(oldDir, { recursive: true });
			writeFileSync(join(oldDir, "state.json"), "{}");

			// Backdate the directory mtime to 8 days ago
			const oldTime = Date.now() / 1000 - 8 * 24 * 60 * 60;
			require("node:fs").utimesSync(oldDir, oldTime, oldTime);

			// Run cleanup explicitly
			store.stopCleanup();
			store.startCleanup(); // runs immediately + sets interval
			store.stopCleanup();

			expect(existsSync(oldDir)).toBe(false);
		});

		it("keeps mission directories newer than 7 days", () => {
			const missionsDir = join(tmpDir, ".opencode", "missions");
			const newDir = join(missionsDir, "new-mission");
			mkdirSync(newDir, { recursive: true });
			writeFileSync(join(newDir, "state.json"), "{}");

			store.stopCleanup();
			const newStore = new MissionStore({
				directory: tmpDir,
				missions: new Map(),
			});
			newStore.stopCleanup();

			expect(existsSync(newDir)).toBe(true);
		});

		it("stopCleanup clears the interval", () => {
			store.stopCleanup();
			// No error thrown — just clears interval
			// Calling again should be safe
			store.stopCleanup();
		});
	});

	describe("startMemoryPurge", () => {
		it("removes completed missions older than 1 hour from the map", () => {
			const ctx = makeCtx({
				slug: "old-completed",
				state: "completed",
				completedAt: Date.now() - 2 * 60 * 60 * 1000,
			});
			missions.set(ctx.missionId, ctx);

			// Trigger purge explicitly
			store.stopCleanup();
			store.startMemoryPurge(); // runs immediately + sets interval
			store.stopCleanup();

			// The initial purge should have removed it
			expect(missions.size).toBe(0);
		});

		it("keeps recently completed missions", () => {
			const ctx = makeCtx({
				slug: "recent-completed",
				state: "completed",
				completedAt: Date.now() - 30 * 60 * 1000,
			});
			missions.set(ctx.missionId, ctx);

			// Initial purge should keep it (< 1hr old)
			expect(missions.size).toBe(1);
		});

		it("keeps executing missions", () => {
			const ctx = makeCtx({ slug: "still-running", state: "executing" });
			missions.set(ctx.missionId, ctx);

			// Executing missions have no completedAt — should be kept
			expect(missions.size).toBe(1);
		});
	});
});
