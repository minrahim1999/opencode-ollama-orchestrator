export { COMMANDER_PROMPT } from "./commander.js";
export { PLANNER_PROMPT } from "./planner.js";
export { WORKER_PROMPT } from "./worker.js";
export { REVIEWER_PROMPT } from "./reviewer.js";
export { AGENT_NAMES } from "./names.js";

import { COMMANDER_PROMPT } from "./commander.js";
import { PLANNER_PROMPT } from "./planner.js";
import { WORKER_PROMPT } from "./worker.js";
import { REVIEWER_PROMPT } from "./reviewer.js";

export type AgentPrompts = {
  COMMANDER_PROMPT: typeof COMMANDER_PROMPT;
  PLANNER_PROMPT: typeof PLANNER_PROMPT;
  WORKER_PROMPT: typeof WORKER_PROMPT;
  REVIEWER_PROMPT: typeof REVIEWER_PROMPT;
};

export const AGENTS: AgentPrompts = {
  COMMANDER_PROMPT,
  PLANNER_PROMPT,
  WORKER_PROMPT,
  REVIEWER_PROMPT,
};
