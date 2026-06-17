/**
 * Core orchestrator types — mission state, diagnostics, timeout config.
 */

/** Event handler dependencies */
export interface EventHandlerDeps {
  client: any;
  directory: string;
  sessions: Map<string, { active: boolean; step: number }>;
}

/** Why a task/mission got stuck */
export type StuckReason =
  | "timeout"
  | "loop"
  | "circular_deps"
  | "all_failed"
  | "stalled"
  | "resource_exhausted";

export interface DiagnosticReport {
  reason: StuckReason;
  taskId?: string;
  attempts: number;
  logs: string[];
  recommendation: string;
  suggestedStrategy: "retry" | "replan" | "simplify" | "escalate" | "abort";
}

export interface WatchdogConfig {
  taskTimeoutMs: number;
  missionTimeoutMs: number;
  stallThresholdMs: number;
  pollIntervalMs: number;
}

export const DEFAULT_WATCHDOG: WatchdogConfig = {
  taskTimeoutMs: 5 * 60 * 1000,
  missionTimeoutMs: 30 * 60 * 1000,
  stallThresholdMs: 10 * 60 * 1000,
  pollIntervalMs: 2000,
};

export interface MissionCtx {
  missionId: string;
  slug: string;
  description: string;
  missionDir: string;
  state: MissionState;
  todos: import("../utils/todo-parser.js").ParsedTodo[];
  retryCounts: Map<string, number>;
  loopCounts: Map<string, number>;
  diagnostics: DiagnosticReport[];
  startTime: number;
  lastProgressAt: number;
  completedAt?: number;
}

export type MissionState =
  | "idle"
  | "commissioning_plan"
  | "awaiting_plan"
  | "dispatching"
  | "executing"
  | "verifying"
  | "diagnosing"
  | "completed"
  | "failed"
  | "aborted";
