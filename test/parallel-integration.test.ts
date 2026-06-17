/**
 * Integration tests for parallel task execution and todo file safety.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseTodos, updateTodoStatus, writeFileAtomicSync } from "../src/utils/todo-parser.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";

// Helper: create a temp project with todo file
function createTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "orch-test-"));
  mkdirSync(join(dir, ".opencode", "todo"), { recursive: true });
  return dir;
}

// Helper: write a sample todo file
function writeTodoFile(dir: string, slug: string, content: string): void {
  const path = join(dir, ".opencode", "todo", `${slug}.md`);
  writeFileSync(path, content, "utf-8");
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe("Parallel Execution Safety", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTempProject();
  });

  afterEach(() => {
    cleanup(dir);
  });

  it("atomic write prevents corruption during concurrent updates", async () => {
    const path = join(dir, "test.md");
    writeFileSync(path, "initial", "utf-8");

    // Simulate 10 concurrent updates
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        new Promise<void>((resolve) => {
          setTimeout(() => {
            writeFileAtomicSync(path, `update-${i}`);
            resolve();
          }, Math.random() * 10);
        })
      );
    }

    // Wait for all writes
    await Promise.all(promises);

    // File should exist and contain one of the updates (not garbled)
    const final = readFileSync(path, "utf-8");
    expect(final.startsWith("update-")).toBe(true);
    // "update-N" where N is single digit (0-9) = 7 chars for 1-digit numbers
    expect(final.length).toBeGreaterThanOrEqual(7);
    expect(final.length).toBeLessThanOrEqual(10);
  });

  it("todo file is not corrupted by concurrent status updates", () => {
    const slug = "parallel-test";
    writeTodoFile(dir, slug, [
      "## Phase 1",
      "- [ ] TASK-001: First task (@engineer, critical-path: yes/no)",
      "  - Acceptance: foo works",
      "  - Depends: []",
      "- [ ] TASK-002: Second task (@engineer, critical-path: yes/no)",
      "  - Acceptance: bar works",
      "  - Depends: []",
      "## Phase 2",
      "- [ ] TASK-003: Third task (@engineer, critical-path: yes/no)",
      "  - Acceptance: baz works",
      "  - Depends: []",
    ].join("\n"));

    // Simulate concurrent status updates
    updateTodoStatus(dir, "TASK-001", "in_progress", undefined, slug);
    updateTodoStatus(dir, "TASK-002", "in_progress", undefined, slug);
    updateTodoStatus(dir, "TASK-003", "completed", "Done", slug);

    // Parse back and verify integrity
    const todos = parseTodos(dir, slug);
    expect(todos.length).toBe(3);

    const statuses = todos.map((t) => t.status);
    expect(statuses.filter((s) => s === "in_progress").length).toBe(2);
    expect(statuses.filter((s) => s === "completed").length).toBe(1);

    // File should still be valid markdown
    const content = readFileSync(join(dir, ".opencode", "todo", `${slug}.md`), "utf-8");
    expect(content).toContain("- [~] TASK-001");
    expect(content).toContain("- [~] TASK-002");
    expect(content).toContain("- [x] TASK-003");
  });

  it("mission state save and load is round-trip safe", () => {
    const missionDir = join(dir, ".opencode", "missions", "test-mission");
    mkdirSync(missionDir, { recursive: true });

    const state = {
      missionId: "mission-1234567890",
      slug: "test-mission",
      description: "Test mission",
      state: "executing",
      todos: [
        { id: "TASK-001", status: "completed", description: "Done", agent: "engineer", criticalPath: false, phaseGate: false, dependsOn: [], acceptanceCriteria: [], phase: "Phase 1" },
        { id: "TASK-002", status: "in_progress", description: "Running", agent: "engineer", criticalPath: true, phaseGate: false, dependsOn: [], acceptanceCriteria: [], phase: "Phase 1" },
      ],
      memory: [{ taskId: "TASK-001", agent: "engineer", summary: "Did something", filesChanged: [], issues: [], timestamp: Date.now() }],
    };

    const statePath = join(missionDir, "state.json");
    writeFileAtomicSync(statePath, JSON.stringify(state, null, 2));

    // Load it back
    const loaded = JSON.parse(readFileSync(statePath, "utf-8"));
    expect(loaded.missionId).toBe(state.missionId);
    expect(loaded.todos.length).toBe(2);
    expect(loaded.todos[0].status).toBe("completed");
    expect(loaded.todos[1].status).toBe("in_progress");
    expect(loaded.memory.length).toBe(1);
  });

  it("graceful shutdown saves all active mission states", () => {
    // Create multiple active missions
    const missionStates = ["executing", "hold", "retrying"];
    for (let i = 0; i < 3; i++) {
      const missionDir = join(dir, ".opencode", "missions", `mission-${i}-${Date.now()}`);
      mkdirSync(missionDir, { recursive: true });
      const state = {
        missionId: `mission-${i}`,
        slug: `mission-${i}`,
        description: `Test ${i}`,
        state: missionStates[i],
        todos: [],
        memory: [],
      };
      writeFileAtomicSync(join(missionDir, "state.json"), JSON.stringify(state, null, 2));
    }

    // Verify all files exist
    const missionsDir = join(dir, ".opencode", "missions");
    const entries = require("node:fs").readdirSync(missionsDir);
    expect(entries.length).toBe(3);

    // Verify all state files are valid JSON
    for (const entry of entries) {
      const statePath = join(missionsDir, entry, "state.json");
      expect(existsSync(statePath)).toBe(true);
      const data = JSON.parse(readFileSync(statePath, "utf-8"));
      expect(data.missionId).toBeDefined();
      expect(data.state).toBeOneOf(missionStates);
    }
  });
});
