interface EventHandlerDeps {
  client: any;
  directory: string;
  sessions: Map<string, { active: boolean; step: number }>;
}

export function createEventHandler(deps: EventHandlerDeps) {
  return async (event: any) => {
    if (event.type === "command.executed") {
      const { command, args } = event.data;
      if (command === "/task") {
        // Kick off mission
        console.error(`[ollama-orchestrator] Starting mission: ${args}`);
        await startMission(deps, args);
      }
    }
    return event;
  };
}

async function startMission(
  deps: EventHandlerDeps,
  description: string
) {
  const { client, directory } = deps;

  // Phase 1: Planner creates todos
  const plannerSession = await client.v2.session.create({
    directory,
    title: `Plan: ${description.slice(0, 40)}`,
    agent: "planner",
  });

  deps.sessions.set(plannerSession.id, { active: true, step: 1 });

  // Send planning prompt
  await client.v2.session.prompt({
    sessionID: plannerSession.id,
    directory,
    parts: [{ type: "text", text: `Create plan for: ${description}` }],
  });

  // Phase 2: Workers (simplified sequential for now)
  // In production, this would parse todos.md and dispatch workers
  console.error(`[ollama-orchestrator] Mission started. Planner session: ${plannerSession.id}`);
}
