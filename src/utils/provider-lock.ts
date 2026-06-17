import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface OpencodeJson {
  model?: string;
  provider?: Record<string, { baseUrl?: string } & Record<string, any>>;
  agent?: Record<string, { model?: string } & Record<string, any>>;
}

function findConfigPath(): string | null {
  const candidates = [
    join(homedir(), ".config", "opencode", "opencode.json"),
    join(homedir(), ".opencode", "opencode.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function loadConfig(): OpencodeJson | null {
  const path = findConfigPath();
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as OpencodeJson;
  } catch {
    return null;
  }
}

/**
 * DEPRECATED: Provider lock is no longer enforced.
 * The orchestrator respects whatever model/provider the user has configured
 * in opencode.json. If no model is set, the currently active model is used.
 *
 * Kept as no-op for backward compatibility with any external callers.
 */
export async function lockProviderToOllama(_client: any): Promise<void> {
  const cfg = loadConfig();

  // Log what the user has configured, but do NOT enforce Ollama
  const defaultModel = cfg?.model ?? "(unset — will use current active model)";
  console.error(`[opencode-orchestrator] Provider lock DISABLED. Using models from opencode.json:`);
  console.error(`  default: ${defaultModel}`);

  if (cfg?.agent) {
    for (const [name, agent] of Object.entries(cfg.agent)) {
      const m = (agent as any)?.model as string | undefined;
      if (m) {
        console.error(`  ${name}: ${m}`);
      }
    }
  }
}
