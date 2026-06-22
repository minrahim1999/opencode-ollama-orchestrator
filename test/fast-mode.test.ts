import { describe, expect, it, vi } from "vitest";
import { AutomationController } from "../src/core/fast-mode.js";
import { resolveModeConfig } from "../src/core/mode.js";
import { TokenBudgetManager } from "../src/core/token-budget.js";

describe("AutomationController", () => {
	const makeCtrl = (onExec = vi.fn(async (_slug: string) => {})) => {
		const cfg = resolveModeConfig(true);
		return new AutomationController({
			config: cfg,
			onMissionExecute: onExec,
			budgetMgr: new TokenBudgetManager({
				maxTokensPerTask: cfg.maxTokensPerTask,
				contextWindowBudget: cfg.contextWindowBudget,
				enableAutoSummarize: cfg.enableAutoSummarize,
				maxTokensPerResponse: cfg.maxTokensPerResponse,
			}),
		});
	};

	it("enqueues and executes mission", async () => {
		const exec = vi.fn(async () => {});
		const ctrl = makeCtrl(exec);
		ctrl.enqueue("fix-typo", "Fix typo in README");
		await ctrl.tick();
		expect(exec).toHaveBeenCalledWith("fix-typo");
		const list = ctrl.list();
		expect(list[0].state).toBe("completed");
	});

	it("runs missions serially", async () => {
		const exec = vi.fn(async () => {});
		const ctrl = makeCtrl(exec);
		ctrl.enqueue("a", "First");
		ctrl.enqueue("b", "Second");
		await ctrl.tick();
		await ctrl.tick();
		expect(exec).toHaveBeenCalledTimes(2);
		const order = exec.mock.calls.map((c) => c[0] as string);
		expect(order).toEqual(["a", "b"]);
	});

	it("skips tick when mission is active", async () => {
		const exec = vi.fn(async () => {
			await new Promise((r) => setTimeout(r, 50));
		});
		const ctrl = makeCtrl(exec);
		ctrl.enqueue("slow", "Slow mission");
		const p1 = ctrl.tick();
		const p2 = ctrl.tick(); // should be no-op because active
		await Promise.all([p1, p2]);
		expect(exec).toHaveBeenCalledTimes(1);
	});

	it("does not re-enqueue same slug", () => {
		const ctrl = makeCtrl();
		ctrl.enqueue("dup", "Dup");
		ctrl.enqueue("dup", "Dup again");
		expect(ctrl.list()).toHaveLength(1);
	});

	it("pauses when token budget exhausted", async () => {
		const ctrl = makeCtrl();
		ctrl.getBudget()?.consume("T1", 20_000); // exceed budget
		ctrl.enqueue("big", "Big mission");
		await ctrl.tick();
		const m = ctrl.list()[0];
		expect(m.state).toBe("paused");
	});

	it("reports status with queue and elapsed", () => {
		const ctrl = makeCtrl();
		ctrl.enqueue("stat", "Stat");
		const lines = ctrl.status();
		expect(lines[0]).toContain("Automation");
		expect(lines[1]).toContain("Queue: 1");
		expect(lines[2]).toContain("stat: queued");
	});

	it("startWatch schedules interval", () => {
		const ctrl = makeCtrl();
		ctrl.startWatch(100);
		expect(ctrl.status()[0]).toContain("Automation");
		ctrl.stopWatch();
	});

	it("resumes paused mission", async () => {
		const ctrl = makeCtrl();
		ctrl.enqueue("paused", "Paused");
		// Force paused state by manipulating internal map
		const list = ctrl.list();
		list[0].state = "paused";
		expect(ctrl.resume("paused")).toBe(true);
		expect(list[0].state).toBe("queued");
	});

	it("resume returns false for non-paused", () => {
		const ctrl = makeCtrl();
		expect(ctrl.resume("missing")).toBe(false);
	});
});