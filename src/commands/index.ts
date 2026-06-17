export const COMMANDS = {
  TASK: "/task",
  PLAN: "/plan",
  AGENTS: "/agents",
  STATUS: "/status",
} as const;

export type CommandKey = (typeof COMMANDS)[keyof typeof COMMANDS];

export const COMMAND_DESCRIPTIONS: Record<CommandKey, string> = {
  "/task": "Start a new mission with task description",
  "/plan": "Generate or regenerate plan from current todos",
  "/agents": "List active orchestrator agents and their models",
  "/status": "Show mission progress and active sessions",
};

export const COMMAND_AGENTS: Record<CommandKey, string> = {
  "/task": "commander",
  "/plan": "planner",
  "/agents": "reviewer",
  "/status": "commander",
};
