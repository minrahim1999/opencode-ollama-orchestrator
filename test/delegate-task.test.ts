/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDelegateTaskTool } from "../src/tools/delegate-task";
import { clearConfigCache } from "../src/utils/config-loader";

// Mock node:fs with partial mock — keep real fs but override readFileSync
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		readFileSync: vi.fn(),
	};
});

// Import mocked readFileSync AFTER mock is set up
import { readFileSync } from "node:fs";

describe("createDelegateTaskTool", () => {
	let tool: any;
	let mockClient: any;
	let sessions: Map<string, { active: boolean; step: number }>;

	beforeEach(() => {
		sessions = new Map();
		mockClient = {
			v2: {
				session: {
					create: vi.fn().mockResolvedValue({ id: "session-123" }),
					prompt: vi.fn().mockResolvedValue(undefined),
				},
			},
		};
		tool = createDelegateTaskTool({
			client: mockClient,
			directory: "/fake/project",
			sessions,
		});
		clearConfigCache(); // Clear config cache between tests
		});

		afterEach(() => {
		vi.clearAllMocks();
	});

	describe("model resolution", () => {
		it("uses per-agent model from user config", async () => {
			const userConfig = {
				agent: {
					engineer: { model: "ollama/kimi-k2.7-code" },
				},
			};
			(readFileSync as any).mockReturnValue(JSON.stringify(userConfig));

			await tool.execute({ agent: "worker", task: "Implement auth" });

			const createCall = mockClient.v2.session.create.mock.calls[0][0];
			expect(createCall.model).toEqual({
				providerID: "ollama",
				modelID: "kimi-k2.7-code",
			});
			expect(createCall.agent).toBe("engineer");
		});

		it("falls back to global model when agent has no model", async () => {
			const userConfig = {
				model: "ollama/deepseek-v4-flash",
				agent: {
					architect: {},
				},
			};
			(readFileSync as any).mockReturnValue(JSON.stringify(userConfig));

			await tool.execute({ agent: "planner", task: "Plan auth" });

			const createCall = mockClient.v2.session.create.mock.calls[0][0];
			expect(createCall.model).toEqual({
				providerID: "ollama",
				modelID: "deepseek-v4-flash",
			});
			expect(createCall.agent).toBe("architect");
		});

		it("passes through when no model is configured at all", async () => {
			(readFileSync as any).mockReturnValue("{}");

			await tool.execute({ agent: "engineer", task: "Build thing" });

			const createCall = mockClient.v2.session.create.mock.calls[0][0];
			expect(createCall.model).toBeUndefined();
			expect(createCall.agent).toBe("engineer");
		});

		it("handles model strings with multiple slashes", async () => {
			const userConfig = {
				agent: {
					specialist: { model: "ollama/namespace/model-name" },
				},
			};
			(readFileSync as any).mockReturnValue(JSON.stringify(userConfig));

			await tool.execute({ agent: "expert", task: "Diagnose issue" });

			const createCall = mockClient.v2.session.create.mock.calls[0][0];
			expect(createCall.model).toEqual({
				providerID: "ollama",
				modelID: "namespace/model-name",
			});
		});

		it("includes parentID when provided", async () => {
			const userConfig = {
				agent: {
					auditor: { model: "ollama/kimi-k2.6" },
				},
			};
			(readFileSync as any).mockReturnValue(JSON.stringify(userConfig));

			await tool.execute({
				agent: "reviewer",
				task: "Review code",
				parentSessionID: "parent-456",
			});

			const createCall = mockClient.v2.session.create.mock.calls[0][0];
			expect(createCall.parentID).toBe("parent-456");
			expect(createCall.model).toEqual({
				providerID: "ollama",
				modelID: "kimi-k2.6",
			});
		});
	});

	describe("alias resolution", () => {
		it("passes through recognized alias to resolved name", async () => {
			(readFileSync as any).mockReturnValue("{}");

			// "worker" is alias for "engineer", and no custom names configured
			await tool.execute({ agent: "worker", task: "Build thing" });

			const createCall = mockClient.v2.session.create.mock.calls[0][0];
			expect(createCall.agent).toBe("engineer");
		});
	});
});
