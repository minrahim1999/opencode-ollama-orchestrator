/**
 * Core types for opencode-ollama-orchestrator
 * Mirrors OpenCode opencode.json agent block + orchestrator-specific extensions.
 */

/**
 * Per-agent tool permission map.
 * OpenCode accepts either a flat Record<string, boolean> or nested objects.
 */
export interface AgentToolConfig {
	bash?: boolean;
	edit?: boolean;
	write?: boolean;
	read?: boolean;
	glob?: boolean;
	grep?: boolean;
	webfetch?: boolean;
	websearch?: boolean;
	list?: boolean;
	task?: boolean;
	question?: boolean;
	external_directory?: boolean;
	doom_loop?: boolean;
	[key: string]: boolean | undefined;
}

/**
 * Full agent configuration — EVERY field from opencode.json agent block
 * is forwarded transparently. Nothing is dropped or hidden.
 */
export interface AgentConfig {
	/** Primary model (uses whatever provider the user configures) */
	model?: string;

	/** Fallback model if primary is unavailable or errors */
	fallbackModel?: string;

	/** Lightweight / fast model for quick tasks */
	smallModel?: string;

	/** Temperature: 0.0 = deterministic, >1.0 = creative */
	temperature?: number;

	/** Top-p nucleus sampling */
	topP?: number;

	/** Top-k sampling */
	topK?: number;

	/** Max tokens per response */
	maxTokens?: number;

	/** Short description visible in agent switcher */
	description?: string;

	/** Full prompt override — replaces the orchestrator default */
	prompt?: string;

	/** System prompt additions (prepended to default, merged with prompt) */
	systemPrompt?: string;

	/** Agent mode — primary or subagent */
	mode?: "primary" | "subagent";

	/** TUI hex color */
	color?: string;

	/** Tool enable/disable flags */
	tools?: AgentToolConfig;

	/** Granular permission overrides */
	permission?: {
		edit?: "allow" | "deny";
		write?: "allow" | "deny" | Record<string, any>;
		bash?: "allow" | "deny";
		read?: "allow" | "deny";
		glob?: "allow" | "deny";
		grep?: "allow" | "deny";
		webfetch?: "allow" | "deny";
		websearch?: "allow" | "deny";
		list?: "allow" | "deny";
		task?: "allow" | "deny";
		question?: "allow" | "deny";
		external_directory?: "allow" | "deny";
		doom_loop?: "allow" | "deny";
		skill?: Record<string, any>;
		[key: string]: "allow" | "deny" | Record<string, any> | undefined;
	};

	/** Skills to load — array of skill names */
	skills?: string[];

	/** Thinking / reasoning budget */
	thinking?: {
		type: "enabled" | "disabled";
		budgetTokens?: number;
	};

	/** Orchestrator: whether this agent can loop (auto-retry same task) */
	allowLoop?: boolean;

	/** Orchestrator: max loop count before Specialist escalation */
	loopCount?: number;
}

/** Full agent name override map */
export interface AgentNameConfig {
	strategist?: string;
	architect?: string;
	engineer?: string;
	auditor?: string;
	specialist?: string;
	spark?: string;
}

/** Plugin-level configuration (nested inside plugin array) */
export interface OrchestratorConfig {
	/** Custom agent names */
	agents?: AgentNameConfig;

	/** Max parallel subagent sessions — HARD capped to 3 for Ollama Pro */
	maxParallelWorkers?: number;

	/** Max retries per failed task */
	maxRetries?: number;

	/** Enable verbose logging */
	verbose?: boolean;

	/** Require approval for shell commands in subagents */
	requireApproval?: boolean;

	/** Max subagent nesting depth */
	maxSubagentDepth?: number;

	/** DOX: write timestamped run records */
	doxEnabled?: boolean;

	/** DOX: auto-create .opencode/DOX on first mission */
	doxAutoInit?: boolean;

	/** DOX: append to AGENTS.md on mission completion */
	doxAutoCloseout?: boolean;

	/** Global small_model override (fast inference) */
	smallModel?: string;

	/** Global loop defaults */
	defaultAllowLoop?: boolean;
	defaultLoopCount?: number;
}

/**
 * Runtime operating mode for the orchestrator.
 *
 * - **slow** (default): Multi-agent, parallel, phase gates, human approvals, full quality.
 * - **fast**:  Autonomous 24/7, single-worker, hallucination guard, token budget,
 *              no human gates, auto-resume, aggressive task detection.
 */
export type OrchestratorMode = "slow" | "fast";

/** Plugin-level fast-mode overrides */
export interface FastModeConfig {
	/** Runtime mode selector */
	mode?: OrchestratorMode;

	/** Small-model overrides for fast mode agents */
	fastModels?: Partial<Record<string, string>>;

	/** Aggressive fast-track keyword detection (disable to always run full pipeline) */
	enableFastTrack?: boolean;

	/** Per-task token ceiling in fast mode */
	maxTokensPerTask?: number;

	/** Total context window budget before auto-summarize */
	contextWindowBudget?: number;

	/** Confidence threshold for hallucination guard (0.0–1.0) */
	confidenceThreshold?: number;

	/** Seconds before a fast-mode task is considered stalled */
	fastTaskTimeoutSec?: number;
}

export interface PluginConfig extends OrchestratorConfig {
	fastMode?: FastModeConfig;
}

/* ─── Runtime types (unchanged) ─── */

export interface AgentState {
	name: string;
	role: "strategist" | "architect" | "engineer" | "auditor" | "specialist";
	sessionId?: string;
	status: "idle" | "working" | "completed" | "failed";
	model: string;
	parentId?: string;
	depth: number;
}

export interface MissionState {
	id: string;
	description: string;
	status: "planning" | "executing" | "reviewing" | "completed" | "failed";
	agents: Map<string, AgentState>;
	todos: TodoItem[];
	createdAt: number;
	completedAt?: number;
}

export interface TodoItem {
	id: string;
	description: string;
	agent: string;
	dependsOn: string[];
	status: "pending" | "in_progress" | "completed" | "failed";
	criticalPath: boolean;
	acceptanceCriteria: string[];
	result?: string;
}
