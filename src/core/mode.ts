/**
 * Operating mode system for opencode-ollama-orchestrator.
 *
 * - **automation: false** (default): Human interaction. Multi-agent, parallel
 *   execution, phase gates, human approvals, full DOX, maximum quality.
 * - **automation: true**: Fully autonomous. Single-worker, strict token budgets,
 *   hallucination guards, no human gates, auto-resume, evidence-checked writes.
 */

/** Per-mode runtime settings derived from plugin config */
export interface ModeRuntimeConfig {
	automation: boolean;

	// Execution
	maxParallelWorkers: number;
	maxRetries: number;
	requireApproval: boolean;
	enablePhaseGates: boolean;

	// Token economy
	maxTokensPerTask: number;
	contextWindowBudget: number; // total tokens before forced summarize
	enableAutoSummarize: boolean;
	maxTokensPerResponse: number;

	// Hallucination guard
	evidenceRequired: boolean;
	confidenceThreshold: number; // 0.0–1.0
	preWriteAudit: boolean;
	citeSources: boolean;

	// Timeouts (seconds)
	taskTimeoutSec: number;
	missionTimeoutSec: number;
	stallThresholdSec: number;

	// Resilience
	autoResume: boolean;
	enableDox: boolean;
	memoryRetentionTasks: number; // how many completed tasks to keep

	// Model overrides for automation mode (use smaller/faster models)
	automationModelOverrides?: Partial<Record<string, string>>;
}

/** Default manual-mode config (automation off — human interaction) */
export const MANUAL_DEFAULTS: ModeRuntimeConfig = {
	automation: false,
	maxParallelWorkers: 3,
	maxRetries: 3,
	requireApproval: false,
	enablePhaseGates: true,

	maxTokensPerTask: 8192,
	contextWindowBudget: 32_000,
	enableAutoSummarize: false,
	maxTokensPerResponse: 8192,

	evidenceRequired: false,
	confidenceThreshold: 0.0,
	preWriteAudit: false,
	citeSources: false,

	taskTimeoutSec: 300,
	missionTimeoutSec: 1800,
	stallThresholdSec: 600,

	autoResume: true,
	enableDox: true,
	memoryRetentionTasks: 5,
};

/** Automation-mode defaults — conservative, autonomous, token-efficient */
export const AUTOMATION_DEFAULTS: ModeRuntimeConfig = {
	automation: true,
	maxParallelWorkers: 1,
	maxRetries: 2,
	requireApproval: false,
	enablePhaseGates: false,

	maxTokensPerTask: 4096,
	contextWindowBudget: 16_000,
	enableAutoSummarize: true,
	maxTokensPerResponse: 4096,

	evidenceRequired: true,
	confidenceThreshold: 0.75,
	preWriteAudit: true,
	citeSources: true,

	taskTimeoutSec: 120,
	missionTimeoutSec: 600,
	stallThresholdSec: 240,

	autoResume: true,
	enableDox: false,
	memoryRetentionTasks: 2,

	automationModelOverrides: {
		strategist: undefined,
		architect: undefined,
		engineer: undefined,
		auditor: undefined,
		specialist: undefined,
	},
};

/** Resolve effective runtime config from automation toggle + user overrides */
export function resolveModeConfig(
	automation = false,
	userOverrides?: Partial<ModeRuntimeConfig>,
): ModeRuntimeConfig {
	const base = automation ? AUTOMATION_DEFAULTS : MANUAL_DEFAULTS;
	const merged = { ...base, ...userOverrides, automation };

	// Sanity bounds
	merged.maxParallelWorkers = clamp(
		merged.maxParallelWorkers,
		1,
		automation ? 2 : 3,
	);
	merged.maxRetries = clamp(merged.maxRetries, 1, 5);
	merged.confidenceThreshold = clamp(merged.confidenceThreshold, 0, 1);
	merged.memoryRetentionTasks = clamp(merged.memoryRetentionTasks, 0, 10);

	return merged;
}

function clamp(v: number, min: number, max: number): number {
	return Math.min(Math.max(v, min), max);
}

/** Check if a task classification should trigger automation fast-track */
export function isFastTrackRequest(input: string): boolean {
	const fastKeywords = [
		"fix",
		"bug",
		"patch",
		"hotfix",
		"urgent",
		"test",
		"unit test",
		"integration test",
		"refactor",
		"rename",
		"move",
		"extract",
		"lint",
		"format",
		"biome",
		"eslint",
		"typo",
		"comment",
		"docstring",
	];
	const lower = input.toLowerCase();
	return fastKeywords.some((k) => lower.includes(k));
}