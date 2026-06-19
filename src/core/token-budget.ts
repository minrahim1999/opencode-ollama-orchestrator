/**
 * TokenBudgetManager — tracks rolling token usage and enforces hard ceilings.
 *
 * In FAST mode:
 *   - Each task has a max token budget
 *   - Rolling context window tracked across tasks
 *   - Auto-summarize triggered when context window fills
 *   - Hard stop if total budget exceeded
 */

import { Logger } from "../utils/logger.js";

export interface TokenBudgetState {
	totalConsumed: number;
	contextWindowUsed: number;
	taskBudgets: Map<string, { consumed: number; remaining: number }>;
	summarizeCount: number;
}

export interface BudgetSnapshot {
	totalConsumed: number;
	contextWindowRemaining: number;
	taskId: string;
	allowed: boolean;
	reason?: string;
}

export class TokenBudgetManager {
	private state: TokenBudgetState;
	private readonly config: {
		maxTokensPerTask: number;
		contextWindowBudget: number;
		enableAutoSummarize: boolean;
		maxTokensPerResponse: number;
	};

	constructor(config: {
		maxTokensPerTask: number;
		contextWindowBudget: number;
		enableAutoSummarize: boolean;
		maxTokensPerResponse: number;
	}) {
		this.config = config;
		this.state = {
			totalConsumed: 0,
			contextWindowUsed: 0,
			taskBudgets: new Map(),
			summarizeCount: 0,
		};
	}

	/** Start tracking a new task */
	startTask(taskId: string): BudgetSnapshot {
		if (this.state.taskBudgets.has(taskId)) {
			return this.getSnapshot(taskId);
		}

		this.state.taskBudgets.set(taskId, {
			consumed: 0,
			remaining: this.config.maxTokensPerTask,
		});

		Logger.log(
			"debug",
			"token-budget",
			`Task ${taskId} started (budget=${this.config.maxTokensPerTask})`,
		);
		return this.getSnapshot(taskId);
	}

	/** Report consumption after a prompt/response round */
	consume(taskId: string, estimatedTokens: number): BudgetSnapshot {
		let taskBudget = this.state.taskBudgets.get(taskId);
		if (!taskBudget) {
			taskBudget = {
				consumed: 0,
				remaining: this.config.maxTokensPerTask,
			};
			this.state.taskBudgets.set(taskId, taskBudget);
		}

		taskBudget.consumed += estimatedTokens;
		taskBudget.remaining = Math.max(
			0,
			this.config.maxTokensPerTask - taskBudget.consumed,
		);
		this.state.totalConsumed += estimatedTokens;
		this.state.contextWindowUsed += estimatedTokens;

		const snap = this.getSnapshot(taskId);

		Logger.log(
			"debug",
			"token-budget",
			`Task ${taskId} consumed ${estimatedTokens} (remaining=${snap.contextWindowRemaining})`,
		);

		return snap;
	}

	/** Check if a task is still within budget */
	check(taskId: string): BudgetSnapshot {
		return this.getSnapshot(taskId);
	}

	/** True if context window is over 80% full → trigger summarize */
	shouldSummarize(): boolean {
		if (!this.config.enableAutoSummarize) return false;
		const ratio =
			this.state.contextWindowUsed / this.config.contextWindowBudget;
		return ratio >= 0.8;
	}

	/** Reset context window after summarization, preserve total count */
	summarize(): { clearedWindow: number; summarizeCount: number } {
		const cleared = this.state.contextWindowUsed;
		this.state.contextWindowUsed = 0;
		this.state.summarizeCount++;

		Logger.log(
			"info",
			"token-budget",
			`Context summarized. Cleared ${cleared} tokens (total consumed=${this.state.totalConsumed})`,
		);

		return {
			clearedWindow: cleared,
			summarizeCount: this.state.summarizeCount,
		};
	}

	/** Hard kill check — total mission budget exhausted */
	isExhausted(): { exhausted: boolean; totalConsumed: number; budget: number } {
		const exhausted =
			this.state.totalConsumed >= this.config.contextWindowBudget;
		return {
			exhausted,
			totalConsumed: this.state.totalConsumed,
			budget: this.config.contextWindowBudget,
		};
	}

	/** Estimate tokens from text (simple ~4 chars per token approximation) */
	static estimateTokens(text: string): number {
		return Math.ceil(text.length / 4);
	}

	/** Summarize previous tasks into a condensed context block */
	static condenseMemory(
		entries: Array<{
			taskId: string;
			summary: string;
			filesChanged: string[];
			issues: string[];
		}>,
	): string {
		const parts: string[] = [];
		for (const e of entries.slice(-3)) {
			const files =
				e.filesChanged.length > 0
					? `(${e.filesChanged.join(", ")})`
					: "(no file changes)";
			const issues =
				e.issues.length > 0 ? `[issues: ${e.issues.join(", ")}]` : "";
			parts.push(`- ${e.taskId}: ${e.summary} ${files} ${issues}`.trim());
		}
		return parts.join("\n");
	}

	/** Dump status for telemetry */
	dump(): TokenBudgetState {
		return {
			totalConsumed: this.state.totalConsumed,
			contextWindowUsed: this.state.contextWindowUsed,
			taskBudgets: new Map(this.state.taskBudgets),
			summarizeCount: this.state.summarizeCount,
		};
	}

	private getSnapshot(taskId: string): BudgetSnapshot {
		const task = this.state.taskBudgets.get(taskId);
		const consumed = task?.consumed ?? 0;
		const remaining = Math.max(
			0,
			this.config.contextWindowBudget - this.state.contextWindowUsed,
		);
		const allowed =
			consumed < this.config.maxTokensPerTask &&
			this.state.contextWindowUsed < this.config.contextWindowBudget;
		const reason = allowed
			? undefined
			: consumed >= this.config.maxTokensPerTask
				? `Task budget ${this.config.maxTokensPerTask} exhausted`
				: `Context window ${this.config.contextWindowBudget} exhausted`;

		return {
			totalConsumed: this.state.totalConsumed,
			contextWindowRemaining: remaining,
			taskId,
			allowed,
			reason,
		};
	}
}
