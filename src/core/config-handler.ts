import { DEFAULT_AGENT_NAMES } from "../agents/index.js";
import type { AgentPrompts } from "../agents/index.js";
import type { AgentNameConfig, InheritedAgentConfig, PluginConfig } from "../types.js";

interface ConfigHandlerDeps {
  agents: AgentPrompts;
  pluginOptions?: PluginConfig;
}

/** Resolve final agent names from user config + defaults */
function resolveAgentNames(custom?: AgentNameConfig) {
  return {
    strategist: custom?.strategist ?? DEFAULT_AGENT_NAMES.STRATEGIST,
    architect: custom?.architect ?? DEFAULT_AGENT_NAMES.ARCHITECT,
    engineer: custom?.engineer ?? DEFAULT_AGENT_NAMES.ENGINEER,
    auditor: custom?.auditor ?? DEFAULT_AGENT_NAMES.AUDITOR,
    specialist: custom?.specialist ?? DEFAULT_AGENT_NAMES.SPECIALIST,
  };
}

/** Build agent config by merging user opencode.json settings with orchestrator defaults */
function buildAgentConfig(
  name: string,
  prompt: string,
  mode: "primary" | "subagent",
  userAgentConfig?: InheritedAgentConfig
) {
  const base = {
    description: `${name} agent for Ollama orchestrator`,
    mode: userAgentConfig?.mode ?? mode,
    prompt: userAgentConfig?.prompt ?? prompt,
    maxTokens: userAgentConfig?.maxTokens ?? 8192,
    color: userAgentConfig?.color ?? undefined,
  };

  // Merge inherited fields from user opencode.json agent config
  const inherited: Record<string, any> = {};
  if (userAgentConfig?.model) inherited.model = userAgentConfig.model;
  if (userAgentConfig?.fallbackModel) inherited.fallbackModel = userAgentConfig.fallbackModel;
  if (userAgentConfig?.temperature !== undefined) inherited.temperature = userAgentConfig.temperature;
  if (userAgentConfig?.topP !== undefined) inherited.topP = userAgentConfig.topP;
  if (userAgentConfig?.topK !== undefined) inherited.topK = userAgentConfig.topK;
  if (userAgentConfig?.thinking) inherited.thinking = userAgentConfig.thinking;
  if (userAgentConfig?.skills) inherited.skills = userAgentConfig.skills;
  if (userAgentConfig?.permission) inherited.permission = userAgentConfig.permission;
  if (userAgentConfig?.systemPrompt) inherited.systemPrompt = userAgentConfig.systemPrompt;

  return { ...inherited, ...base };
}

export function createConfigHandler(deps: ConfigHandlerDeps) {
  return async (config: any) => {
    if (!config.agent) config.agent = {};
    if (!config.commands) config.commands = [];

    // Resolve orchestrator-level plugin options from opencode.json
    const pluginOpts: PluginConfig =
      config.plugin?.find?.(
        (p: any) =>
          p === "opencode-ollama-orchestrator" ||
          (Array.isArray(p) && p[0] === "opencode-ollama-orchestrator")
      )?.[1] ?? {};

    const names = resolveAgentNames(pluginOpts?.agents);

    // Register ALL 5 agents — only Strategist is primary, rest are subagents
    const agentEntries: Array<[string, string, "primary" | "subagent"]> = [
      [names.strategist, deps.agents.STRATEGIST_PROMPT, "primary"],
      [names.architect, deps.agents.ARCHITECT_PROMPT, "subagent"],
      [names.engineer, deps.agents.ENGINEER_PROMPT, "subagent"],
      [names.auditor, deps.agents.AUDITOR_PROMPT, "subagent"],
      [names.specialist, deps.agents.SPECIALIST_PROMPT, "subagent"],
    ];

    for (const [name, prompt, mode] of agentEntries) {
      const userConfig: InheritedAgentConfig | undefined = config.agent[name];
      config.agent[name] = buildAgentConfig(name, prompt, mode, userConfig);
    }

    // Register orchestrator settings in config for runtime access
    // HARD enforce maxParallelWorkers = 3 (Ollama Pro limit)
    const userMaxParallel = pluginOpts.maxParallelWorkers;
    const enforcedMaxParallel = userMaxParallel === undefined
      ? 3
      : Math.min(Math.max(1, userMaxParallel), 3);

    config.orchestrator = {
      maxParallelWorkers: enforcedMaxParallel,  // NEVER exceeds 3
      maxRetries: Math.min(pluginOpts.maxRetries ?? 3, 5),
      verbose: pluginOpts.verbose ?? false,
      requireApproval: pluginOpts.requireApproval ?? false,
      maxSubagentDepth: Math.min(pluginOpts.maxSubagentDepth ?? 2, 3),
      agentNames: names,
    };

    // NO commands registered — plugin is fully automatic
    // We intentionally do NOT register any slash commands
  };
}
