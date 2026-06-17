/**
 * Core types for opencode-ollama-orchestrator
 * All user-configurable values are typed here for IntelliSense in opencode.json
 */

export interface OrchestratorConfig {
  /** Custom agent names (defaults provided) */
  agents?: AgentNameConfig;

  /** Max parallel subagent sessions (default: 5) */
  maxParallelWorkers?: number;

  /** Max retries per failed task (default: 3) */
  maxRetries?: number;

  /** Enable verbose mission logging */
  verbose?: boolean;

  /** Require approval before executing shell commands in subagents */
  requireApproval?: boolean;

  /** Subagent depth limit (default: 2) */
  maxSubagentDepth?: number;
}

export interface AgentNameConfig {
  /** Top-level mission orchestrator (default: "strategist") */
  strategist?: string;

  /** Task decomposition specialist (default: "architect") */
  architect?: string;

  /** Implementation engineer (default: "engineer") */
  engineer?: string;

  /** Output verifier (default: "auditor") */
  auditor?: string;

  /** Domain expert for deep delegation (default: "specialist") */
  specialist?: string;
}

/** Agent configuration that inherits from opencode.json */
export interface InheritedAgentConfig {
  /** Primary model — MUST start with "ollama/" */
  model?: string;

  /** Fallback model if primary is unavailable */
  fallbackModel?: string;

  /** Temperature for creativity vs determinism */
  temperature?: number;

  /** Top-p sampling */
  topP?: number;

  /** Top-k sampling */
  topK?: number;

  /** Max tokens per response */
  maxTokens?: number;

  /** Thinking mode configuration */
  thinking?: {
    type: "enabled" | "disabled";
    budgetTokens?: number;
  };

  /** Additional skills to load */
  skills?: string[];

  /** Custom prompt override (replaces default) */
  prompt?: string;

  /** System prompt additions (prepended to default) */
  systemPrompt?: string;

  /** Permission ruleset reference */
  permission?: string;

  /** Agent mode */
  mode?: "primary" | "subagent";

  /** Color for TUI display */
  color?: string;
}

/** Runtime agent state */
export interface AgentState {
  name: string;
  role: "strategist" | "architect" | "engineer" | "auditor" | "specialist";
  sessionId?: string;
  status: "idle" | "working" | "completed" | "failed";
  model: string;
  parentId?: string;
  depth: number;
}

/** Mission state tracker */
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

/** Plugin options passed from opencode.json */
export type PluginConfig = OrchestratorConfig;
