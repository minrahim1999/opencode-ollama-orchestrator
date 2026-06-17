export interface EventHandlerDeps {
  client: any;
  directory: string;
  sessions: Map<string, { active: boolean; step: number }>;
}
