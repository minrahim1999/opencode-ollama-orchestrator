import { readFileSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomicSync } from "./atomic.js";

export interface ParsedTodo {
  id: string;
  description: string;
  agent: string;
  criticalPath: boolean;
  phaseGate: boolean;
  dependsOn: string[];
  acceptanceCriteria: string[];
  status: "pending" | "in_progress" | "completed" | "failed";
  phase?: string;
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
function parseTodoContent(content: string): ParsedTodo[] {
  const lines = content.split("\n");
  const todos: ParsedTodo[] = [];
  let current: Partial<ParsedTodo> | null = null;
  let currentPhase = "";

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect phase header: "## Phase 1: Name"
    const phaseMatch = trimmed.match(/^## Phase \d+:\s*(.+)/i);
    if (phaseMatch) {
      currentPhase = phaseMatch[1].trim();
      continue;
    }

    // Match todo line: "- [ ] TASK-001: description (@engineer, critical-path: yes/no, phase-gate: yes/no)"
    const todoMatch = trimmed.match(
      /^- \[( |x|~)\] (TASK-\d+): (.+?)\s*\(@(\w+)\s*(.*?)\)/i
    );
    if (todoMatch) {
      if (current) todos.push(current as ParsedTodo);
      const metaStr = todoMatch[5];
      const mark = todoMatch[1];
      current = {
        status: mark === "x" ? "completed" : mark === "~" ? "in_progress" : "pending",
        id: todoMatch[2],
        description: todoMatch[3].trim(),
        agent: todoMatch[4],
        criticalPath: /critical-path:\s*yes/i.test(metaStr),
        phaseGate: /phase-gate:\s*yes/i.test(metaStr),
        dependsOn: [],
        acceptanceCriteria: [],
        phase: currentPhase,
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

/** Find the todo file — checks mission-specific first, then generic todos.md */
export function findTodoFile(directory: string, slug?: string): string {
  const candidates: string[] = [];
  if (slug) {
    candidates.push(join(directory, ".opencode", "todo", `${slug}.md`));
  }
  candidates.push(join(directory, ".opencode", "todos.md"));

  // Also scan .opencode/todo/ for any .md files
  const todoDir = join(directory, ".opencode", "todo");
  if (existsSync(todoDir)) {
    try {
      const files = readdirSync(todoDir).filter((f) => f.endsWith(".md"));
      for (const f of files) {
        candidates.push(join(todoDir, f));
      }
    } catch {
      // ignore
    }
  }

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // Default to mission-specific if slug given, else generic
  return slug ? join(directory, ".opencode", "todo", `${slug}.md`) : join(directory, ".opencode", "todos.md");
}

export function parseTodos(directory: string, slug?: string): ParsedTodo[] {
  const path = findTodoFile(directory, slug);
  if (!existsSync(path)) return [];

  const content = readFileSync(path, "utf-8");
  return parseTodoContent(content);
}

/** Update a specific todo's status in the discovered todo file */
export function updateTodoStatus(
  directory: string,
  taskId: string,
  status: "completed" | "failed" | "in_progress",
  evidence?: string,
  slug?: string
): void {
  const path = findTodoFile(directory, slug);
  if (!existsSync(path)) return;

  let content = readFileSync(path, "utf-8");
  const marker = status === "completed" ? "x" : status === "in_progress" ? "~" : " ";

  // Find the line containing this taskId and replace its checkbox
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(`${taskId}:`)) {
      lines[i] = line.replace(/^- \[(?: |x|~)\]/, `- [${marker}]`);
      if (evidence) {
        lines.splice(i + 1, 0, `  - Evidence: ${evidence}`);
        i++; // skip the inserted line
      }
      break; // only update first match
    }
  }

  writeFileAtomicSync(path, lines.join("\n"));
}

/** Export parsed todos to a JSON file for programmatic access */
export function exportTodosJson(directory: string, todos: ParsedTodo[], slug?: string): void {
  const path = slug
    ? join(directory, ".opencode", "todo", `${slug}.json`)
    : join(directory, ".opencode", "todos.json");
  writeFileSync(path, JSON.stringify(todos, null, 2), "utf-8");
}

export { writeFileAtomicSync };
