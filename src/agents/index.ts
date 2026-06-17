export { STRATEGIST_PROMPT } from "./strategist.js";
export { ARCHITECT_PROMPT } from "./architect.js";
export { ENGINEER_PROMPT } from "./engineer.js";
export { AUDITOR_PROMPT } from "./auditor.js";
export { SPECIALIST_PROMPT } from "./specialist.js";
export { DEFAULT_AGENT_NAMES, type AgentRole, type AgentName } from "./names.js";

import { STRATEGIST_PROMPT } from "./strategist.js";
import { ARCHITECT_PROMPT } from "./architect.js";
import { ENGINEER_PROMPT } from "./engineer.js";
import { AUDITOR_PROMPT } from "./auditor.js";
import { SPECIALIST_PROMPT } from "./specialist.js";

export type AgentPrompts = {
  STRATEGIST_PROMPT: typeof STRATEGIST_PROMPT;
  ARCHITECT_PROMPT: typeof ARCHITECT_PROMPT;
  ENGINEER_PROMPT: typeof ENGINEER_PROMPT;
  AUDITOR_PROMPT: typeof AUDITOR_PROMPT;
  SPECIALIST_PROMPT: typeof SPECIALIST_PROMPT;
};

export const AGENTS: AgentPrompts = {
  STRATEGIST_PROMPT,
  ARCHITECT_PROMPT,
  ENGINEER_PROMPT,
  AUDITOR_PROMPT,
  SPECIALIST_PROMPT,
};
