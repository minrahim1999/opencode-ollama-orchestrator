import { tool } from "@opencode-ai/plugin";

interface DelegateTaskDeps {
  client: any;
  directory: string;
  sessions: Map<string, { active: boolean; step: number }>;
}

export function createDelegateTaskTool(deps: DelegateTaskDeps) {
  return tool({
    description: "Delegate a subtask to a dedicated agent session (planner, worker, or reviewer).",
    args: {
      agent: tool.schema.string().describe("Target agent: planner | worker | reviewer"),
      task: tool.schema.string().describe("Full task description with context"),
      parentSessionID: tool.schema.string().optional().describe("Parent mission session ID"),
    },
    async execute(args, ctx) {
      const supported = ["planner", "worker", "reviewer"];
      if (!supported.includes(args.agent)) {
        throw new Error(
          `[ollama-orchestrator] Unsupported agent "${args.agent}". Use: ${supported.join(", ")}`
        );
      }

      const session = await deps.client.v2.session.create({
        directory: deps.directory,
        title: `${args.agent}: ${args.task.slice(0, 50)}`,
        agent: args.agent,
        ...(args.parentSessionID ? { parentID: args.parentSessionID } : {}),
      });

      deps.sessions.set(session.id, { active: true, step: 1 });

      await deps.client.v2.session.prompt({
        sessionID: session.id,
        directory: deps.directory,
        parts: [{ type: "text", text: args.task }],
      });

      return `Delegated to ${args.agent}. Session: ${session.id}`;
    },
  });
}
