/** @vitest-environment node */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "../src/core/session-manager.js";
import { clearConfigCache } from "../src/utils/config-loader.js";

// Mock node:fs partially — keep real fs but override readFileSync for config loading
vi.mock("node:fs", async (importOriginal) => {
	const actual = (await importOriginal()) as any;
	return {
		...actual,
		readFileSync: vi.fn(),
		statSync: vi.fn(),
	};
});

import { readFileSync, statSync } from "node:fs";

describe("SessionManager", () => {
	let sm: SessionManager;
	let mockClient: any;
	let sessions: Map<string, any>;
	let tmpDir: string;

	beforeEach(() => {
		clearConfigCache();
		tmpDir = join(
			tmpdir(),
			`sm-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
		);
		mkdirSync(tmpDir, { recursive: true });

		sessions = new Map();
		mockClient = {
			v2: {
				session: {
					create: vi.fn().mockResolvedValue({ id: "session-123" }),
					prompt: vi.fn().mockResolvedValue(undefined),
					status: vi.fn().mockResolvedValue({ data: {} }),
					close: vi.fn().mockResolvedValue(undefined),
				},
			},
			tui: { showToast: vi.fn().mockResolvedValue(undefined) },
		};

		(readFileSync as any).mockReturnValue("{}");
		(statSync as any).mockImplementation(() => {
			throw new Error("ENOENT");
		});

		sm = new SessionManager({
			client: mockClient,
			directory: tmpDir,
			sessions,
		});
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
		vi.clearAllMocks();
	});

	describe("createSession", () => {
		it("creates a session without model/agent on create (v2.5.0 fix)", async () => {
			(statSync as any).mockImplementation(() => {
				throw new Error("ENOENT");
			});
			(readFileSync as any).mockReturnValue(
				JSON.stringify({
					agent: { engineer: { model: "ollama/kimi-k2.7-code" } },
				}),
			);

			const result = await sm.createSession("engineer", "Test task");
			expect(result.id).toBe("session-123");

			// session.create should NOT have model or agent (SDK doesn't accept them)
			const createCall = mockClient.v2.session.create.mock.calls[0][0];
			expect(createCall.model).toBeUndefined();
			expect(createCall.agent).toBeUndefined();
			expect(createCall.title).toBe("Test task");
		});

		it("passes model+agent on promptSession (v2.5.0 fix)", async () => {
			(statSync as any).mockImplementation(() => {
				throw new Error("ENOENT");
			});
			(readFileSync as any).mockReturnValue(
				JSON.stringify({
					agent: { engineer: { model: "ollama/kimi-k2.7-code" } },
				}),
			);

			await sm.createSession("engineer", "Test task");
			await sm.promptSession("session-123", "engineer", "Do the work");

			// session.prompt SHOULD have model and agent
			const promptCall = mockClient.v2.session.prompt.mock.calls[0][0];
			expect(promptCall.model).toEqual({
				providerID: "ollama",
				modelID: "kimi-k2.7-code",
			});
			expect(promptCall.agent).toBe("engineer");
		});

		it("falls back to global model when agent has no model", async () => {
			(readFileSync as any).mockReturnValue(
				JSON.stringify({
					model: "ollama/deepseek-v4-flash",
				}),
			);

			const result = await sm.createSession("engineer", "Test task");
			expect(result.id).toBe("session-123");

			// The model should be resolved for prompt, not create
			const createCall = mockClient.v2.session.create.mock.calls[0][0];
			expect(createCall.model).toBeUndefined();
		});

		it("creates session without model when none configured", async () => {
			(readFileSync as any).mockReturnValue("{}");

			const result = await sm.createSession("engineer", "Test task");
			expect(result.id).toBe("session-123");
		});

		it("throws when both primary and fallback fail", async () => {
			(readFileSync as any).mockReturnValue(
				JSON.stringify({
					agent: { engineer: { model: "ollama/broken-model" } },
					model: "ollama/also-broken",
				}),
			);
			mockClient.v2.session.create.mockRejectedValue(
				new Error("model not found"),
			);

			await expect(sm.createSession("engineer", "Test task")).rejects.toThrow();
		});

		it("tracks session in sessions map after creation", async () => {
			(readFileSync as any).mockReturnValue("{}");

			await sm.createSession("engineer", "Test task", "TASK-001", "test-slug");

			const tracked = sessions.get("session-123");
			expect(tracked).toBeDefined();
			expect(tracked.active).toBe(true);
			expect(tracked.agent).toBe("engineer");
			expect(tracked.taskId).toBe("TASK-001");
			expect(tracked.missionSlug).toBe("test-slug");
		});
	});

	describe("promptSession", () => {
		it("sends prompt to the session", async () => {
			(readFileSync as any).mockReturnValue("{}");
			await sm.createSession("engineer", "Test task");
			await sm.promptSession("session-123", "engineer", "Do the work");

			expect(mockClient.v2.session.prompt).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionID: "session-123",
					parts: [{ type: "text", text: "Do the work" }],
				}),
			);
		});

		it("updates promptsSent counter", async () => {
			(readFileSync as any).mockReturnValue("{}");
			await sm.createSession("engineer", "Test task");
			await sm.promptSession("session-123", "engineer", "First prompt");
			await sm.promptSession("session-123", "engineer", "Second prompt");

			const tracked = sessions.get("session-123");
			expect(tracked.promptsSent).toBe(2);
		});
	});

	describe("pollSession", () => {
		it("returns when SDK status shows completed", async () => {
			(readFileSync as any).mockReturnValue("{}");
			await sm.createSession("engineer", "Test task");

			mockClient.v2.session.status.mockResolvedValue({
				data: { "session-123": { status: "completed" } },
			});

			await sm.pollSession("session-123");

			const tracked = sessions.get("session-123");
			expect(tracked.active).toBe(false);
		});

		it("falls through to local map polling when SDK unavailable", async () => {
			(readFileSync as any).mockReturnValue("{}");
			await sm.createSession("engineer", "Test task");

			// Make SDK status throw
			mockClient.v2.session.status.mockRejectedValue(
				new Error("API unavailable"),
			);

			// Mark inactive via local map
			setTimeout(() => {
				const s = sessions.get("session-123");
				if (s) s.active = false;
			}, 100);

			await sm.pollSession("session-123");
		});
	});

	describe("pollForFile", () => {
		it("returns immediately when file exists", async () => {
			const filePath = join(tmpDir, "test-file.md");
			writeFileSync(filePath, "content");

			await sm.pollForFile(filePath);
			// Should not throw — file exists
		});

		it("throws timeout when file never appears", async () => {
			// Use vi.useFakeTimers to avoid real waiting
			vi.useFakeTimers();
			const filePath = join(tmpDir, "never-created.md");

			try {
				// pollForFile uses sleep which uses setTimeout — advance timers
				const promise = sm.pollForFile(filePath);
				// Catch the rejection immediately to prevent unhandled rejection
				const promiseCatch = promise.catch((e: Error) => e);
				// Advance all timers rapidly
				await vi.runAllTimersAsync();
				// Now check that it threw the expected error
				const error = await promiseCatch;
				expect(error).toBeInstanceOf(Error);
				expect((error as Error).message).toMatch(/Timeout waiting for file/);
			} finally {
				vi.useRealTimers();
			}
		});
	});

	describe("rate limiter", () => {
		it("getRateLimiter returns the token bucket", () => {
			const rl = sm.getRateLimiter();
			expect(rl).toBeDefined();
		});
	});

	describe("circuit breaker", () => {
		it("tracks model failures", async () => {
			(readFileSync as any).mockReturnValue(
				JSON.stringify({
					agent: { engineer: { model: "ollama/failing-model" } },
				}),
			);

			// Fail 6 times — 5th failure opens circuit breaker on 6th call
			mockClient.v2.session.create.mockRejectedValue(new Error("model down"));
			for (let i = 0; i < 6; i++) {
				try {
					await sm.createSession("engineer", "Test");
				} catch {}
			}

			const failures = sm.getModelFailures();
			expect(failures.get("ollama/failing-model")).toBeGreaterThanOrEqual(5);

			const broken = sm.getBrokenModels();
			expect(broken.has("ollama/failing-model")).toBe(true);
		});
	});
});
