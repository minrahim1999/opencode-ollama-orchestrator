/**
 * Core orchestrator types — mission state, diagnostics, timeout config.
 */

/** Event handler dependencies */
export interface EventHandlerDeps {
	client: any;
	directory: string;
	sessions: Map<string, SessionInfo>;
}

/** Session tracking info */
export interface SessionInfo {
	active: boolean;
	step: number;
	agent: string;
	model: string;
	createdAt: number;
	promptsSent: number;
	lastPromptAt: number;
	taskId?: string;
	missionSlug?: string;
}

/** Canonical mission state machine values (used by MissionController) */
export type MissionState =
	| "idle"
	| "planning"
	| "pending_dependencies"
	| "executing"
	| "auditing"
	| "completed"
	| "failed"
	| "retrying"
	| "hold";

/** Mission context — the runtime state of a single mission */
export interface MissionCtx {
	missionId: string;
	slug: string;
	description: string;
	missionDir: string;
	state: MissionState;
	todos: import("../utils/todo-parser.js").ParsedTodo[];
	retryCounts: Map<string, number>;
	completedAt?: number;
	backup?: {
		type: "git_stash" | "git_commit" | "directory" | "none";
		path?: string;
		commitHash?: string;
	};
	memory?: TaskMemoryEntry[];
}

/** Accumulated context from completed tasks */
export interface TaskMemoryEntry {
	taskId: string;
	agent: string;
	summary: string;
	filesChanged: string[];
	issues: string[];
	timestamp: number;
}