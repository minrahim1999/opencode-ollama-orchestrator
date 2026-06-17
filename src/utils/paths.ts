/**
 * Per-project path helpers for plan/todo/mission storage.
 */
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Create a clean slug from a mission description.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "untitled";
}

/**
 * Get the per-project mission directory:
 * {directory}/.opencode/plans/{slug}/
 */
export function getMissionDirectory(baseDir: string, slug: string): string {
  const dir = join(baseDir, ".opencode", "plans", slug);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Ensure per-project standard directories exist.
 */
export function ensureProjectDirs(baseDir: string): {
  plansDir: string;
  todoDir: string;
  missionsDir: string;
} {
  const plansDir = join(baseDir, ".opencode", "plans");
  const todoDir = join(baseDir, ".opencode", "todo");
  const missionsDir = join(baseDir, ".opencode", "missions");

  mkdirSync(plansDir, { recursive: true });
  mkdirSync(todoDir, { recursive: true });
  mkdirSync(missionsDir, { recursive: true });

  return { plansDir, todoDir, missionsDir };
}

/**
 * Determine project directory relative to file path.
 * Looks for nearest .opencode/ parent to infer project root.
 * Falls back to the workspace directory.
 */
export function resolveProjectDirectory(filePath: string, workspaceDir: string): string {
  const parts = filePath.split("/");
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === ".opencode") {
      return parts.slice(0, i).join("/");
    }
  }
  return workspaceDir;
}
