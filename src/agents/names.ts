/**
 * Default agent identifiers. Users can override these names via opencode.json
 * under "plugin".
 */
export const DEFAULT_AGENT_NAMES = {
  STRATEGIST: "strategist",
  ARCHITECT: "architect",
  ENGINEER: "engineer",
  AUDITOR: "auditor",
  SPECIALIST: "specialist",
} as const;

export type AgentRole =
  | "strategist"
  | "architect"
  | "engineer"
  | "auditor"
  | "specialist";

export type AgentName = (typeof DEFAULT_AGENT_NAMES)[keyof typeof DEFAULT_AGENT_NAMES];
