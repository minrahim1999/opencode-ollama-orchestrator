/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { parseTodos, updateTodoStatus } from "../src/utils/todo-parser";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("parseTodos", () => {
  const tmpDir = join(tmpdir(), `oro-test-${Date.now()}`);

  it.beforeEach(() => {
    mkdirSync(join(tmpDir, ".opencode"), { recursive: true });
  });

  it.afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses a single todo with acceptance criteria", () => {
    const md = `## Phase 1
- [ ] TASK-001: Build auth system (@engineer, critical-path: yes)
  - Acceptance: JWT token valid for 24h
  - Acceptance: Password bcrypt rounds >= 12
  - Depends: []
`;
    writeFileSync(join(tmpDir, ".opencode", "todos.md"), md, "utf-8");
    const todos = parseTodos(tmpDir);

    expect(todos).toHaveLength(1);
    expect(todos[0]).toMatchObject({
      id: "TASK-001",
      description: "Build auth system",
      agent: "engineer",
      criticalPath: true,
      status: "pending",
      dependsOn: [],
      acceptanceCriteria: ["JWT token valid for 24h", "Password bcrypt rounds >= 12"],
    });
  });

  it("skips completed todos with [x]", () => {
    const md = `- [x] TASK-000: Setup repo (@engineer)
- [ ] TASK-001: Build auth (@engineer)
`;
    writeFileSync(join(tmpDir, ".opencode", "todos.md"), md, "utf-8");
    const todos = parseTodos(tmpDir);
    expect(todos[0].status).toBe("completed");
    expect(todos[1].status).toBe("pending");
  });

  it("returns empty array when todos.md missing", () => {
    const todos = parseTodos(tmpDir);
    expect(todos).toEqual([]);
  });
});

describe("updateTodoStatus", () => {
  const tmpDir = join(tmpdir(), `oro-update-${Date.now()}`);

  it.beforeEach(() => {
    mkdirSync(join(tmpDir, ".opencode"), { recursive: true });
    writeFileSync(join(tmpDir, ".opencode", "todos.md"), `- [ ] TASK-001: Build (@engineer)
- [ ] TASK-002: Test (@auditor)
`, "utf-8");
  });

  it.afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("marks a todo as completed", () => {
    updateTodoStatus(tmpDir, "TASK-001", "completed", "Merged in PR #42");
    const content = readFileSync(join(tmpDir, ".opencode", "todos.md"), "utf-8");
    expect(content).toContain("- [x] TASK-001:");
    expect(content).toContain("Evidence: Merged in PR #42");
  });
});
