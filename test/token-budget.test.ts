import { describe, expect, it } from "vitest";
import { TokenBudgetManager } from "../src/core/token-budget.js";

describe("TokenBudgetManager", () => {
	const mk = () =>
		new TokenBudgetManager({
			maxTokensPerTask: 1000,
			contextWindowBudget: 5000,
			enableAutoSummarize: true,
			maxTokensPerResponse: 500,
		});

	it("starts a task with full budget", () => {
		const mgr = mk();
		const snap = mgr.startTask("TASK-001");
		expect(snap.taskId).toBe("TASK-001");
		expect(snap.allowed).toBe(true);
		expect(snap.contextWindowRemaining).toBe(5000);
	});

	it("tracks consumption and reduces remaining", () => {
		const mgr = mk();
		mgr.startTask("TASK-001");
		const snap = mgr.consume("TASK-001", 400);
		expect(snap.allowed).toBe(true);
		expect(snap.contextWindowRemaining).toBe(4600);
		expect(snap.totalConsumed).toBe(400);
	});

	it("blocks when task budget exhausted", () => {
		const mgr = mk();
		mgr.startTask("TASK-001");
		mgr.consume("TASK-001", 900);
		const snap = mgr.consume("TASK-001", 200); // exceeds 1000
		expect(snap.allowed).toBe(false);
		expect(snap.reason).toContain("Task budget");
	});

	it("blocks when context window exhausted", () => {
		const mgr = mk();
		for (let i = 1; i <= 5; i++) {
			const tid = `TASK-${String(i).padStart(3, "0")}`;
			mgr.startTask(tid);
			mgr.consume(tid, 900);
		}
		mgr.startTask("TASK-006");
		mgr.consume("TASK-006", 500); // total now 5000
		mgr.startTask("TASK-007");
		const snap = mgr.check("TASK-007");
		expect(snap.allowed).toBe(false);
		expect(snap.reason).toContain("Context window");
	});

	it("signals summarize at 80% fill", () => {
		const mgr = mk();
		mgr.startTask("TASK-001");
		mgr.consume("TASK-001", 3999); // 79.9%
		expect(mgr.shouldSummarize()).toBe(false);
		mgr.consume("TASK-001", 2); // 80.02%
		expect(mgr.shouldSummarize()).toBe(true);
	});

	it("summarize resets context window", () => {
		const mgr = mk();
		mgr.startTask("TASK-001");
		mgr.consume("TASK-001", 4500);
		expect(mgr.shouldSummarize()).toBe(true);
		const cleared = mgr.summarize();
		expect(cleared.clearedWindow).toBeGreaterThan(0);
		expect(mgr.shouldSummarize()).toBe(false);
		const snap = mgr.check("TASK-002");
		expect(snap.contextWindowRemaining).toBe(5000);
	});

	it("estimateTokens approximates correctly", () => {
		expect(TokenBudgetManager.estimateTokens("hello world")).toBe(3);
		expect(TokenBudgetManager.estimateTokens("a".repeat(400))).toBe(100);
	});

	it("condenseMemory shrinks entries", () => {
		const entries = [
			{ taskId: "T1", summary: "Fix typo", filesChanged: ["readme.md"], issues: [] },
			{ taskId: "T2", summary: "Add test", filesChanged: ["test/foo.ts"], issues: ["flaky"] },
		];
		const condensed = TokenBudgetManager.condenseMemory(entries);
		expect(condensed).toContain("T1");
		expect(condensed).toContain("T2");
		expect(condensed).toContain("flaky");
	});
});
