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
 * Verify all configured models/providers are Ollama.
 * Only reads the config file — does NOT call SDK methods during init
 * to avoid blocking the plugin load.
 */
export async function lockProviderToOllama(_client: any): Promise<void> {
  const cfg = loadConfig();

  // Check default model
  if (cfg?.model && !cfg.model.startsWith("ollama/")) {
    throw new Error(
      `[ollama-orchestrator] Default model is not Ollama: "${cfg.model}". Only Ollama models are allowed.`
    );
  }

  // Check agent-specific models from file only
  if (cfg?.agent) {
    for (const [name, agent] of Object.entries(cfg.agent)) {
      const m = (agent as any)?.model as string | undefined;
      if (m && !m.startsWith("ollama/")) {
        throw new Error(
          `[ollama-orchestrator] Agent "${name}" uses non-Ollama model: "${m}". Only Ollama models are allowed.`
        );
      }
    }
  }

  console.error("[ollama-orchestrator] Ollama-only lock verified.");
}
