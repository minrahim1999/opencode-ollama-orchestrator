export const COMMANDS = {
  TASK: "/task",
  PLAN: "/plan",
  AGENTS: "/agents",
  STATUS: "/status",
  DELEGATE: "/delegate",
  RETRY: "/retry",
  ABORT: "/abort",
} as const;

export type CommandKey = (typeof COMMANDS)[keyof typeof COMMANDS];

export const COMMAND_DESCRIPTIONS: Record<CommandKey, string> = {
  "/task": "Start a new mission with description",
  "/plan": "Regenerate or view current mission plan",
  "/agents": "List all orchestrator agents and their states",
  "/status": "Show mission progress, todos, and sessions",
  "/delegate": "Manually delegate a task to an agent",
  "/retry": "Retry failed tasks with adjusted strategy",
  "/abort": "Abort current mission and clean up sessions",
};

export const COMMAND_AGENTS: Record<CommandKey, string> = {
  "/task": "strategist",
  "/plan": "architect",
  "/agents": "auditor",
  "/status": "strategist",
  "/delegate": "strategist",
  "/retry": "strategist",
  "/abort": "strategist",
};
