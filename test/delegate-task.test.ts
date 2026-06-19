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
		it("passes per-agent model+agent on prompt (v2.5.0 fix)", async () => {
			const userConfig = {
				agent: {
					engineer: { model: "ollama/kimi-k2.7-code" },
				},
			};
			(readFileSync as any).mockReturnValue(JSON.stringify(userConfig));

			await tool.execute({ agent: "worker", task: "Implement auth" });

			// session.create should NOT have model or agent
			const createCall = mockClient.v2.session.create.mock.calls[0][0];
			expect(createCall.model).toBeUndefined();
			expect(createCall.agent).toBeUndefined();

			// session.prompt SHOULD have model and agent
			const promptCall = mockClient.v2.session.prompt.mock.calls[0][0];
			expect(promptCall.model).toEqual({
				providerID: "ollama",
				modelID: "kimi-k2.7-code",
			});
			expect(promptCall.agent).toBe("engineer");
		});

		it("falls back to global model on prompt when agent has no model", async () => {
			const userConfig = {
				model: "ollama/deepseek-v4-flash",
				agent: {
					architect: {},
				},
			};
			(readFileSync as any).mockReturnValue(JSON.stringify(userConfig));

			await tool.execute({ agent: "planner", task: "Plan auth" });

			const promptCall = mockClient.v2.session.prompt.mock.calls[0][0];
			expect(promptCall.model).toEqual({
				providerID: "ollama",
				modelID: "deepseek-v4-flash",
			});
			expect(promptCall.agent).toBe("architect");
		});

		it("passes through when no model is configured at all", async () => {
			(readFileSync as any).mockReturnValue("{}");

			await tool.execute({ agent: "engineer", task: "Build thing" });

			const createCall = mockClient.v2.session.create.mock.calls[0][0];
			expect(createCall.model).toBeUndefined();

			const promptCall = mockClient.v2.session.prompt.mock.calls[0][0];
			expect(promptCall.agent).toBe("engineer");
			expect(promptCall.model).toBeUndefined();
		});

		it("handles model strings with multiple slashes", async () => {
			const userConfig = {
				agent: {
					specialist: { model: "ollama/namespace/model-name" },
				},
			};
			(readFileSync as any).mockReturnValue(JSON.stringify(userConfig));

			await tool.execute({ agent: "expert", task: "Diagnose issue" });

			const promptCall = mockClient.v2.session.prompt.mock.calls[0][0];
			expect(promptCall.model).toEqual({
				providerID: "ollama",
				modelID: "namespace/model-name",
			});
		});

		it("includes parentID on session.create when provided", async () => {
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

			// parentID goes on session.create (SDK accepts it there)
			const createCall = mockClient.v2.session.create.mock.calls[0][0];
			expect(createCall.parentID).toBe("parent-456");

			// model+agent go on session.prompt
			const promptCall = mockClient.v2.session.prompt.mock.calls[0][0];
			expect(promptCall.model).toEqual({
				providerID: "ollama",
				modelID: "kimi-k2.6",
			});
		});
	});

	describe("alias resolution", () => {
		it("passes through recognized alias to resolved name on prompt", async () => {
			(readFileSync as any).mockReturnValue("{}");

			// "worker" is alias for "engineer", and no custom names configured
			await tool.execute({ agent: "worker", task: "Build thing" });

			const promptCall = mockClient.v2.session.prompt.mock.calls[0][0];
			expect(promptCall.agent).toBe("engineer");
		});
	});
});