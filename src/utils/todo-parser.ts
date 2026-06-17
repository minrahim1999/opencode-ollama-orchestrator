import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ParsedTodo {
  id: string;
  description: string;
  agent: string;
  criticalPath: boolean;
  dependsOn: string[];
  acceptanceCriteria: string[];
  status: "pending" | "in_progress" | "completed" | "failed";
}

/**
 * Parse todos.md into structured tasks.
 *
 * Expected format:
 * ## Phase 1: Name
 * - [ ] TASK-001: Description (@engineer, critical-path: yes)
 *   - Acceptance: verifiable condition
 *   - Depends: [TASK-000]
 * - [x] TASK-002: Description (@auditor)
 *   - Acceptance: condition
 */
export function parseTodos(directory: string): ParsedTodo[] {
  const path = join(directory, ".opencode", "todos.md");
  if (!existsSync(path)) return [];

  const content = readFileSync(path, "utf-8");
  const lines = content.split("\n");
  const todos: ParsedTodo[] = [];

  let current: Partial<ParsedTodo> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Match todo line: "- [ ] TASK-001: description (@agent, critical-path: yes/no)"
    const todoMatch = trimmed.match(
      /^- \[( |x)\] (TASK-\d+): (.+?)\s*\(@(\w+)\s*(?:,\s*critical-path:\s*(yes|no))?\)/i
    );
    if (todoMatch) {
      if (current) todos.push(current as ParsedTodo);
      current = {
        status: todoMatch[1] === "x" ? "completed" : "pending",
        id: todoMatch[2],
        description: todoMatch[3].trim(),
        agent: todoMatch[4],
        criticalPath: todoMatch[5]?.toLowerCase() === "yes",
        dependsOn: [],
        acceptanceCriteria: [],
      };
      continue;
    }

    // Match acceptance criterion: "  - Acceptance: ..."
    const acceptMatch = trimmed.match(/^-?\s*Acceptance:\s*(.+)/i);
    if (acceptMatch && current) {
      current.acceptanceCriteria = current.acceptanceCriteria || [];
      current.acceptanceCriteria.push(acceptMatch[1].trim());
      continue;
    }

    // Match dependency: "  - Depends: [TASK-001, TASK-002]"
    const dependsMatch = trimmed.match(/^-?\s*Depends:\s*\[(.*?)\]/i);
    if (dependsMatch && current) {
      current.dependsOn = dependsMatch[1]
        .split(/,\s*/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  if (current) todos.push(current as ParsedTodo);
  return todos;
}

/** Update a specific todo's status in todos.md */
export function updateTodoStatus(
  directory: string,
  taskId: string,
  status: "completed" | "failed",
  evidence?: string
): void {
  const path = join(directory, ".opencode", "todos.md");
  if (!existsSync(path)) return;

  let content = readFileSync(path, "utf-8");
  const marker = status === "completed" ? "x" : " ";

  // Find the line containing this taskId and replace its checkbox
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(`${taskId}:`)) {
      lines[i] = line.replace(/^- \[(?: |x)\]/, `- [${marker}]`);
      if (evidence) {
        lines.splice(i + 1, 0, `  - Evidence: ${evidence}`);
        i++; // skip the inserted line
      }
      break; // only update first match
    }
  }

  writeFileSync(path, lines.join("\n"), "utf-8");
}

/** Export parsed todos to a JSON file for programmatic access */
export function exportTodosJson(directory: string, todos: ParsedTodo[]): void {
  const path = join(directory, ".opencode", "todos.json");
  writeFileSync(path, JSON.stringify(todos, null, 2), "utf-8");
}
