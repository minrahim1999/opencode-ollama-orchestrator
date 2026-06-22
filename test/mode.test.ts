import { describe, expect, it } from "vitest";
import { isFastTrackRequest, resolveModeConfig } from "../src/core/mode.js";

describe("Mode resolution", () => {
	it("returns manual defaults when no args given (automation off)", () => {
		const cfg = resolveModeConfig();
		expect(cfg.automation).toBe(false);
		expect(cfg.maxParallelWorkers).toBe(3);
		expect(cfg.enablePhaseGates).toBe(true);
		expect(cfg.evidenceRequired).toBe(false);
	});

	it("returns automation defaults when automation is on", () => {
		const cfg = resolveModeConfig(true);
		expect(cfg.automation).toBe(true);
		expect(cfg.maxParallelWorkers).toBe(1);
		expect(cfg.enablePhaseGates).toBe(false);
		expect(cfg.evidenceRequired).toBe(true);
		expect(cfg.preWriteAudit).toBe(true);
		expect(cfg.citeSources).toBe(true);
	});

	it("clamps bad user values", () => {
		const cfg = resolveModeConfig(true, {
			maxParallelWorkers: 10,
			maxRetries: 99,
			confidenceThreshold: 2.5,
			memoryRetentionTasks: -3,
		});
		expect(cfg.maxParallelWorkers).toBe(2); // automation cap
		expect(cfg.maxRetries).toBe(5);
		expect(cfg.confidenceThreshold).toBe(1);
		expect(cfg.memoryRetentionTasks).toBe(0);
	});

	it("merges user overrides on automation base", () => {
		const cfg = resolveModeConfig(true, {
			maxParallelWorkers: 2,
			confidenceThreshold: 0.9,
		});
		expect(cfg.maxParallelWorkers).toBe(2);
		expect(cfg.confidenceThreshold).toBe(0.9);
		expect(cfg.automation).toBe(true);
	});

	it("manual mode allows up to 3 parallel workers", () => {
		const cfg = resolveModeConfig(false, { maxParallelWorkers: 3 });
		expect(cfg.maxParallelWorkers).toBe(3);
	});

	it("automation mode caps at 2 parallel workers", () => {
		const cfg = resolveModeConfig(true, { maxParallelWorkers: 3 });
		expect(cfg.maxParallelWorkers).toBe(2);
	});
});

describe("isFastTrackRequest", () => {
	it("detects fix keywords", () => {
		expect(isFastTrackRequest("Fix the login bug")).toBe(true);
		expect(isFastTrackRequest("Add a hotfix for the crash")).toBe(true);
	});

	it("detects test/refactor keywords", () => {
		expect(isFastTrackRequest("Write unit tests for auth")).toBe(true);
		expect(isFastTrackRequest("Refactor the parser")).toBe(true);
	});

	it("ignores vague chat", () => {
		expect(isFastTrackRequest("Tell me about the project")).toBe(false);
		expect(isFastTrackRequest("What is this code doing?")).toBe(false);
	});
});