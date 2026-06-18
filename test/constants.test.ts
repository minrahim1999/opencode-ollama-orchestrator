/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { DEFAULT_NAMES, resolveAgentAlias } from "../src/utils/constants";

describe("resolveAgentAlias", () => {
	it("maps legacy aliases to new names", () => {
		expect(resolveAgentAlias("planner", DEFAULT_NAMES)).toBe("architect");
		expect(resolveAgentAlias("worker", DEFAULT_NAMES)).toBe("engineer");
		expect(resolveAgentAlias("reviewer", DEFAULT_NAMES)).toBe("auditor");
		expect(resolveAgentAlias("expert", DEFAULT_NAMES)).toBe("specialist");
		expect(resolveAgentAlias("commander", DEFAULT_NAMES)).toBe("strategist");
	});

	it("passes through custom configured names", () => {
		const custom = { ...DEFAULT_NAMES, engineer: "coder" };
		expect(resolveAgentAlias("coder", custom)).toBe("coder");
	});

	it("passes through unknown as-is", () => {
		expect(resolveAgentAlias("custom-agent", DEFAULT_NAMES)).toBe(
			"custom-agent",
		);
	});
});

describe("DEFAULT_NAMES", () => {
	it("has all six roles", () => {
		expect(Object.keys(DEFAULT_NAMES)).toEqual([
			"strategist",
			"architect",
			"engineer",
			"auditor",
			"specialist",
			"spark",
		]);
	});
});
