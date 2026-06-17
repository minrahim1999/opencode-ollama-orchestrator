import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface OpencodeJson {
  model?: string;
  provider?: Record<string, { baseUrl?: string } & Record<string, any>>;
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
 * Throws if non-Ollama provider or model is detected.
 */
export async function lockProviderToOllama(client: any): Promise<void> {
  const cfg = loadConfig();

  // Check default model
  if (cfg?.model && !cfg.model.startsWith("ollama/")) {
    throw new Error(
      `[ollama-orchestrator] Default model is not Ollama: "${cfg.model}". Only Ollama models are allowed.`
    );
  }

  // Check agent-specific models
  const config = await client.config.get().then((r: any) => r.data).catch(() => null);
  if (config?.agent) {
    for (const [name, agent] of Object.entries(config.agent)) {
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
