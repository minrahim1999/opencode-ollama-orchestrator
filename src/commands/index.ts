export const COMMANDS = {
  TASK: "/task",
  AUTO: "/auto",
  PLAN: "/plan",
  AGENTS: "/agents",
  STATUS: "/status",
  DELEGATE: "/delegate",
  RETRY: "/retry",
  ABORT: "/abort",
  VERSION: "/version",
} as const;

export type CommandKey = (typeof COMMANDS)[keyof typeof COMMANDS];

export const COMMAND_DESCRIPTIONS: Record<CommandKey, string> = {
  "/task": "Start a new mission (manual step-through)",
  "/auto": "Start a fully automatic mission",
  "/plan": "Regenerate or view current mission plan",
  "/agents": "List all orchestrator agents and their states",
  "/status": "Show mission progress, todos, and sessions",
  "/delegate": "Manually delegate a task to an agent",
  "/retry": "Retry failed tasks with adjusted strategy",
  "/abort": "Abort current mission and clean up sessions",
  "/version": "Show plugin version",
};

export const COMMAND_AGENTS: Record<CommandKey, string> = {
  "/task": "strategist",
  "/auto": "strategist",
  "/plan": "architect",
  "/agents": "auditor",
  "/status": "strategist",
  "/delegate": "strategist",
  "/retry": "strategist",
  "/abort": "strategist",
  "/version": "strategist",
};
