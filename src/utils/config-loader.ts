/**
 * Shared config loading utilities — eliminates duplication between
 * mission-controller.ts and delegate-task.ts.
 *
 * Includes simple in-memory caching with mtime check to avoid synchronous
 * disk reads on every session/prompt call.
 */
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Cache entry for config file reads */
interface CacheEntry {
	mtime: number;
	data: Record<string, any> | null;
}

const configCache = new Map<string, CacheEntry>();

/** Load the user's global opencode.json with mtime-based caching */
export function loadUserConfig(): Record<string, any> | null {
	const candidates = [
		join(homedir(), ".config", "opencode", "opencode.json"),
		join(homedir(), ".opencode", "opencode.json"),
	];
	for (const p of candidates) {
		try {
			let mtime: number;
			try {
				mtime = statSync(p).mtimeMs;
			} catch {
				// statSync failed (mock env or file doesn't exist) — try readFileSync directly
				const raw = readFileSync(p, "utf-8");
				return JSON.parse(raw);
			}
			const cached = configCache.get(p);
			if (cached && cached.mtime === mtime) {
				return cached.data;
			}
			const raw = readFileSync(p, "utf-8");
			const data = JSON.parse(raw);
			configCache.set(p, { mtime, data });
			return data;
		} catch {
			// File doesn't exist or is malformed — try next candidate
		}
	}
	return null;
}

/** Parse "ollama/kimi-k2.7-code" -> { providerID: "ollama", modelID: "kimi-k2.7-code" } */
export function parseModel(
	modelStr: string,
): { providerID: string; modelID: string } | null {
	if (!modelStr || typeof modelStr !== "string") return null;
	const parts = modelStr.split("/");
	if (parts.length >= 2) {
		return { providerID: parts[0], modelID: parts.slice(1).join("/") };
	}
	return null;
}

/** Clear the config cache (useful for tests) */
export function clearConfigCache(): void {
	configCache.clear();
}
