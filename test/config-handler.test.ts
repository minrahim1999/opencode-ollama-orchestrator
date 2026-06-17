/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { AGENTS } from "../src/agents/index.js";
import { createConfigHandler } from "../src/core/config-handler.js";

// Minimal mock opencode.json agent config
const MOCK_USER_AGENT_CFG = {
	model: "ollama/deepseek-v4-pro",
	fallbackModel: "ollama/deepseek-v4-flash",
	smallModel: "ollama/gemini-3-flash-preview",
	temperature: 0.15,
	topP: 0.9,
	topK: 40,
	maxTokens: 16384,
	description: "Custom strategist",
	systemPrompt: "Override system prompt.",
	mode: "subagent" as const, // will be overridden by orchestrator to "primary"
	color: "#FF0000",
	tools: { bash: true, task: true, doom_loop: true },
	permission: {
		edit: "allow" as const,
		bash: "allow" as const,
		skill: { "*": "allow" },
	},
	skills: ["frontend-development", "dox-system"],
	thinking: { type: "enabled" as const, budgetTokens: 4000 },
	allowLoop: true,
	loopCount: 5,
};

describe("Config Handler — Full Agent Field Forwarding", () => {
	it("registers strategist as primary, rest as subagents", async () => {
		const config: any = {
			agent: {},
			commands: [],
			plugin: ["opencode-ollama-orchestrator"],
		};
		const handler = createConfigHandler({ agents: AGENTS });
		await handler(config);

		expect(config.agent.strategist.mode).toBe("primary");
		expect(config.agent.architect.mode).toBe("subagent");
		expect(config.agent.engineer.mode).toBe("subagent");
		expect(config.agent.auditor.mode).toBe("subagent");
		expect(config.agent.specialist.mode).toBe("subagent");
	});

	it("forwards every user-configurable field from opencode.json agent block", async () => {
		const config: any = {
			agent: { strategist: { ...MOCK_USER_AGENT_CFG } },
			commands: [],
			plugin: [["opencode-ollama-orchestrator", {}]],
		};

		const handler = createConfigHandler({ agents: AGENTS });
		await handler(config);

		const s = config.agent.strategist;
		expect(s.model).toBe("ollama/deepseek-v4-pro");
		expect(s.fallbackModel).toBe("ollama/deepseek-v4-flash");
		expect(s.smallModel).toBe("ollama/gemini-3-flash-preview");
		expect(s.temperature).toBe(0.15);
		expect(s.topP).toBe(0.9);
		expect(s.topK).toBe(40);
		expect(s.maxTokens).toBe(16384);
		expect(s.description).toBe("Custom strategist");
		expect(s.systemPrompt).toBe("Override system prompt.");
		expect(s.color).toBe("#FF0000");
		expect(s.tools).toEqual(
			expect.objectContaining({ bash: true, task: true, doom_loop: true }),
		);
		expect(s.permission.edit).toBe("allow");
		expect(s.permission.bash).toBe("allow");
		expect(s.skills).toEqual(["frontend-development", "dox-system"]);
		expect(s.thinking).toEqual({ type: "enabled", budgetTokens: 4000 });
		expect(s.allowLoop).toBe(true);
		expect(s.loopCount).toBe(5);
	});

	it("hard-sets mode to orchestrator value even if user specified differently", async () => {
		const config: any = {
			agent: { strategist: { ...MOCK_USER_AGENT_CFG, mode: "subagent" } },
			commands: [],
			plugin: [],
		};
		const handler = createConfigHandler({ agents: AGENTS });
		await handler(config);
		expect(config.agent.strategist.mode).toBe("primary");
	});

	it("clamps maxParallelWorkers to 3 regardless of user setting", async () => {
		const config: any = {
			agent: {},
			commands: [],
			plugin: [["opencode-ollama-orchestrator", { maxParallelWorkers: 99 }]],
		};
		const handler = createConfigHandler({ agents: AGENTS });
		await handler(config);
		expect(config.orchestrator.maxParallelWorkers).toBe(3);
	});

	it("preserves built-in agents by auto-renaming on collision", async () => {
		const config: any = {
			agent: {},
			commands: [],
			plugin: [
				[
					"opencode-ollama-orchestrator",
					{
						agents: {
							strategist: "compaction", // built-in collision
							architect: "explorer", // built-in collision
							engineer: "worker", // built-in collision
							auditor: "executor", // built-in collision
							specialist: "debugger", // built-in collision
						},
					},
				],
			],
		};

		const consoleWarnSpy = vi
			.spyOn(console, "warn")
			.mockImplementation(() => {});

		const handler = createConfigHandler({ agents: AGENTS });
		await handler(config);

		// Built-in names should be auto-renamed with orchestrator- prefix
		expect(config.agent["orchestrator-compaction"]).toBeDefined();
		expect(config.agent["orchestrator-explorer"]).toBeDefined();
		expect(config.agent["orchestrator-worker"]).toBeDefined();
		expect(config.agent["orchestrator-executor"]).toBeDefined();
		expect(config.agent["orchestrator-debugger"]).toBeDefined();

		// Original built-in keys should NOT be overwritten
		expect(config.agent.compaction).toBeUndefined();
		expect(config.agent.explorer).toBeUndefined();
		expect(config.agent.worker).toBeUndefined();
		expect(config.agent.executor).toBeUndefined();
		expect(config.agent.debugger).toBeUndefined();

		expect(consoleWarnSpy).toHaveBeenCalled();
		consoleWarnSpy.mockRestore();
	});

	it("loads plugin-level smallModel into orchestrator defaults", async () => {
		const config: any = {
			agent: { engineer: { model: "ollama/kimi-k2.7-code" } },
			commands: [],
			plugin: [
				[
					"opencode-ollama-orchestrator",
					{ smallModel: "ollama/gemini-3-flash-preview" },
				],
			],
		};
		const handler = createConfigHandler({ agents: AGENTS });
		await handler(config);
		expect(config.agent.engineer.smallModel).toBe(
			"ollama/gemini-3-flash-preview",
		);
	});

	it("forward plugin-level loop defaults", async () => {
		const config: any = {
			agent: {},
			commands: [],
			plugin: [
				[
					"opencode-ollama-orchestrator",
					{ defaultAllowLoop: true, defaultLoopCount: 4 },
				],
			],
		};
		const handler = createConfigHandler({ agents: AGENTS });
		await handler(config);
		expect(config.agent.strategist.allowLoop).toBe(true);
		expect(config.agent.strategist.loopCount).toBe(4);
	});
});
